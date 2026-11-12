// ============================================================================
// Responses API provider adapter (OpenAI /responses)
// Handles streaming events, web search, code interpreter, shell, image
// generation and MCP; reasoning and tool calls are reported as activity steps.
// ============================================================================

import { toIntOrNull, toClampedNumber } from '../../utils/numbers.js';
import { parseMcpAllowedTools } from '../../utils/mcp.js';
import { ActivityLog, prettyJson } from '../activity.js';
import { browserToolNames, browserToolSpecs } from '../browserTools.js';
import { runToolLoop, type ToolRound } from '../toolLoop.js';
import {
  accountTag,
  ApiHttpError,
  buildOpenRouterProvider,
  createAbort,
  createSseJsonLineProcessor,
  ensureOkResponse,
  extractOutputText,
  labelMcpServers,
  nativeData,
  plainTurns,
  readSseLines,
  sortModels,
  throwIfErrorBody,
  type ProviderAdapter,
  type ProviderRequestContext,
} from '../core.js';
import type {
  GenerationResponse,
  WebSearchCitation,
  WebSearchSource,
  GeneratedImage,
  ActivityStep,
  NativeTurn,
} from '../../types/index.js';

// ============================================================================
// Request building
// ============================================================================

/**
 * Requests are made with `store: false`, so nothing is kept on OpenAI's side
 * and earlier replies go back in full: reasoning carries its encrypted
 * content instead of pointing at a stored item.
 */
export interface ResponsesRequestOptions {
  /** Ask for reasoning's encrypted content (models without reasoning refuse it). */
  encryptedReasoning: boolean;
  /** Send earlier replies' reasoning back. */
  replayReasoning: boolean;
  /** Ask for the sources each web search found (some endpoints refuse it). */
  searchSources: boolean;
}

const DEFAULT_REQUEST_OPTIONS: ResponsesRequestOptions = { encryptedReasoning: true, replayReasoning: true, searchSources: true };

const SEARCH_SOURCES_INCLUDE = 'web_search_call.action.sources';

/**
 * Request input: earlier replies go back as the output items they came as
 * (reasoning, tool calls, messages with their phase), in their original
 * order; the API leaves out reasoning a different model family cannot use.
 */
export function buildResponsesInput(
  ctx: ProviderRequestContext,
  options: ResponsesRequestOptions = DEFAULT_REQUEST_OPTIONS,
  extra: Item[] = [],
): unknown {
  if (!Array.isArray(ctx.input)) {
    return extra.length ? [{ role: 'user', content: ctx.input }, ...extra] : ctx.input;
  }
  const account = accountTag(ctx.apiKey);
  const functions = browserToolNames(ctx.tools.browserTools);
  const input: unknown[] = [];
  for (const message of ctx.input) {
    const data = message.role === 'assistant' ? nativeData(message, 'responses', ctx.baseURL) : undefined;
    const reasoningUsable = options.replayReasoning && message.native?.account === account;
    const items = Array.isArray(data) ? withSearchNote(turnItems(data as Item[], reasoningUsable, functions)) : [];
    if (items.length) {
      input.push(...items);
    } else {
      for (const turn of plainTurns(message)) input.push({ role: turn.role, content: turn.content });
    }
  }
  input.push(...extra);
  return input;
}

/**
 * One earlier reply's items as they can go back. Reasoning only decrypts for
 * the organization it was made for, and a reply stored before `store: false`
 * may hold reasoning without encrypted content; browser tool calls only go
 * back while the request still offers those tools. Otherwise only the
 * reply's messages go back, without the ids that tie them to the rest.
 */
function turnItems(items: Item[], reasoningUsable: boolean, functions: ReadonlySet<string> = new Set()): Item[] {
  const kept = items.filter(item => item && typeof item.type === 'string' && !isImageGenerationItemType(item.type));
  const reasoning = kept.filter(item => item.type === 'reasoning');
  const callsUsable = kept.every(item => item.type !== 'function_call' || functions.has(str(item.name)));
  if (!reasoning.length && callsUsable) return kept;
  if (callsUsable && reasoningUsable && reasoning.every(item => str(item.encrypted_content))) return kept;
  return kept
    .filter(item => item.type === 'message')
    .map(({ id: _id, ...item }) => item);
}

/** A web search call that went back without the sources it found. */
function isSourcelessSearch(item: Item): boolean {
  if (item.type !== 'web_search_call') return false;
  const action = item.action && typeof item.action === 'object' ? item.action as Item : {};
  // Opening a page or searching in one names its page; only searches lose their results.
  if (action.type === 'open_page' || action.type === 'find_in_page') return false;
  return !(Array.isArray(action.sources) && action.sources.length);
}

/**
 * Web search results stay on the provider's side, and a search call holds
 * them only when its sources were asked for. A call without them reads to
 * the model as a search that found nothing, so the model takes the answer
 * built on it for a guess. Such calls go back as a note naming the searches
 * and the pages the reply cited instead.
 */
export function withSearchNote(items: Item[]): Item[] {
  const searches = items.filter(isSourcelessSearch);
  if (!searches.length) return items;
  const queries = new Set<string>();
  for (const call of searches) {
    const action = call.action && typeof call.action === 'object' ? call.action as Item : {};
    const list = Array.isArray(action.queries) ? action.queries : [action.query];
    for (const query of list) if (typeof query === 'string' && query.trim()) queries.add(query.trim());
  }
  const cited = new Set<string>();
  for (const item of items) {
    if (item.type !== 'message' || !Array.isArray(item.content)) continue;
    for (const part of item.content as Item[]) {
      if (!Array.isArray(part?.annotations)) continue;
      for (const note of part.annotations as Item[]) {
        if (note?.type === 'url_citation' && str(note.url)) cited.add(str(note.url));
      }
    }
  }
  const lines = [
    `Your next reply used web search${queries.size ? ` (${[...queries].map(q => JSON.stringify(q)).join(', ')})` : ''}, and the searches completed.`,
    'Their results are not kept in this history, so their absence does not mean they found nothing.',
  ];
  if (cited.size) lines.push(`Pages it cited from the results: ${[...cited].join(', ')}`);
  return [
    { role: 'developer', content: lines.join(' ') },
    ...items.filter(item => !isSourcelessSearch(item)),
  ];
}

/**
 * A finished response's output items as they are kept for later turns.
 * Nothing is stored on OpenAI's side, so generated images (kept with the
 * chat) have no item to point back at and are left out.
 */
export function replayItems(output: unknown): Item[] | undefined {
  if (!Array.isArray(output)) return undefined;
  const items = (output as Item[]).filter(item => item && typeof item === 'object'
    && typeof item.type === 'string' && !isImageGenerationItemType(item.type));
  return items.length ? items : undefined;
}

function nativeTurn(ctx: ProviderRequestContext, text: string, output: unknown): NativeTurn | undefined {
  const items = replayItems(output);
  return items
    ? { api: 'responses', endpoint: ctx.baseURL, model: ctx.model, account: accountTag(ctx.apiKey), text, data: items }
    : undefined;
}

export function buildResponsesRequest(
  ctx: ProviderRequestContext,
  options: ResponsesRequestOptions = DEFAULT_REQUEST_OPTIONS,
  extra: Item[] = [],
): Record<string, unknown> {
  const request: Record<string, unknown> = {
    model: ctx.model,
    input: buildResponsesInput(ctx, options, extra),
    store: false,
  };
  const include: string[] = [];
  if (options.encryptedReasoning) include.push('reasoning.encrypted_content');
  if (options.searchSources && ctx.tools.webSearch?.enabled) include.push(SEARCH_SOURCES_INCLUDE);
  if (include.length) request.include = include;

  const tokens = toIntOrNull(ctx.params.maxOutputTokens, { belowMin: 'unset' });
  if (tokens != null) request.max_output_tokens = tokens;
  const topPVal = toClampedNumber(ctx.params.topP, 0, 1);
  if (topPVal != null) request.top_p = topPVal;
  const tempVal = toClampedNumber(ctx.params.temperature, 0, 2);
  if (tempVal != null) request.temperature = tempVal;

  const { reasoningEffort, reasoningSummary, textVerbosity, thinkingEnabled, thinkingBudgetTokens } = ctx.params;
  const reasoningOptions: Record<string, string> = {};
  if (typeof reasoningEffort === 'string' && reasoningEffort && reasoningEffort !== 'default') {
    reasoningOptions.effort = reasoningEffort;
  }
  if (typeof reasoningSummary === 'string' && reasoningSummary && reasoningSummary !== 'none') {
    reasoningOptions.summary = reasoningSummary;
  }
  if (Object.keys(reasoningOptions).length) {
    request.reasoning = reasoningOptions;
  }
  if (typeof textVerbosity === 'string' && textVerbosity && textVerbosity !== 'none') {
    request.text = { verbosity: textVerbosity };
  }
  const thinkingBudget = toIntOrNull(thinkingBudgetTokens, { belowMin: 'unset' });
  if (thinkingEnabled) {
    const thinkingConfig: { type: string; budget_tokens?: number } = { type: 'enabled' };
    if (thinkingBudget != null) thinkingConfig.budget_tokens = thinkingBudget;
    request.thinking = thinkingConfig;
    request.extra_body = { ...(request.extra_body as object || {}), thinking: thinkingConfig };
  }

  const tools = buildTools(ctx);
  if (tools.length > 0) {
    request.tools = tools;
  }

  const provider = buildOpenRouterProvider(ctx.params);
  if (provider) request.provider = provider;
  return request;
}

function buildTools(ctx: ProviderRequestContext): Record<string, unknown>[] {
  const { webSearch, codeInterpreter, shell, imageGeneration, mcpServers } = ctx.tools;
  const tools: Record<string, unknown>[] = [];

  // Web Search tool
  if (webSearch?.enabled) {
    const webSearchTool: Record<string, unknown> = { type: 'web_search' };

    // Add domain filtering if specified
    if (webSearch.filters?.allowed_domains?.length) {
      webSearchTool.filters = { allowed_domains: webSearch.filters.allowed_domains };
    }

    // Add user location if specified
    if (webSearch.user_location) {
      const loc: Record<string, string> = { type: 'approximate' };
      if (webSearch.user_location.country) loc.country = webSearch.user_location.country;
      if (webSearch.user_location.city) loc.city = webSearch.user_location.city;
      if (webSearch.user_location.region) loc.region = webSearch.user_location.region;
      if (webSearch.user_location.timezone) loc.timezone = webSearch.user_location.timezone;
      webSearchTool.user_location = loc;
    }

    // Add external_web_access if explicitly set to false
    if (webSearch.external_web_access === false) {
      webSearchTool.external_web_access = false;
    }

    tools.push(webSearchTool);
  }

  // Code Interpreter tool
  if (codeInterpreter?.enabled) {
    const container: Record<string, unknown> = { type: 'auto' };

    if (codeInterpreter.network_policy) {
      if (codeInterpreter.network_policy.type === 'allowlist' && codeInterpreter.network_policy.allowed_domains?.length) {
        container.network_policy = {
          type: 'allowlist',
          allowed_domains: codeInterpreter.network_policy.allowed_domains,
        };
      } else if (codeInterpreter.network_policy.type === 'disabled') {
        container.network_policy = { type: 'disabled' };
      }
    }

    tools.push({ type: 'code_interpreter', container });
  }

  // Shell tool
  if (shell?.enabled) {
    const environment: Record<string, unknown> = { type: 'container_auto' };

    if (shell.network_policy) {
      if (shell.network_policy.type === 'allowlist' && shell.network_policy.allowed_domains?.length) {
        environment.network_policy = {
          type: 'allowlist',
          allowed_domains: shell.network_policy.allowed_domains,
        };
      } else if (shell.network_policy.type === 'disabled') {
        environment.network_policy = { type: 'disabled' };
      }
    }

    tools.push({ type: 'shell', environment });
  }

  // Image Generation tool
  if (imageGeneration?.enabled) {
    const imageGenTool: Record<string, unknown> = { type: 'image_generation' };
    if (imageGeneration.model) {
      imageGenTool.model = imageGeneration.model;
    }
    tools.push(imageGenTool);
  }

  // MCP tools
  for (const { server, label } of labelMcpServers(mcpServers)) {
    const tool: Record<string, unknown> = {
      type: 'mcp',
      server_label: label,
      server_url: server.url,
      require_approval: 'never',
    };
    if (server.authorization) tool.authorization = server.authorization;
    const allowedTools = parseMcpAllowedTools(server.allowedTools);
    if (allowedTools.length) tool.allowed_tools = allowedTools;
    tools.push(tool);
  }

  // Browser tools, which the app runs itself
  for (const spec of browserToolSpecs(ctx.tools.browserTools)) {
    tools.push({ type: 'function', name: spec.name, description: spec.description, parameters: spec.parameters, strict: false });
  }

  return tools;
}

// ============================================================================
// Response output extraction
// ============================================================================

export function extractWebSearchResult(res: unknown): { citations: WebSearchCitation[]; sources: WebSearchSource[] } | undefined {
  const citations: WebSearchCitation[] = [];
  const sources: WebSearchSource[] = [];

  const processOutput = (output: unknown): void => {
    if (!Array.isArray(output)) return;
    for (const item of output as Array<Record<string, unknown>>) {
      collectCitationsFromMessageItem(item, citations);
      collectSourcesFromWebSearchItem(item, sources);
    }
  };

  const resObj = res as Record<string, unknown>;
  try {
    processOutput(resObj?.output);
  } catch { /* ignore */ }
  try {
    processOutput((resObj?.response as Record<string, unknown>)?.output);
  } catch { /* ignore */ }

  if (citations.length === 0 && sources.length === 0) return undefined;
  return { citations, sources };
}

function collectCitationsFromMessageItem(item: Record<string, unknown>, citations: WebSearchCitation[]): void {
  if (item?.type !== 'message' || !item?.content) return;
  const content = item.content as Array<Record<string, unknown>>;
  if (!Array.isArray(content)) return;
  for (const part of content) {
    if (part?.annotations && Array.isArray(part.annotations)) {
      for (const ann of part.annotations as Array<Record<string, unknown>>) {
        if (ann?.type === 'url_citation' && typeof ann.url === 'string') {
          citations.push({
            type: 'url_citation',
            start_index: typeof ann.start_index === 'number' ? ann.start_index : 0,
            end_index: typeof ann.end_index === 'number' ? ann.end_index : 0,
            url: ann.url,
            title: typeof ann.title === 'string' ? ann.title : '',
          });
        }
      }
    }
  }
}

function collectSourcesFromWebSearchItem(item: Record<string, unknown>, sources: WebSearchSource[]): void {
  if (item?.type !== 'web_search_call' || !item?.action) return;
  const action = item.action as Record<string, unknown>;
  if (!action?.sources || !Array.isArray(action.sources)) return;
  for (const src of action.sources as Array<Record<string, unknown>>) {
    if (src?.url && typeof src.url === 'string') {
      const exists = sources.some(s => s.url === src.url);
      if (!exists) {
        sources.push({
          url: src.url,
          title: typeof src.title === 'string' ? src.title : undefined,
          type: typeof src.type === 'string' ? src.type : undefined,
        });
      }
    }
  }
}

// Image generation output items vary by provider: OpenAI uses
// "image_generation_call", OpenRouter-style proxies use
// "openrouter:image_generation" (with the data in result/imageUrl).
function isImageGenerationItemType(type: unknown): boolean {
  return typeof type === 'string' && type.includes('image_generation');
}

function imageResultFromItem(item: Record<string, unknown> | undefined): unknown {
  if (!item) return undefined;
  return item.result ?? item.imageUrl ?? item.image_url;
}

function revisedPromptFromItem(item: Record<string, unknown> | undefined): string | undefined {
  const raw = item?.revised_prompt ?? item?.revisedPrompt ?? item?.prompt;
  return typeof raw === 'string' && raw ? raw : undefined;
}

// Image results may arrive as raw base64 or as a data URL
// (e.g. "data:image/png;base64,...."). Normalize to raw base64 + mime type.
function parseImageResult(result: unknown): { data: string; mimeType?: string } | null {
  if (typeof result !== 'string' || !result) return null;
  const match = /^data:([^;,]*)(?:;base64)?,([\s\S]*)$/.exec(result);
  if (match) {
    const data = match[2] || '';
    if (!data) return null;
    return { data, mimeType: match[1] || 'image/png' };
  }
  return { data: result };
}

export function extractGeneratedImages(res: unknown): GeneratedImage[] | undefined {
  const images: GeneratedImage[] = [];

  const processOutput = (output: unknown): void => {
    if (!Array.isArray(output)) return;
    for (const item of output as Array<Record<string, unknown>>) {
      // Extract generated images from image_generation_call
      if (isImageGenerationItemType(item?.type)) {
        const parsed = parseImageResult(imageResultFromItem(item));
        const id = item.id as string | undefined;
        const revisedPrompt = revisedPromptFromItem(item);
        if (parsed) {
          const exists = images.some(img => img.id === id);
          if (!exists) {
            images.push({
              id: id || `img_${Date.now()}_${images.length}`,
              data: parsed.data,
              mimeType: parsed.mimeType,
              revisedPrompt: revisedPrompt,
            });
          }
        }
      }
    }
  };

  const resObj = res as Record<string, unknown>;
  try {
    processOutput(resObj?.output);
  } catch { /* ignore */ }
  try {
    processOutput((resObj?.response as Record<string, unknown>)?.output);
  } catch { /* ignore */ }

  if (images.length === 0) return undefined;
  return images;
}

// ============================================================================
// Output items -> activity steps
// ============================================================================

type Item = Record<string, unknown>;

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function errorText(error: unknown): string {
  if (typeof error === 'string') return error;
  if (!error || typeof error !== 'object') return '';
  const message = (error as Item).message;
  if (typeof message === 'string' && message) return message;
  try { return JSON.stringify(error); } catch { return 'The call failed.'; }
}

const TOOL_ITEM_KINDS: Record<string, ActivityStep['kind']> = {
  web_search_call: 'search',
  code_interpreter_call: 'code',
  shell_call: 'shell',
  mcp_call: 'mcp',
  mcp_list_tools: 'mcp_list',
};

function toolItemKind(type: unknown): ActivityStep['kind'] | null {
  if (typeof type !== 'string') return null;
  if (isImageGenerationItemType(type)) return 'image';
  return TOOL_ITEM_KINDS[type] ?? null;
}

function itemStatus(item: Item, error: string): ActivityStep['status'] {
  const status = str(item.status);
  if (error || status === 'failed' || status === 'incomplete') return 'failed';
  return status === 'completed' ? 'done' : 'running';
}

/** The activity step for a tool output item, or null for other items. */
export function stepFromOutputItem(item: Item): Omit<ActivityStep, 'id'> | null {
  const kind = toolItemKind(item?.type);
  if (!kind) return null;

  if (kind === 'search') {
    const action = item.action && typeof item.action === 'object' ? item.action as Item : {};
    const status = itemStatus(item, '');
    // The same item type also covers opening a page and searching inside it.
    if (action.type === 'open_page' || action.type === 'find_in_page') {
      return { kind: 'fetch', status, subject: str(action.url) || undefined, input: str(action.pattern) || undefined };
    }
    const queries = Array.isArray(action.queries) ? action.queries.filter((q): q is string => typeof q === 'string') : [];
    const sources = Array.isArray(action.sources)
      ? (action.sources as Item[]).map(src => str(src?.url)).filter(Boolean)
      : [];
    return {
      kind,
      status,
      subject: str(action.query) || queries[0] || undefined,
      input: queries.length > 1 ? queries.join('\n') : undefined,
      output: sources.join('\n') || undefined,
    };
  }

  if (kind === 'code') {
    const outputs = Array.isArray(item.outputs) ? item.outputs as Item[] : [];
    const logs = outputs.map(out => str(out?.logs) || str(out?.url)).filter(Boolean).join('\n');
    return { kind, status: itemStatus(item, ''), input: str(item.code) || undefined, output: logs || undefined };
  }

  if (kind === 'shell') {
    const action = item.action && typeof item.action === 'object' ? item.action as Item : {};
    const commands = Array.isArray(action.commands) ? action.commands.filter((c): c is string => typeof c === 'string') : [];
    return { kind, status: itemStatus(item, ''), subject: commands[0] || undefined, input: commands.join('\n') || undefined };
  }

  if (kind === 'image') {
    return { kind, status: itemStatus(item, ''), input: revisedPromptFromItem(item) };
  }

  const server = str(item.server_label) || undefined;
  const error = errorText(item.error);
  if (kind === 'mcp_list') {
    const tools = Array.isArray(item.tools) ? (item.tools as Item[]).map(tool => str(tool?.name)).filter(Boolean) : [];
    return {
      kind,
      status: itemStatus(item, error),
      server,
      subject: tools.length ? `${tools.length} ${tools.length === 1 ? 'tool' : 'tools'}` : undefined,
      output: tools.join('\n') || undefined,
      error: error || undefined,
    };
  }
  return {
    kind,
    status: itemStatus(item, error),
    server,
    subject: str(item.name) || undefined,
    input: prettyJson(str(item.arguments)) || undefined,
    output: prettyJson(str(item.output)) || undefined,
    error: error || undefined,
  };
}

/** Output of a shell call arrives as its own item, tied back by call id. */
function shellOutputText(item: Item): string {
  const chunks = Array.isArray(item.output) ? item.output as Item[] : [];
  return chunks
    .flatMap(chunk => [str(chunk?.stdout), str(chunk?.stderr)])
    .filter(text => text.trim())
    .join('\n');
}

/**
 * Writes a finished response's output into the log: one thinking step per
 * reasoning summary part, one step per tool call, in output order.
 */
export function logOutputItems(log: ActivityLog, output: unknown): void {
  if (!Array.isArray(output)) return;
  const shellStepByCallId = new Map<string, string>();
  (output as Item[]).forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    const id = str(item.id) || `item-${index}`;
    if (item.type === 'reasoning') {
      const parts = [
        ...(Array.isArray(item.summary) ? item.summary as Item[] : []),
        ...(Array.isArray(item.content) ? item.content as Item[] : []),
      ];
      parts.forEach((part, partIndex) => {
        const text = str(part?.text);
        if (text) log.set(`${id}:${partIndex}`, { kind: 'thinking', status: 'done', text }, index + (partIndex + 1) / 1000);
      });
      return;
    }
    if (item.type === 'shell_call_output') {
      const stepId = shellStepByCallId.get(str(item.call_id));
      const text = shellOutputText(item);
      if (stepId && text) log.set(stepId, { output: text });
      return;
    }
    const step = stepFromOutputItem(item);
    if (!step) return;
    // Anything still marked in progress in a finished response is done.
    log.set(id, { ...step, status: step.status === 'running' ? 'done' : step.status }, index);
    if (item.type === 'shell_call' && str(item.call_id)) shellStepByCallId.set(str(item.call_id), id);
  });
}

/** Activity steps of a complete (non-streamed) response. */
export function extractActivity(res: unknown): ActivityStep[] {
  const resObj = res as Item;
  const output = Array.isArray(resObj?.output)
    ? resObj.output
    : (resObj?.response as Item | undefined)?.output;
  const log = new ActivityLog();
  logOutputItems(log, output);
  return log.settle();
}

/**
 * A response that stops early (token limit, content filter) ends with status
 * "incomplete". Partial text is still a usable reply, so this only becomes an
 * error when there is nothing to show.
 */
function incompleteResponseError(response: unknown): Error | null {
  const obj = response && typeof response === 'object' ? response as Record<string, unknown> : null;
  if (obj?.status !== 'incomplete') return null;
  const details = obj.incomplete_details && typeof obj.incomplete_details === 'object'
    ? obj.incomplete_details as Record<string, unknown>
    : null;
  const reason = typeof details?.reason === 'string' ? details.reason : '';
  if (reason === 'max_output_tokens') {
    return new Error('The reply hit the max output tokens limit before any text was produced. Raise the limit and regenerate.');
  }
  if (reason === 'content_filter') {
    return new Error('The reply was blocked by the provider\'s content filter.');
  }
  return new Error(reason ? `The reply was incomplete (${reason}).` : 'The reply was incomplete.');
}

// ============================================================================
// Streaming
// ============================================================================

interface RoundReply {
  reply: GenerationResponse;
  /** The response's output items. */
  output: unknown;
}

async function respondStreaming(ctx: ProviderRequestContext, options: ResponsesRequestOptions, extra: Item[]): Promise<RoundReply> {
  const { onEvent, onTextDelta, onActivity, onWebSearchResult, onImageGenerated } = ctx.callbacks;

  const abortController = createAbort(ctx.provideAbort);

  const response = await fetch(`${ctx.baseURL}/responses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ctx.apiKey}`,
    },
    body: JSON.stringify({ ...buildResponsesRequest(ctx, options, extra), stream: true }),
    signal: abortController.signal,
  });
  await ensureOkResponse(response, 'API error');

  let full = '';
  let completed = false;
  let incompleteError: Error | null = null;
  let finalOutput: unknown;
  const log = new ActivityLog(onActivity);
  // Web search tracking
  const webSearchCitations: WebSearchCitation[] = [];
  const webSearchSources: WebSearchSource[] = [];
  let webSearchResultDelivered = false;
  // Image generation tracking
  const generatedImages: GeneratedImage[] = [];
  let imageGenerationDelivered = false;
  const collectGeneratedImage = (source: { result: unknown; id?: string; revisedPrompt?: string }): void => {
    const parsed = parseImageResult(source.result);
    if (!parsed) return;
    if (source.id && generatedImages.some(img => img.id === source.id)) return;
    generatedImages.push({
      id: source.id || `img_${Date.now()}_${generatedImages.length}`,
      data: parsed.data,
      mimeType: parsed.mimeType,
      revisedPrompt: source.revisedPrompt,
    });
  };

  const outputIndexOf = (event: Item): number | undefined =>
    (Number.isFinite(Number(event?.output_index)) && event.output_index != null ? Number(event.output_index) : undefined);

  // Reasoning arrives as summary parts (and, from some providers, raw
  // reasoning text); each part is its own thinking step.
  const reasoningStepId = (event: Item, partKey: 'summary_index' | 'content_index'): string => {
    const part = Number.isFinite(Number(event?.[partKey])) ? Number(event[partKey]) : 0;
    return `${str(event.item_id) || `reasoning-${outputIndexOf(event) ?? 0}`}:${partKey === 'summary_index' ? '' : 'c'}${part}`;
  };
  const reasoningOrder = (event: Item, partKey: 'summary_index' | 'content_index'): number | undefined => {
    const index = outputIndexOf(event);
    return index == null ? undefined : index + (Number(event?.[partKey] ?? 0) + 1) / 1000;
  };

  // Tool lifecycle events ("response.<tool>.<phase>") from providers that
  // do not send the output item itself until the end.
  const TOOL_EVENT = /^response\.(web_search_call|code_interpreter_call|shell_call|image_generation_call|mcp_call|mcp_list_tools)\.([a-z_]+)$/;
  const toolStepId = (event: Item, family: string): string =>
    str(event.item_id) || str(event.id) || `${family}-${outputIndexOf(event) ?? 0}`;

  const upsertToolItem = (item: Item | undefined, event: Item): void => {
    if (!item) return;
    const step = stepFromOutputItem(item);
    const id = str(item.id);
    if (!step || !id) return;
    log.set(id, step, outputIndexOf(event));
  };

  const processEvent = (event: Record<string, unknown>) => {
    const t = (event?.type || event?.event || '') as string;
    const item = event?.item && typeof event.item === 'object' ? event.item as Item : undefined;
    const toolEvent = TOOL_EVENT.exec(t);

    if (t === 'response.output_text.delta') {
      const delta = event?.delta || '';
      if (typeof delta === 'string' && delta) {
        full += delta;
        try { onTextDelta?.(full, delta, event); } catch { /* ignore */ }
      }
    } else if (t === 'response.reasoning_summary_text.delta' || t === 'response.reasoning_text.delta') {
      const partKey = t === 'response.reasoning_text.delta' ? 'content_index' : 'summary_index';
      log.append(reasoningStepId(event, partKey), 'text', str(event.delta), { kind: 'thinking', status: 'running' }, reasoningOrder(event, partKey));
    } else if (t === 'response.reasoning_summary_text.done' || t === 'response.reasoning_text.done') {
      const partKey = t === 'response.reasoning_text.done' ? 'content_index' : 'summary_index';
      const text = str(event.text);
      log.set(reasoningStepId(event, partKey), { kind: 'thinking', status: 'done', ...(text ? { text } : {}) }, reasoningOrder(event, partKey));
    } else if (t === 'response.output_item.added') {
      upsertToolItem(item, event);
    } else if (t === 'response.output_item.done') {
      upsertToolItem(item, event);
      if (isImageGenerationItemType(item?.type)) {
        collectGeneratedImage({
          result: imageResultFromItem(item),
          id: typeof item?.id === 'string' ? item.id : undefined,
          revisedPrompt: revisedPromptFromItem(item),
        });
      }
    } else if (t === 'response.code_interpreter_call_code.delta' || t === 'response.mcp_call_arguments.delta') {
      const id = str(event.item_id);
      if (id) log.append(id, 'input', str(event.delta), { kind: t.includes('mcp') ? 'mcp' : 'code', status: 'running' }, outputIndexOf(event));
    } else if (t === 'response.code_interpreter_call_code.done' || t === 'response.mcp_call_arguments.done') {
      const id = str(event.item_id);
      const input = t.includes('mcp') ? prettyJson(str(event.arguments)) : str(event.code);
      if (id && input) log.set(id, { kind: t.includes('mcp') ? 'mcp' : 'code', input }, outputIndexOf(event));
    } else if (toolEvent || t === 'web_search_call' || t === 'image_generation_call') {
      const family = toolEvent?.[1] ?? t;
      const phase = toolEvent?.[2] ?? 'completed';
      const id = toolStepId(event, family);
      const kind = toolItemKind(family) ?? 'tool';
      const fromItem = item ? stepFromOutputItem(item) : null;
      const error = phase === 'failed' ? errorText(item?.error ?? event.error) : '';
      const status = phase === 'failed' ? 'failed' : phase === 'completed' ? 'done' : 'running';
      // A failure reported earlier is not overwritten by a later "completed".
      const keepFailed = log.get(id)?.status === 'failed';
      log.set(id, {
        ...(log.has(id) ? {} : { kind }),
        ...(fromItem ?? {}),
        status: keepFailed ? 'failed' : status,
        ...(error ? { error } : {}),
      }, outputIndexOf(event));

      if (family === 'web_search_call' && phase === 'completed') {
        const action = (item?.action || event?.action) as Record<string, unknown> | undefined;
        if (action?.sources && Array.isArray(action.sources)) {
          for (const src of action.sources as Array<Record<string, unknown>>) {
            if (src?.url && typeof src.url === 'string') {
              webSearchSources.push({ url: src.url, title: typeof src.title === 'string' ? src.title : undefined, type: typeof src.type === 'string' ? src.type : undefined });
            }
          }
        }
      } else if (family === 'image_generation_call' && phase === 'completed') {
        collectGeneratedImage({
          result: imageResultFromItem(item) ?? imageResultFromItem(event),
          id: (item?.id || event?.id || event?.item_id) as string | undefined,
          revisedPrompt: revisedPromptFromItem(item) ?? revisedPromptFromItem(event),
        });
      }
    // ---- Response completion ----
    } else if (t === 'response.completed' || t === 'response.incomplete' || t === 'response.text.done' || t === 'response.done') {
      completed = true;
      incompleteError = incompleteResponseError(event?.response);
      // Extract citations and sources from completed response
      const response = event?.response as Record<string, unknown> | undefined;
      const output = response?.output as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(output)) finalOutput = output;
      if (Array.isArray(output)) {
        for (const outItem of output) {
          collectCitationsFromMessageItem(outItem, webSearchCitations);
          collectSourcesFromWebSearchItem(outItem, webSearchSources);
          // Extract generated images from image_generation_call
          if (isImageGenerationItemType(outItem?.type)) {
            collectGeneratedImage({
              result: imageResultFromItem(outItem),
              id: typeof outItem.id === 'string' ? outItem.id : undefined,
              revisedPrompt: revisedPromptFromItem(outItem),
            });
          }
        }
        // The finished output is the authoritative record of the tool calls:
        // steps pieced together from lifecycle events give way to it.
        if (output.some(outItem => toolItemKind(outItem?.type))) {
          for (const id of log.ids()) {
            if (log.get(id)?.kind !== 'thinking') log.remove(id);
          }
        }
        // Streamed reasoning is kept as it arrived; the output only fills in
        // what was not streamed.
        const streamedThinking = log.ids().some(id => log.get(id)?.kind === 'thinking');
        logOutputItems(log, streamedThinking ? output.filter(outItem => outItem?.type !== 'reasoning') : output);
      }
      // Deliver web search result if we have citations or sources
      if ((webSearchCitations.length > 0 || webSearchSources.length > 0) && !webSearchResultDelivered) {
        try {
          onWebSearchResult?.({ citations: webSearchCitations, sources: webSearchSources });
          webSearchResultDelivered = true;
        } catch { /* ignore */ }
      }
      // Deliver generated images if we have any
      if (generatedImages.length > 0 && !imageGenerationDelivered) {
        try {
          onImageGenerated?.(generatedImages);
          imageGenerationDelivered = true;
        } catch { /* ignore */ }
      }
    }
  };

  const processLine = createSseJsonLineProcessor(processEvent, onEvent);
  await readSseLines(response, processLine, () => completed);
  if (!completed) throw new Error('The reply stream was interrupted before it finished. Regenerate to try again.');
  if (incompleteError && !full) throw incompleteError;

  // Final delivery of web search results if not already done
  if ((webSearchCitations.length > 0 || webSearchSources.length > 0) && !webSearchResultDelivered) {
    try {
      onWebSearchResult?.({ citations: webSearchCitations, sources: webSearchSources });
    } catch { /* ignore */ }
  }
  // Final delivery of generated images if not already done
  if (generatedImages.length > 0 && !imageGenerationDelivered) {
    try {
      onImageGenerated?.(generatedImages);
    } catch { /* ignore */ }
  }
  return {
    reply: {
      text: full,
      activity: log.settle(),
      webSearchResult: (webSearchCitations.length > 0 || webSearchSources.length > 0)
        ? { citations: webSearchCitations, sources: webSearchSources }
        : undefined,
      generatedImages: generatedImages.length > 0 ? generatedImages : undefined,
      native: nativeTurn(ctx, full, finalOutput),
    },
    output: finalOutput,
  };
}

// ============================================================================
// Non-streaming
// ============================================================================

async function respondOnce(ctx: ProviderRequestContext, options: ResponsesRequestOptions, extra: Item[]): Promise<RoundReply> {
  const { onWebSearchResult, onImageGenerated } = ctx.callbacks;
  const abortController = createAbort(ctx.provideAbort);

  const response = await fetch(`${ctx.baseURL}/responses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ctx.apiKey}`,
    },
    body: JSON.stringify(buildResponsesRequest(ctx, options, extra)),
    signal: abortController.signal,
  });
  await ensureOkResponse(response, 'API error');

  const res = await response.json();
  throwIfErrorBody(res);
  const text = extractOutputText(res);
  if (!text) {
    const incompleteError = incompleteResponseError(res);
    if (incompleteError) throw incompleteError;
  }
  const webSearchResult = extractWebSearchResult(res);
  const generatedImages = extractGeneratedImages(res);
  if (webSearchResult && (webSearchResult.citations.length > 0 || webSearchResult.sources.length > 0)) {
    try { onWebSearchResult?.(webSearchResult); } catch { /* ignore */ }
  }
  if (generatedImages && generatedImages.length > 0) {
    try { onImageGenerated?.(generatedImages); } catch { /* ignore */ }
  }
  const output = (res as Item)?.output ?? ((res as Item)?.response as Item | undefined)?.output;
  return {
    reply: { text, activity: extractActivity(res), webSearchResult, generatedImages, native: nativeTurn(ctx, text, output) },
    output,
  };
}

async function listModels({ apiKey, baseURL }: { apiKey: string; baseURL: string }): Promise<string[]> {
  const response = await fetch(`${baseURL}/models`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
    },
  });
  await ensureOkResponse(response, 'API error');

  const res = await response.json();
  const items = Array.isArray(res?.data) ? res.data : [];
  return sortModels(items).map(m => m.id);
}

/** Endpoint and model pairs that refused encrypted reasoning this session (models without reasoning). */
const encryptedReasoningRefusedBy = new Set<string>();
/** Endpoint and model pairs that refused to include web search sources this session. */
const searchSourcesRefusedBy = new Set<string>();

/** Whether the request sends any earlier reasoning back. */
function replaysReasoning(ctx: ProviderRequestContext, options: ResponsesRequestOptions, extra: Item[]): boolean {
  const input = buildResponsesInput(ctx, options, extra);
  return Array.isArray(input) && input.some(item => (item as Item)?.type === 'reasoning');
}

/**
 * Sends the request, stepping back when the API refuses the reasoning parts
 * (a 400 before anything streamed): a model without reasoning refuses the
 * encrypted-content request, and reasoning encrypted for another organization
 * (a key from a different org) cannot be decrypted. Anything else is thrown.
 */
async function respondRound(ctx: ProviderRequestContext, stream: boolean, extra: Item[]): Promise<RoundReply> {
  const modelKey = `${ctx.baseURL}|${ctx.model}`;
  let options: ResponsesRequestOptions = {
    encryptedReasoning: !encryptedReasoningRefusedBy.has(modelKey),
    replayReasoning: true,
    searchSources: !searchSourcesRefusedBy.has(modelKey),
  };
  for (;;) {
    try {
      return await (stream ? respondStreaming(ctx, options, extra) : respondOnce(ctx, options, extra));
    } catch (err) {
      if (!(err instanceof ApiHttpError) || err.status !== 400) throw err;
      if (options.searchSources && ctx.tools.webSearch?.enabled && /web_search_call|sources/i.test(err.message)) {
        searchSourcesRefusedBy.add(modelKey);
        options = { ...options, searchSources: false };
        continue;
      }
      if (!/encrypt|reasoning/i.test(err.message)) throw err;
      if (options.encryptedReasoning && /not supported|unsupported|include/i.test(err.message)) {
        encryptedReasoningRefusedBy.add(modelKey);
        options = { ...options, encryptedReasoning: false };
      } else if (options.replayReasoning && replaysReasoning(ctx, options, extra)) {
        options = { ...options, replayReasoning: false };
      } else {
        throw err;
      }
    }
  }
}

/** Browser tool calls among a response's output items. */
export function functionCalls(output: unknown): ToolRound<Item>['calls'] {
  if (!Array.isArray(output)) return [];
  return (output as Item[])
    .filter(item => item?.type === 'function_call')
    .map(item => ({ id: str(item.call_id), name: str(item.name), arguments: item.arguments }));
}

function steerItems(texts: string[]): Item[] {
  return texts.map(text => ({ type: 'message', role: 'user', content: text }));
}

function respond(ctx: ProviderRequestContext, stream: boolean): Promise<GenerationResponse> {
  return runToolLoop<Item>(ctx, {
    async send(roundCtx, extra) {
      const { reply, output } = await respondRound(roundCtx, stream, extra);
      return { reply, calls: functionCalls(output), turn: replayItems(output) ?? [] };
    },
    // Steering messages follow the outputs, as OpenAI's own steering sends them.
    answer: (answers, steers) => [
      ...answers.map(({ call, output }) => ({ type: 'function_call_output', call_id: call.id, output })),
      ...steerItems(steers),
    ],
    steer: steerItems,
    partial: text => (text ? [{ type: 'message', role: 'assistant', content: text }] : []),
    native: (rounds, final, text) => ({
      api: 'responses',
      endpoint: ctx.baseURL,
      model: ctx.model,
      account: accountTag(ctx.apiKey),
      text,
      data: [...rounds, ...final.turn],
    }),
  });
}

export const responsesAdapter: ProviderAdapter = {
  respond,
  listModels,
};
