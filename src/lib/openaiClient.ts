// Client-side OpenAI helper for Responses and Chat Completions APIs
// Uses the official OpenAI SDK only (no fetch fallback)

import OpenAI from 'openai';
import { loadSettings, findConnection } from './settingsStore.js';
import { toIntOrNull, toClampedNumber } from './utils/numbers.js';
import type {
  Settings,
  Connection,
  ApiMode,
  ResolvedConnection,
  GenerationResponse,
  RespondOptions,
  HistoryMessage,
  ImageData
} from './types/index.js';

function resolveConnection(options: {
  connectionId?: string | null;
  connection?: Partial<Connection> | null;
  settings?: Settings | null;
} = {}): ResolvedConnection {
  const { connectionId, connection, settings } = options;
  if (connection && typeof connection === 'object') {
    const id = typeof connection.id === 'string' && connection.id.trim()
      ? connection.id.trim()
      : null;
    const apiKey = typeof connection.apiKey === 'string' ? connection.apiKey : '';
    const apiBaseUrl = connection.apiBaseUrl;
    const apiMode: ApiMode = connection.apiMode === 'chat_completions' ? 'chat_completions' : 'responses';
    return { id, apiKey, apiBaseUrl, apiMode };
  }
  const srcSettings = settings || loadSettings();
  const resolved = findConnection(srcSettings, connectionId);
  return {
    id: resolved?.id || null,
    apiKey: typeof resolved?.apiKey === 'string' ? resolved.apiKey : '',
    apiBaseUrl: resolved?.apiBaseUrl,
    apiMode: resolved?.apiMode === 'chat_completions' ? 'chat_completions' : 'responses',
  };
}

interface ClientOptions {
  apiKey: string;
  baseURL?: string;
  dangerouslyAllowBrowser?: boolean;
}

function buildClientOptions(options: { apiKey: string; apiBaseUrl?: string }): ClientOptions | null {
  const { apiKey, apiBaseUrl } = options;
  if (!apiKey) return null;
  const baseURL = typeof apiBaseUrl === 'string' && apiBaseUrl.trim() ? apiBaseUrl.trim() : '';
  const clientOptions: ClientOptions = { apiKey, dangerouslyAllowBrowser: true };
  if (baseURL) clientOptions.baseURL = baseURL;
  return clientOptions;
}

function normalizeMimeType(mimeType: unknown): string {
  if (typeof mimeType !== 'string') return '';
  return mimeType.trim().toLowerCase();
}

function isImageMimeType(mimeType: string | undefined): boolean {
  const normalized = normalizeMimeType(mimeType);
  return normalized.startsWith('image/');
}

function isPdfMimeType(mimeType: string | undefined): boolean {
  return normalizeMimeType(mimeType) === 'application/pdf';
}

function inferAttachmentFilename(attachment: { name?: string; id?: string; mimeType?: string } | null, fallbackBase: string = 'attachment'): string {
  if (!attachment || typeof attachment !== 'object') return `${fallbackBase}`;
  if (typeof attachment.name === 'string' && attachment.name.trim()) return attachment.name.trim();
  if (typeof attachment.id === 'string' && attachment.id.trim()) {
    const id = attachment.id.trim();
    if (isPdfMimeType(attachment.mimeType) && !id.toLowerCase().endsWith('.pdf')) {
      return `${id}.pdf`;
    }
    return id;
  }
  if (isPdfMimeType(attachment?.mimeType)) return `${fallbackBase}.pdf`;
  return fallbackBase;
}

function ensureDataUrl(data: unknown, mimeType: string | undefined): string {
  if (typeof data !== 'string' || !data) return '';
  if (data.startsWith('data:')) return data;
  const mime = normalizeMimeType(mimeType) || 'application/octet-stream';
  return `data:${mime};base64,${data}`;
}

export async function getClient(options: {
  settings?: Settings | null;
  connectionId?: string | null;
  connection?: Partial<Connection> | null;
} = {}): Promise<OpenAI | null> {
  const settings = options.settings || loadSettings();
  const connection = resolveConnection({
    connectionId: options.connectionId,
    connection: options.connection,
    settings,
  });
  if (!connection.apiKey) return null;
  const clientOptions = buildClientOptions(connection);
  if (!clientOptions) return null;
  return new OpenAI(clientOptions);
}

function pickActivePreset(settings: Settings | null): { model: string; streaming: boolean; connectionId: string | null } {
  const list = Array.isArray(settings?.presets) ? settings.presets : [];
  const fallbackConnectionId = typeof settings?.selectedConnectionId === 'string' ? settings.selectedConnectionId : null;
  if (!list.length) return { model: 'gpt-5', streaming: true, connectionId: fallbackConnectionId };
  const selected = typeof settings?.selectedPresetId === 'string'
    ? list.find(p => p?.id === settings.selectedPresetId)
    : null;
  return selected || list[0] || { model: 'gpt-5', streaming: true, connectionId: fallbackConnectionId };
}

type ContentPart = 
  | { type: 'input_text'; text: string }
  | { type: 'input_image'; image_url: string }
  | { type: 'input_file'; file_data: string; filename: string };

type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'file'; file: { file_data: string; filename: string } };

// Create a response using either a single prompt string or an array of messages
// Messages should be of the form: { role: 'system'|'user'|'assistant', content: string }
export async function respond(options: RespondOptions): Promise<GenerationResponse> {
  const {
    prompt,
    messages,
    model: optModel,
    connectionId,
    stream = false,
    onTextDelta,
    onEvent,
    maxOutputTokens,
    topP,
    temperature,
    reasoningEffort,
    textVerbosity,
    reasoningSummary,
    thinkingEnabled,
    thinkingBudgetTokens,
    onReasoningSummaryDelta,
    onReasoningSummaryDone,
    onAbort,
  } = options;

  const settings = loadSettings();
  const preset = pickActivePreset(settings);
  const useModel = optModel || preset?.model || 'gpt-5';
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
    throw new Error('Missing OpenAI API key. Set it in Settings.');
  }
  const apiMode = resolvedConnection.apiMode === 'chat_completions' ? 'chat_completions' : 'responses';
  const useChatCompletions = apiMode === 'chat_completions';

  // SDK call only
  const effectiveConnectionId = resolvedConnection.id || preferredConnectionId || null;
  const client = await getClient({
    settings,
    connectionId: effectiveConnectionId,
    connection: { ...resolvedConnection, id: effectiveConnectionId } as Connection,
  });
  if (!client) {
    throw new Error('OpenAI SDK is not available or is outdated.');
  }
  const supportsResponses = !!(client as unknown as { responses?: { create?: unknown } })?.responses?.create;
  const supportsChatCompletions = !!client?.chat?.completions?.create;
  if (useChatCompletions && !supportsChatCompletions) {
    throw new Error('OpenAI SDK does not support the Chat Completions API.');
  }
  if (!useChatCompletions && !supportsResponses) {
    throw new Error('OpenAI SDK is not available or is outdated.');
  }

  const provideAbort = (fn: () => void): void => {
    if (typeof onAbort !== 'function') return;
    onAbort(() => {
      try { fn?.(); } catch { /* ignore */ }
    });
  };

  let input: string | Array<{ role: string; content: string | ContentPart[] }>;
  if (Array.isArray(messages) && messages.length) {
    // Normalize: strip extra fields like ids/typing and keep valid roles only
    const allowed = new Set(['system', 'user', 'assistant']);
    input = messages
      .filter(m => m && (typeof m.content === 'string' || (m.images && Array.isArray(m.images))) && allowed.has(m.role))
      .map(({ role, content, images }) => {
        // For Responses API: if there are images, convert content to array format
        if (images && Array.isArray(images) && images.length > 0) {
          const contentArray: ContentPart[] = [];
          if (content && typeof content === 'string') {
            contentArray.push({ type: 'input_text', text: content });
          }
          for (const img of images as ImageData[]) {
            if (img && typeof img.id === 'string' && typeof img.data === 'string') {
              const mimeType = normalizeMimeType(img.mimeType) || '';
              if (isImageMimeType(mimeType) || (!mimeType && typeof img.data === 'string')) {
                const safeMime = mimeType || 'image/jpeg';
                contentArray.push({
                  type: 'input_image',
                  image_url: `data:${safeMime};base64,${img.data}`,
                });
              } else if (isPdfMimeType(mimeType) || (!mimeType && typeof img.name === 'string' && img.name.toLowerCase().endsWith('.pdf'))) {
                const dataUrl = ensureDataUrl(img.data, mimeType || 'application/pdf');
                if (!dataUrl) continue;
                contentArray.push({
                  type: 'input_file',
                  file_data: dataUrl,
                  filename: inferAttachmentFilename(img, 'document.pdf'),
                });
              } else {
                const dataUrl = ensureDataUrl(img.data, mimeType || 'application/octet-stream');
                if (!dataUrl) continue;
                // Default to file for any non-image attachments
                contentArray.push({
                  type: 'input_file',
                  file_data: dataUrl,
                  filename: inferAttachmentFilename(img, 'attachment.bin'),
                });
              }
            }
          }
          if (contentArray.length > 0) {
            return { role, content: contentArray };
          }
        }
        return { role, content: content as string };
      });
  } else {
    input = typeof prompt === 'string' ? prompt : '';
  }

  const request: Record<string, unknown> = { model: useModel, input };

  // For Chat Completions API: convert image format
  const chatMessages: Array<{ role: string; content: string | ChatContentPart[] }> = Array.isArray(input)
    ? input.map(msg => {
        // If content is an array (from Responses format), convert to Chat Completions format
        if (Array.isArray(msg.content)) {
          const contentArray: ChatContentPart[] = [];
          for (const part of msg.content as ContentPart[]) {
            if (part.type === 'input_text' && (part as { text?: string }).text) {
              contentArray.push({ type: 'text', text: (part as { text: string }).text });
            } else if (part.type === 'input_image' && (part as { image_url?: string }).image_url) {
              contentArray.push({
                type: 'image_url',
                image_url: { url: (part as { image_url: string }).image_url }
              });
            } else if (part.type === 'input_file') {
              const filePart = part as { file_data?: string; filename?: string; file?: { file_data?: string; filename?: string; mime_type?: string } };
              const rawData = typeof filePart.file_data === 'string' && filePart.file_data
                ? filePart.file_data
                : (typeof filePart.file === 'object' && filePart.file?.file_data ? filePart.file.file_data : null);
              const filename = typeof filePart.filename === 'string' && filePart.filename
                ? filePart.filename
                : (typeof filePart.file === 'object' && filePart.file?.filename ? filePart.file.filename : 'attachment');
              const normalizedMime = (() => {
                if (typeof filePart.file === 'object' && typeof filePart.file?.mime_type === 'string') return filePart.file.mime_type;
                if (typeof filename === 'string' && filename.toLowerCase().endsWith('.pdf')) return 'application/pdf';
                return undefined;
              })();
              const dataUrl = rawData ? ensureDataUrl(rawData, normalizedMime) : '';
              if (dataUrl) {
                contentArray.push({
                  type: 'file',
                  file: {
                    file_data: dataUrl,
                    filename
                  }
                });
              }
            }
          }
          if (contentArray.length > 0) {
            return { role: msg.role, content: contentArray };
          }
        }
        return msg as { role: string; content: string };
      })
    : (typeof input === 'string' && input
      ? [{ role: 'user', content: input }]
      : []);

  const chatRequest: Record<string, unknown> = { model: useModel, messages: chatMessages };
  const tokens = toIntOrNull(maxOutputTokens);
  if (tokens != null) request.max_output_tokens = tokens;
  if (tokens != null) chatRequest.max_completion_tokens = tokens;
  const topPVal = toClampedNumber(topP, 0, 1);
  if (topPVal != null) request.top_p = topPVal;
  if (topPVal != null) chatRequest.top_p = topPVal;
  const tempVal = toClampedNumber(temperature, 0, 2);
  if (tempVal != null) request.temperature = tempVal;
  if (tempVal != null) chatRequest.temperature = tempVal;
  const reasoningOptions: Record<string, string> = {};
  if (typeof reasoningEffort === 'string' && reasoningEffort && reasoningEffort !== 'none') {
    reasoningOptions.effort = reasoningEffort;
  }
  if (typeof reasoningSummary === 'string' && reasoningSummary && reasoningSummary !== 'none') {
    reasoningOptions.summary = reasoningSummary;
  }
  if (Object.keys(reasoningOptions).length) {
    request.reasoning = reasoningOptions;
  }
  if (reasoningOptions?.effort) {
    chatRequest.reasoning_effort = reasoningOptions.effort;
  }
  if (typeof textVerbosity === 'string' && textVerbosity && textVerbosity !== 'none') {
    request.text = { verbosity: textVerbosity };
  }
  const thinkingBudget = toIntOrNull(thinkingBudgetTokens);
  const thinkingConfig: { type: string; budget_tokens?: number } | null = (() => {
    if (!thinkingEnabled) return null;
    const body: { type: string; budget_tokens?: number } = { type: 'enabled' };
    if (thinkingBudget != null) body.budget_tokens = thinkingBudget;
    return body;
  })();
  if (thinkingConfig) {
    request.thinking = thinkingConfig;
    chatRequest.thinking = thinkingConfig;
    request.extra_body = { ...(request.extra_body as object || {}), thinking: thinkingConfig };
    chatRequest.extra_body = { ...(chatRequest.extra_body as object || {}), thinking: thinkingConfig };
  }

  if (stream) {
    if (useChatCompletions) {
      const abortController = (typeof AbortController === 'function') ? new AbortController() : null;
      if (abortController) {
        provideAbort(() => {
          try { abortController.abort(); } catch { /* ignore */ }
        });
      }
      const streamIt = await client.chat.completions.create(
        { ...chatRequest, stream: true } as Parameters<typeof client.chat.completions.create>[0],
        abortController ? { signal: abortController.signal } : undefined,
      );
      provideAbort(() => {
        try { (streamIt as unknown as { controller?: { abort?: () => void } }).controller?.abort?.(); } catch { /* ignore */ }
      });
      let full = '';
      const summaryByIndex = new Map<number, string>();
      let summaryDelivered = false;
      const buildSummary = (): string => {
        const ordered = Array.from(summaryByIndex.entries())
          .sort((a, b) => a[0] - b[0])
          .map(([, text]) => (typeof text === 'string' ? text : ''))
          .filter(Boolean);
        if (!ordered.length) return '';
        const combined = ordered.join('\n\n\n');
        return combined.replace(/\n{4,}/g, '\n\n\n');
      };
      try {
        for await (const chunk of streamIt) {
          try { onEvent?.(chunk); } catch { /* ignore */ }
          const deltaText = collectChatDeltaText(chunk);
          if (deltaText) {
            full += deltaText;
            try { onTextDelta?.(full); } catch { /* ignore */ }
          }
          // Check for top-level reasoning field in chunk
          const topLevelReasoning = collectChatReasoningContent((chunk as unknown as { reasoning?: unknown })?.reasoning);
          if (topLevelReasoning) {
            const prev = summaryByIndex.get(0) || '';
            const next = topLevelReasoning;
            if (next !== prev) {
              summaryByIndex.set(0, next);
              const summary = buildSummary();
              try { onReasoningSummaryDelta?.(summary, topLevelReasoning, chunk); } catch { /* ignore */ }
            }
          }
          const choices = Array.isArray((chunk as unknown as { choices?: unknown[] })?.choices) ? (chunk as unknown as { choices: unknown[] }).choices : [];
          let finishReasonSeen = false;
          for (const choice of choices as Array<{ index?: number; delta?: { reasoning_content?: unknown; reasoning?: unknown }; message?: { reasoning_content?: unknown; reasoning?: unknown }; finish_reason?: string }>) {
            const idx = Number.isFinite(Number(choice?.index)) ? Number(choice.index) : 0;
            const prev = summaryByIndex.get(idx) || '';
            let next = prev;
            const deltaSummary = collectChatReasoningContent(choice?.delta?.reasoning_content) || collectChatReasoningContent(choice?.delta?.reasoning);
            if (deltaSummary) {
              next += deltaSummary;
            }
            const messageSummary = collectChatReasoningContent(choice?.message?.reasoning_content) || collectChatReasoningContent(choice?.message?.reasoning);
            if (messageSummary) {
              next = messageSummary;
            }
            if (next !== prev) {
              summaryByIndex.set(idx, next);
              const summary = buildSummary();
              try { onReasoningSummaryDelta?.(summary, deltaSummary || messageSummary || '', choice); } catch { /* ignore */ }
            }
            if (!finishReasonSeen && typeof choice?.finish_reason === 'string' && choice.finish_reason) {
              finishReasonSeen = true;
            }
          }
          if (finishReasonSeen && !summaryDelivered) {
            const summary = buildSummary();
            try {
              onReasoningSummaryDone?.(summary || '', chunk);
              summaryDelivered = true;
            } catch { /* ignore */ }
          }
        }
      } catch (err) {
        throw err;
      } finally {
        try { (streamIt as unknown as { controller?: { abort?: () => void } }).controller?.abort?.(); } catch { /* ignore */ }
      }
      const finalSummary = buildSummary();
      if (!summaryDelivered) {
        try {
          onReasoningSummaryDone?.(finalSummary || '', null);
          summaryDelivered = true;
        } catch { /* ignore */ }
      }
      return {
        text: full,
        reasoningSummary: finalSummary,
      };
    }

    // Stream via SDK's async iterator
    const abortController = (typeof AbortController === 'function') ? new AbortController() : null;
    if (abortController) {
      provideAbort(() => {
        try { abortController.abort(); } catch { /* ignore */ }
      });
    }
    const responsesApi = (client as unknown as { responses: { create: (req: unknown, opts?: { signal?: AbortSignal }) => Promise<AsyncIterable<unknown>> } }).responses;
    const streamIt = await responsesApi.create({ ...request, stream: true }, abortController ? { signal: abortController.signal } : undefined);
    provideAbort(() => {
      try { (streamIt as unknown as { controller?: { abort?: () => void } }).controller?.abort?.(); } catch { /* ignore */ }
    });
    let full = '';
    const summaryByIndex = new Map<number, string>();
    let summaryDelivered = false;
    const buildSummary = (): string => {
      const ordered = Array.from(summaryByIndex.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([, text]) => (typeof text === 'string' ? text : ''))
        .filter(Boolean);
      if (!ordered.length) return '';
      const combined = ordered.join('\n\n\n');
      return combined.replace(/\n{4,}/g, '\n\n\n');
    };
    let completed = false;
    try {
      for await (const event of streamIt as AsyncIterable<Record<string, unknown>>) {
        try { onEvent?.(event); } catch { /* ignore */ }
        const t = (event?.type || event?.event || '') as string;
        if (t === 'response.output_text.delta') {
          const delta = event?.delta || '';
          if (typeof delta === 'string' && delta) {
            full += delta;
            try { onTextDelta?.(full, delta, event); } catch { /* ignore */ }
          }
        } else if (t === 'response.reasoning_summary_text.delta') {
          const delta = event?.delta || '';
          const idx = Number.isFinite(Number(event?.summary_index)) ? Number(event.summary_index) : 0;
          const prev = summaryByIndex.get(idx) || '';
          const next = typeof delta === 'string' && delta ? prev + delta : prev;
          summaryByIndex.set(idx, next);
          const summary = buildSummary();
          try { onReasoningSummaryDelta?.(summary, typeof delta === 'string' ? delta : '', event); } catch { /* ignore */ }
        } else if (t === 'response.reasoning_summary_text.done') {
          const idx = Number.isFinite(Number(event?.summary_index)) ? Number(event.summary_index) : 0;
          const text = typeof event?.text === 'string' ? event.text : '';
          const existing = summaryByIndex.get(idx) || '';
          const finalText = text || existing;
          if (finalText) summaryByIndex.set(idx, finalText);
          const summary = buildSummary();
          try {
            onReasoningSummaryDone?.(summary, event);
            summaryDelivered = true;
          } catch { /* ignore */ }
        } else if (t === 'response.completed' || t === 'response.text.done' || t === 'response.done') {
          completed = true;
          if (!summaryDelivered) {
            const summary = buildSummary();
            if (summary) {
              try {
                onReasoningSummaryDone?.(summary, event);
                summaryDelivered = true;
              } catch { /* ignore */ }
            }
          }
          break;
        } else if (t === 'response.failed' || t === 'error') {
          const msg = ((event?.error as Record<string, unknown>)?.message as string) || 'Stream failed.';
          throw new Error(msg);
        }
      }
    } catch (err) {
      // Re-throw so callers can handle
      throw err;
    } finally {
      if (completed) {
        try { (streamIt as unknown as { controller?: { abort?: () => void } }).controller?.abort?.(); } catch { /* ignore */ }
      }
    }
    const finalSummary = buildSummary();
    if (!summaryDelivered && finalSummary) {
      try {
        onReasoningSummaryDone?.(finalSummary, null);
        summaryDelivered = true;
      } catch { /* ignore */ }
    }
    return {
      text: full,
      reasoningSummary: finalSummary,
    };
  } else {
    if (useChatCompletions) {
      const abortController = (typeof AbortController === 'function') ? new AbortController() : null;
      if (abortController) {
        provideAbort(() => {
          try { abortController.abort(); } catch { /* ignore */ }
        });
      } else if (typeof onAbort === 'function') {
        // Still provide a callable no-op so callers can clear their abort handle
        onAbort(() => {});
      }
      const res = await client.chat.completions.create(
        chatRequest as Parameters<typeof client.chat.completions.create>[0],
        abortController ? { signal: abortController.signal } : undefined,
      );
      const text = extractOutputText(res);
      const summary = extractChatReasoningSummary(res);
      try { onReasoningSummaryDone?.(summary || '', null); } catch { /* ignore */ }
      return { text, reasoningSummary: summary || '' };
    }

    const abortController = (typeof AbortController === 'function') ? new AbortController() : null;
    if (abortController) {
      provideAbort(() => {
        try { abortController.abort(); } catch { /* ignore */ }
      });
    } else if (typeof onAbort === 'function') {
      // Still provide a callable no-op so callers can clear their abort handle
      onAbort(() => {});
    }
    const responsesApi = (client as unknown as { responses: { create: (req: unknown, opts?: { signal?: AbortSignal }) => Promise<unknown> } }).responses;
    const res = await responsesApi.create(request, abortController ? { signal: abortController.signal } : undefined);
    const text = extractOutputText(res);
    const summary = extractReasoningSummary(res);
    if (summary) {
      try { onReasoningSummaryDone?.(summary, null); } catch { /* ignore */ }
    }
    return { text, reasoningSummary: summary };
  }
}

// List available models via the official SDK
export async function listModels(options: {
  apiKey?: string;
  apiBaseUrl?: string;
  connectionId?: string;
} = {}): Promise<string[]> {
  let client: OpenAI | null = null;
  if (options?.apiKey) {
    const clientOptions = buildClientOptions(options as { apiKey: string; apiBaseUrl?: string });
    if (!clientOptions) throw new Error('Missing OpenAI API key.');
    client = new OpenAI(clientOptions);
  } else {
    client = await getClient(options);
  }
  if (!client) throw new Error('Missing OpenAI API key. Set it in Settings.');
  if (!client?.models?.list) throw new Error('OpenAI SDK does not support listing models.');
  const res = await client.models.list();
  const items = Array.isArray(res?.data) ? res.data : [];
  return sortModels(items).map(m => m.id);
}

// List models using a provided API key (without saving it)
export async function listModelsWithKey(apiKey: string, apiBaseUrl: string = ''): Promise<string[]> {
  return listModels({ apiKey, apiBaseUrl });
}

function sortModels(items: Array<{ id?: string; created?: number }>): Array<{ id: string; created: number }> {
  const arr = items
    .map(m => ({ id: String(m?.id || ''), created: Number(m?.created) || 0 }))
    .filter(m => m.id);
  arr.sort((a, b) => (b.created - a.created));
  // Deduplicate by id while preserving order
  const seen = new Set<string>();
  const out: Array<{ id: string; created: number }> = [];
  for (const m of arr) {
    if (!seen.has(m.id)) { seen.add(m.id); out.push(m); }
  }
  return out;
}

function collectContentText(content: unknown): string {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (typeof content === 'number') return String(content);
  if (Array.isArray(content)) {
    return content.map(item => collectContentText(item)).join('');
  }
  if (typeof content === 'object') {
    const c = content as Record<string, unknown>;
    if (typeof c.text === 'string') return c.text;
    if (Array.isArray(c.text)) return (c.text as unknown[]).map(val => collectContentText(val)).join('');
    if (typeof c.output_text === 'string') return c.output_text;
    if (Array.isArray(c.output_text)) return (c.output_text as unknown[]).map(val => collectContentText(val)).join('');
    if (typeof c.content === 'string') return c.content;
    if (Array.isArray(c.content)) return (c.content as unknown[]).map(val => collectContentText(val)).join('');
    if (typeof c.value === 'string') return c.value;
  }
  return '';
}

function collectChatDeltaText(chunk: unknown): string {
  if (!chunk) return '';
  const pieces: string[] = [];
  const chunkObj = chunk as { choices?: Array<{ delta?: { content?: unknown }; message?: { content?: unknown } }> };
  const choices = Array.isArray(chunkObj?.choices) ? chunkObj.choices : [];
  for (const choice of choices) {
    const deltaText = collectContentText(choice?.delta?.content);
    if (deltaText) {
      pieces.push(deltaText);
    } else {
      const messageText = collectContentText(choice?.message?.content);
      if (messageText) pieces.push(messageText);
    }
  }
  return pieces.join('');
}

function collectChatReasoningContent(reasoningContent: unknown): string {
  if (reasoningContent == null) return '';
  if (typeof reasoningContent === 'string' || typeof reasoningContent === 'number') {
    return String(reasoningContent);
  }
  const pieces: string[] = [];
  const items = Array.isArray(reasoningContent) ? reasoningContent : [reasoningContent];
  for (const item of items) {
    if (item == null) continue;
    if (typeof item === 'string' || typeof item === 'number') {
      if (String(item)) pieces.push(String(item));
      continue;
    }
    const itemObj = item as Record<string, unknown>;
    if (typeof itemObj.text === 'string') {
      if (itemObj.text) pieces.push(itemObj.text);
      continue;
    }
    if (Array.isArray(itemObj.text)) {
      const text = collectContentText(itemObj.text);
      if (text) pieces.push(text);
      continue;
    }
    if (typeof itemObj.content === 'string') {
      if (itemObj.content) pieces.push(itemObj.content);
      continue;
    }
    if (Array.isArray(itemObj.content)) {
      const text = collectContentText(itemObj.content);
      if (text) pieces.push(text);
      continue;
    }
    const fallback = collectContentText(item);
    if (fallback) pieces.push(fallback);
  }
  return pieces.join('');
}

function extractOutputText(res: unknown): string {
  const resObj = res as Record<string, unknown>;
  // SDK convenience property
  if (resObj && typeof resObj.output_text === 'string' && (resObj.output_text as string).length) return resObj.output_text as string;
  try {
    // Try Responses API shape
    const parts = (resObj?.output ?? resObj?.choices ?? []) as unknown[];
    if (Array.isArray(parts) && parts.length) {
      const first = parts[0] as Record<string, unknown>;
      const content = first?.content ?? (first?.message as Record<string, unknown>)?.content ?? first;
      const text = collectContentText(content);
      if (text) return text;
    }
    const dataContent = ((resObj?.data as unknown[])?.[0] as Record<string, unknown>)?.content;
    const dataText = collectContentText(dataContent);
    if (dataText) return dataText;
    if (Array.isArray(resObj?.choices)) {
      for (const choice of resObj.choices as Array<Record<string, unknown>>) {
        const msgText = collectContentText((choice?.message as Record<string, unknown>)?.content);
        if (msgText) return msgText;
        const deltaText = collectContentText((choice?.delta as Record<string, unknown>)?.content);
        if (deltaText) return deltaText;
      }
    }
  } catch { /* ignore */ }
  return JSON.stringify(res);
}

function extractReasoningSummary(res: unknown): string {
  const collect = (out: unknown): string => {
    if (!Array.isArray(out)) return '';
    const order: string[] = [];
    for (const item of out as Array<Record<string, unknown>>) {
      if (item && item.type === 'reasoning') {
        const parts = Array.isArray(item.summary) ? item.summary : [];
        for (const part of parts as Array<Record<string, unknown>>) {
          if (part && typeof part.text === 'string') {
            order.push(part.text);
          }
        }
      }
    }
    if (!order.length) return '';
    const joined = order.join('\n\n\n');
    return joined.replace(/\n{4,}/g, '\n\n\n');
  };
  const resObj = res as Record<string, unknown>;
  try {
    const direct = collect(resObj?.output);
    if (direct) return direct;
  } catch { /* ignore */ }
  try {
    const nested = collect((resObj?.response as Record<string, unknown>)?.output);
    if (nested) return nested;
  } catch { /* ignore */ }
  return '';
}

function extractChatReasoningSummary(res: unknown): string {
  try {
    const resObj = res as Record<string, unknown>;
    // Check for top-level reasoning field first
    const topLevelReasoning = collectChatReasoningContent(resObj?.reasoning);
    if (topLevelReasoning) return topLevelReasoning;

    const choices = Array.isArray(resObj?.choices) ? resObj.choices : [];
    if (!choices.length) return '';
    const summaryByIndex = new Map<number, string>();
    for (const choice of choices as Array<Record<string, unknown>>) {
      const idx = Number.isFinite(Number(choice?.index)) ? Number(choice.index) : summaryByIndex.size;
      const messageSummary = collectChatReasoningContent((choice?.message as Record<string, unknown>)?.reasoning_content) || collectChatReasoningContent((choice?.message as Record<string, unknown>)?.reasoning);
      const deltaSummary = collectChatReasoningContent((choice?.delta as Record<string, unknown>)?.reasoning_content) || collectChatReasoningContent((choice?.delta as Record<string, unknown>)?.reasoning);
      const combined = messageSummary || deltaSummary;
      if (combined) summaryByIndex.set(idx, combined);
    }
    if (!summaryByIndex.size) return '';
    const ordered = Array.from(summaryByIndex.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([, text]) => (typeof text === 'string' ? text : ''))
      .filter(Boolean);
    if (!ordered.length) return '';
    const joined = ordered.join('\n\n\n');
    return joined.replace(/\n{4,}/g, '\n\n\n');
  } catch { /* ignore */ }
  return '';
}

