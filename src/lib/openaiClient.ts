// Client-side API helper: thin dispatcher over provider adapters.
// Providers live in ./api/providers/ and share plumbing from ./api/core.
// Uses native fetch for minimal bundle size.

import { DEFAULT_API_BASE_URL } from './constants/index.js';
import { loadSettings } from './settingsStore.js';
import { DEFAULT_MODEL } from './utils/presetHelpers.js';
import {
  ApiHttpError,
  buildClientOptions,
  buildProviderInput,
  hasNativeInput,
  withoutNative,
  normalizeBaseUrl,
  pickActivePreset,
  resolveConnection,
  type ProviderAdapter,
  type ProviderRequestContext,
} from './api/core.js';
import { responsesAdapter } from './api/providers/responses.js';
import { chatCompletionsAdapter } from './api/providers/chatCompletions.js';
import { geminiAdapter } from './api/providers/gemini.js';
import { anthropicAdapter } from './api/providers/anthropic.js';
import { isOpenAiCompatible } from './utils/apiModes.js';
import type {
  Settings,
  Connection,
  ApiMode,
  GenerationResponse,
  RespondOptions,
} from './types/index.js';

const ADAPTERS: Record<ApiMode, ProviderAdapter> = {
  responses: responsesAdapter,
  chat_completions: chatCompletionsAdapter,
  gemini: geminiAdapter,
  anthropic: anthropicAdapter,
};

/**
 * Endpoints that turned down replayed replies this session (an
 * OpenAI-compatible server that rejects unknown message fields, stored
 * items that expired). They get plain-text history from then on.
 */
const nativeRejectedBy = new Set<string>();

/** Statuses that mean the request body was refused, not that the service failed. */
const REJECTED_BODY_STATUSES = new Set([400, 404, 422]);

interface FetchClientConfig {
  apiKey: string;
  baseURL: string;
}

export async function getClient(options: {
  settings?: Settings | null;
  connectionId?: string | null;
  connection?: Partial<Connection> | null;
} = {}): Promise<FetchClientConfig | null> {
  const settings = options.settings || loadSettings();
  const connection = resolveConnection({
    connectionId: options.connectionId,
    connection: options.connection,
    settings,
  });
  if (!connection.apiKey) return null;
  const clientOptions = buildClientOptions(connection);
  if (!clientOptions) return null;
  return {
    apiKey: clientOptions.apiKey,
    baseURL: clientOptions.baseURL || DEFAULT_API_BASE_URL,
  };
}

// Create a response using either a single prompt string or an array of messages
// Messages should be of the form: { role: 'system'|'user'|'assistant', content: string }
export async function respond(options: RespondOptions): Promise<GenerationResponse> {
  const {
    prompt,
    messages,
    model: optModel,
    connectionId,
    stream = false,
    onAbort,
  } = options;

  const settings = loadSettings();
  const off = settings.disabledTools ?? {};
  const preset = pickActivePreset(settings);
  const useModel = optModel || preset?.model || DEFAULT_MODEL;
  const preferredConnectionId = typeof connectionId === 'string' && connectionId.trim()
    ? connectionId.trim()
    : (typeof preset?.connectionId === 'string' && preset.connectionId.trim()
      ? preset.connectionId.trim()
      : null);
  const resolvedConnection = resolveConnection({
    connectionId: preferredConnectionId,
    settings,
  });
  if (!resolvedConnection.apiKey) {
    throw new Error('Missing API key. Set it in Settings.');
  }

  // Build fetch config
  const effectiveConnectionId = resolvedConnection.id || preferredConnectionId || null;
  const clientConfig = await getClient({
    settings,
    connectionId: effectiveConnectionId,
    connection: { ...resolvedConnection, id: effectiveConnectionId } as Connection,
  });
  if (!clientConfig) {
    throw new Error('Missing API configuration.');
  }

  const provideAbort = (fn: () => void): void => {
    if (typeof onAbort !== 'function') return;
    onAbort(() => {
      try { fn?.(); } catch { /* ignore */ }
    });
  };

  const ctx: ProviderRequestContext = {
    model: useModel,
    apiKey: clientConfig.apiKey,
    baseURL: clientConfig.baseURL,
    apiBaseUrl: resolvedConnection.apiBaseUrl,
    input: buildProviderInput(messages, prompt),
    params: {
      maxOutputTokens: options.maxOutputTokens,
      topP: options.topP,
      temperature: options.temperature,
      reasoningEffort: options.reasoningEffort,
      textVerbosity: options.textVerbosity,
      reasoningSummary: options.reasoningSummary,
      openRouterProvider: resolvedConnection.openRouterEnabled && isOpenAiCompatible(resolvedConnection.apiMode)
        ? options.openRouterProvider?.trim() || undefined : undefined,
      openRouterZdr: resolvedConnection.openRouterEnabled && isOpenAiCompatible(resolvedConnection.apiMode)
        && options.openRouterZdr === true,
      thinkingEnabled: options.thinkingEnabled,
      thinkingBudgetTokens: options.thinkingBudgetTokens,
    },
    // Tools switched off in Settings are never sent, whatever the chat has saved.
    tools: {
      webSearch: off.webSearch ? undefined : options.webSearch,
      codeInterpreter: off.codeInterpreter ? undefined : options.codeInterpreter,
      shell: off.shell ? undefined : options.shell,
      imageGeneration: off.imageGeneration ? undefined : options.imageGeneration,
      mcpServers: off.mcp ? [] : options.mcpServers,
      webFetch: off.webFetch ? undefined : options.webFetch,
      browserTools: off.browser ? undefined : options.browserTools,
    },
    openRouter: resolvedConnection.openRouterEnabled === true,
    callbacks: {
      onEvent: options.onEvent,
      onTextDelta: options.onTextDelta,
      onActivity: options.onActivity,
      onWebSearchResult: options.onWebSearchResult,
      onImageGenerated: options.onImageGenerated,
    },
    provideAbort,
    steering: options.steering,
  };

  const adapter = ADAPTERS[resolvedConnection.apiMode] || responsesAdapter;
  const endpointKey = `${resolvedConnection.apiMode}|${clientConfig.baseURL}|${resolvedConnection.apiBaseUrl ?? ''}`;
  if (!hasNativeInput(ctx.input)) return adapter.respond(ctx, stream);
  if (nativeRejectedBy.has(endpointKey)) return adapter.respond({ ...ctx, input: withoutNative(ctx.input) }, stream);

  // Earlier replies go back as the provider returned them. If the request is
  // refused before anything streamed, it is sent once more as plain text.
  let started = false;
  const mark = <A extends unknown[]>(fn?: (...args: A) => void) => (fn
    ? (...args: A) => { started = true; fn(...args); }
    : undefined);
  const tracked: ProviderRequestContext = {
    ...ctx,
    callbacks: {
      onEvent: mark(ctx.callbacks.onEvent),
      onTextDelta: mark(ctx.callbacks.onTextDelta),
      onActivity: mark(ctx.callbacks.onActivity),
      onWebSearchResult: mark(ctx.callbacks.onWebSearchResult),
      onImageGenerated: mark(ctx.callbacks.onImageGenerated),
    },
  };
  try {
    return await adapter.respond(tracked, stream);
  } catch (err) {
    if (started || !(err instanceof ApiHttpError) || !REJECTED_BODY_STATUSES.has(err.status)) throw err;
    const reply = await adapter.respond({ ...ctx, input: withoutNative(ctx.input) }, stream);
    nativeRejectedBy.add(endpointKey);
    return reply;
  }
}

// List available models for a connection (or explicit key)
export async function listModels(options: {
  apiKey?: string;
  apiBaseUrl?: string;
  connectionId?: string;
  apiMode?: ApiMode;
} = {}): Promise<string[]> {
  let apiKey: string;
  let baseURL: string;
  let apiMode: ApiMode = 'responses';

  if (options?.apiKey) {
    const clientOptions = buildClientOptions(options as { apiKey: string; apiBaseUrl?: string });
    if (!clientOptions) throw new Error('Missing API key.');
    apiKey = clientOptions.apiKey;
    baseURL = clientOptions.baseURL || DEFAULT_API_BASE_URL;
    apiMode = options.apiMode || 'responses';
  } else {
    const settings = loadSettings();
    const connection = resolveConnection({
      connectionId: options.connectionId,
      settings,
    });
    if (!connection.apiKey) throw new Error('Missing API key. Set it in Settings.');
    apiKey = connection.apiKey;
    baseURL = normalizeBaseUrl(connection.apiBaseUrl) || DEFAULT_API_BASE_URL;
    apiMode = connection.apiMode;
  }

  const adapter = ADAPTERS[apiMode] || responsesAdapter;
  return adapter.listModels({ apiKey, baseURL });
}

// List models using a provided API key (without saving it)
export async function listModelsWithKey(apiKey: string, apiBaseUrl: string = '', apiMode?: ApiMode): Promise<string[]> {
  return listModels({ apiKey, apiBaseUrl, apiMode });
}
