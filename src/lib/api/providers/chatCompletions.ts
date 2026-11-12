// ============================================================================
// Chat Completions provider adapter (OpenAI-compatible /chat/completions)
// ============================================================================

import { toIntOrNull, toClampedNumber } from '../../utils/numbers.js';
import { ensureDataUrl } from '../../attachments/mime.js';
import {
  buildOpenRouterProvider,
  collectContentText,
  createAbort,
  createSseJsonLineProcessor,
  ensureOkResponse,
  extractOutputText,
  nativeData,
  normalizeReasoningText,
  plainTurns,
  readSseLines,
  sortModels,
  throwIfErrorBody,
  type ContentPart,
  type ProviderAdapter,
  type ProviderRequestContext,
} from '../core.js';
import { ActivityLog } from '../activity.js';
import { browserToolNames, browserToolSpecs } from '../browserTools.js';
import { runToolLoop, type BrowserToolCall, type ToolRound } from '../toolLoop.js';
import type { ActivityStep, GenerationResponse, NativeTurn, WebSearchCitation, WebSearchResult, WebSearchSource } from '../../types/index.js';

type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'file'; file: { file_data: string; filename: string } };

type ChatMessage = { role: string; content: string | ChatContentPart[] | null } & Record<string, unknown>;

/** Reasoning fields an assistant message can carry back, most complete first. */
const REASONING_FIELDS = ['reasoning_details', 'reasoning_content', 'reasoning'] as const;
type ReasoningFields = Partial<Record<(typeof REASONING_FIELDS)[number], unknown>>;

/**
 * The reasoning a reply came with, in the one field the server used for it:
 * OpenRouter's `reasoning_details` (which keeps signatures and encrypted
 * reasoning, and has to go back unchanged and in order), else
 * `reasoning_content` (DeepSeek, Kimi, Qwen, vLLM; required back on later
 * turns once tools are involved), else plain `reasoning`.
 */
export function pickReasoningFields(message: Record<string, unknown> | undefined): ReasoningFields | undefined {
  if (!message) return undefined;
  const details = message.reasoning_details;
  if (Array.isArray(details) && details.length) return { reasoning_details: details };
  for (const field of ['reasoning_content', 'reasoning'] as const) {
    const value = message[field];
    if (typeof value === 'string' && value) return { [field]: value };
  }
  return undefined;
}

/**
 * Joins streamed `reasoning_details` entries: each delta carries pieces of
 * the entry at its `index`, whose text, summary, encrypted data and
 * signature arrive in parts.
 */
export function mergeReasoningDetails(target: Array<Record<string, unknown>>, deltas: unknown): void {
  if (!Array.isArray(deltas)) return;
  deltas.forEach((delta, position) => {
    if (!delta || typeof delta !== 'object') return;
    const piece = delta as Record<string, unknown>;
    const index = Number.isFinite(Number(piece.index)) ? Number(piece.index) : target.length + position;
    const entry = target.find(item => item.index === index);
    if (!entry) {
      target.push({ ...piece, index });
      return;
    }
    for (const [key, value] of Object.entries(piece)) {
      if (value == null) continue;
      if (typeof value === 'string' && ['text', 'summary', 'data', 'signature'].includes(key) && typeof entry[key] === 'string') {
        entry[key] = `${entry[key] as string}${value}`;
      } else if (entry[key] == null) {
        entry[key] = value;
      }
    }
  });
}

function nativeTurn(ctx: ProviderRequestContext, text: string, fields: ReasoningFields | undefined): NativeTurn | undefined {
  return fields
    ? { api: 'chat_completions', endpoint: ctx.baseURL, model: ctx.model, text, data: fields }
    : undefined;
}

/**
 * A stored reply: its reasoning fields, plus the tool-calling (and steering)
 * turns that led to it and the text of the final turn.
 */
type StoredReply = ReasoningFields & { toolTurns?: ChatMessage[]; finalText?: string };

/**
 * The browser tool turns of a stored reply, when every call in them is to a
 * tool this request still offers; otherwise none go back.
 */
function replayToolTurns(stored: StoredReply | undefined, functions: ReadonlySet<string>): ChatMessage[] {
  const turns = stored?.toolTurns;
  if (!Array.isArray(turns) || !turns.length) return [];
  const usable = turns.every(turn => !Array.isArray(turn?.tool_calls)
    || (turn.tool_calls as Array<{ function?: { name?: unknown } }>).every(call => functions.has(String(call?.function?.name ?? ''))));
  return usable ? turns : [];
}

/** Converts normalized provider input into Chat Completions messages. */
function buildChatMessages(ctx: ProviderRequestContext): ChatMessage[] {
  const input = ctx.input;
  if (!Array.isArray(input)) {
    return typeof input === 'string' && input
      ? [{ role: 'user', content: input }]
      : [];
  }
  const functions = browserToolNames(ctx.tools.browserTools);
  return input.flatMap((message): ChatMessage[] => {
    const { native: _native, ...msg } = message;
    const reasoning = msg.role === 'assistant'
      ? nativeData(message, 'chat_completions', ctx.baseURL) as StoredReply | undefined
      : undefined;
    const fields: Record<string, unknown> = {};
    for (const field of REASONING_FIELDS) {
      if (reasoning && reasoning[field] != null) fields[field] = reasoning[field];
    }
    const before = replayToolTurns(reasoning, functions);
    if (!before.length && message.steers?.length) {
      // Steered replies split into plain-text turns; their content is always text.
      return plainTurns(message).map(turn => ({ role: turn.role, content: turn.content as string }));
    }
    // The earlier turns carry their own text; the final turn carries the rest.
    if (before.length && typeof reasoning?.finalText === 'string' && typeof msg.content === 'string') {
      return [...before, { role: msg.role, content: reasoning.finalText, ...fields }];
    }
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
        return [...before, { role: msg.role, content: contentArray, ...fields }];
      }
    }
    return [...before, { ...(msg as { role: string; content: string }), ...fields }];
  });
}

export function buildChatRequest(ctx: ProviderRequestContext, extra: ChatMessage[] = []): Record<string, unknown> {
  const chatRequest: Record<string, unknown> = { model: ctx.model, messages: [...buildChatMessages(ctx), ...extra] };
  const tokens = toIntOrNull(ctx.params.maxOutputTokens, { belowMin: 'unset' });
  if (tokens != null) chatRequest.max_completion_tokens = tokens;
  const topPVal = toClampedNumber(ctx.params.topP, 0, 1);
  if (topPVal != null) chatRequest.top_p = topPVal;
  const tempVal = toClampedNumber(ctx.params.temperature, 0, 2);
  if (tempVal != null) chatRequest.temperature = tempVal;
  const { reasoningEffort, thinkingEnabled, thinkingBudgetTokens } = ctx.params;
  if (typeof reasoningEffort === 'string' && reasoningEffort && reasoningEffort !== 'default') {
    chatRequest.reasoning_effort = reasoningEffort;
  }
  const thinkingBudget = toIntOrNull(thinkingBudgetTokens, { belowMin: 'unset' });
  if (thinkingEnabled) {
    const thinkingConfig: { type: string; budget_tokens?: number } = { type: 'enabled' };
    if (thinkingBudget != null) thinkingConfig.budget_tokens = thinkingBudget;
    chatRequest.thinking = thinkingConfig;
    chatRequest.extra_body = { ...(chatRequest.extra_body as object || {}), thinking: thinkingConfig };
  }
  const provider = buildOpenRouterProvider(ctx.params);
  if (provider) chatRequest.provider = provider;
  // OpenRouter runs web search itself, for any model.
  if (ctx.openRouter && ctx.tools.webSearch?.enabled) chatRequest.plugins = [{ id: 'web' }];
  const tools = browserToolSpecs(ctx.tools.browserTools)
    .map(spec => ({ type: 'function', function: { name: spec.name, description: spec.description, parameters: spec.parameters } }));
  if (tools.length) chatRequest.tools = tools;
  return chatRequest;
}

// ============================================================================
// Tool calls and web search citations
// ============================================================================

type ToolCallDelta = { index?: unknown; id?: unknown; type?: unknown; function?: { name?: unknown; arguments?: unknown } };
type AssembledCall = { id: string; type: 'function'; function: { name: string; arguments: string } };

/** Joins streamed tool call pieces: each delta adds to the call at its index. */
export function mergeToolCallDeltas(target: AssembledCall[], deltas: unknown): void {
  if (!Array.isArray(deltas)) return;
  deltas.forEach((delta: ToolCallDelta, position) => {
    if (!delta || typeof delta !== 'object') return;
    const index = Number.isFinite(Number(delta.index)) ? Number(delta.index) : position;
    const call = target[index] ??= { id: '', type: 'function', function: { name: '', arguments: '' } };
    if (typeof delta.id === 'string' && delta.id) call.id = delta.id;
    if (typeof delta.function?.name === 'string') call.function.name += delta.function.name;
    if (typeof delta.function?.arguments === 'string') call.function.arguments += delta.function.arguments;
  });
}

function assembledCalls(raw: unknown): AssembledCall[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((call): call is ToolCallDelta => !!call && typeof call === 'object')
    .map((call, index) => ({
      id: typeof call.id === 'string' && call.id ? call.id : `call_${index}`,
      type: 'function' as const,
      function: {
        name: typeof call.function?.name === 'string' ? call.function.name : '',
        arguments: typeof call.function?.arguments === 'string'
          ? call.function.arguments
          : JSON.stringify(call.function?.arguments ?? {}),
      },
    }))
    .filter(call => call.function.name);
}

/** Web search citations (OpenRouter's web plugin) as sources and citations. */
export function collectUrlCitations(annotations: unknown, result: WebSearchResult): void {
  if (!Array.isArray(annotations)) return;
  for (const annotation of annotations as Array<Record<string, unknown>>) {
    if (annotation?.type !== 'url_citation') continue;
    const cite = (annotation.url_citation && typeof annotation.url_citation === 'object'
      ? annotation.url_citation
      : annotation) as Record<string, unknown>;
    const url = typeof cite.url === 'string' ? cite.url : '';
    if (!url) continue;
    const title = typeof cite.title === 'string' ? cite.title : '';
    const citation: WebSearchCitation = {
      type: 'url_citation',
      url,
      title,
      start_index: typeof cite.start_index === 'number' ? cite.start_index : 0,
      end_index: typeof cite.end_index === 'number' ? cite.end_index : 0,
    };
    if (!result.citations.some(c => c.url === url && c.start_index === citation.start_index)) result.citations.push(citation);
    if (!result.sources.some(source => source.url === url)) result.sources.push({ url, title: title || undefined } as WebSearchSource);
  }
}

const SEARCH_STEP_ID = 'web-search';

function searchStep(result: WebSearchResult): Omit<ActivityStep, 'id'> {
  return {
    kind: 'search',
    status: 'done',
    output: result.sources.map(source => (source.title ? `${source.title}\n${source.url}` : source.url)).join('\n\n') || undefined,
  };
}

interface RoundReply {
  reply: GenerationResponse;
  calls: AssembledCall[];
  /** Reasoning fields of the reply, which go back with it. */
  fields: ReasoningFields | undefined;
}

export function collectChatDeltaText(chunk: unknown): string {
  if (!chunk) return '';
  const pieces: string[] = [];
  const chunkObj = chunk as { choices?: Array<{ delta?: { content?: unknown } }> };
  const choices = Array.isArray(chunkObj?.choices) ? chunkObj.choices : [];
  for (const choice of choices) {
    // Streaming path: only use delta content. Some providers include the
    // accumulated message.content in the final chunk, which would duplicate
    // the full text if used as a fallback here.
    const deltaText = collectContentText(choice?.delta?.content);
    if (deltaText) pieces.push(deltaText);
  }
  return pieces.join('');
}

export function collectChatReasoningContent(reasoningContent: unknown): string {
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
    // Handle Anthropic extended thinking format: { type: "thinking", thinking: "..." }
    if (typeof itemObj.thinking === 'string') {
      if (itemObj.thinking) pieces.push(itemObj.thinking);
      continue;
    }
    // Handle summary format: { type: "summary_text", text: "..." }
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

export function extractChatReasoningSummary(res: unknown): string {
  try {
    const resObj = res as Record<string, unknown>;
    // Check for top-level reasoning field first
    const topLevelReasoning = collectChatReasoningContent(resObj?.reasoning);
    if (topLevelReasoning) return normalizeReasoningText(topLevelReasoning);

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
    return normalizeReasoningText(joined);
  } catch { /* ignore */ }
  return '';
}

async function respondStreaming(ctx: ProviderRequestContext, extra: ChatMessage[]): Promise<RoundReply> {
  const { onEvent, onTextDelta, onActivity, onWebSearchResult } = ctx.callbacks;
  const abortController = createAbort(ctx.provideAbort);

  const response = await fetch(`${ctx.baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ctx.apiKey}`,
    },
    body: JSON.stringify({ ...buildChatRequest(ctx, extra), stream: true }),
    signal: abortController.signal,
  });
  await ensureOkResponse(response, 'API error');

  let full = '';
  // One thinking step per choice, fed by whichever reasoning field the
  // provider streams (reasoning_content, reasoning, or a top-level field).
  const log = new ActivityLog(onActivity);
  const reasoningByIndex = new Map<number, string>();
  const setReasoning = (idx: number, text: string): void => {
    if (text === (reasoningByIndex.get(idx) || '')) return;
    reasoningByIndex.set(idx, text);
    log.set(`reasoning-${idx}`, { kind: 'thinking', status: 'running', text: normalizeReasoningText(text) }, idx);
  };

  // The reply's reasoning as the server sent it, for replay on later turns.
  const details: Array<Record<string, unknown>> = [];
  const streamed: Record<'reasoning_content' | 'reasoning', string> = { reasoning_content: '', reasoning: '' };
  let finalMessage: Record<string, unknown> | undefined;
  const toolCalls: AssembledCall[] = [];
  const search: WebSearchResult = { citations: [], sources: [] };
  const noteCitations = (annotations: unknown) => {
    const before = search.sources.length;
    collectUrlCitations(annotations, search);
    if (search.sources.length !== before) log.set(SEARCH_STEP_ID, searchStep(search), -1);
  };

  const processLine = createSseJsonLineProcessor((chunk) => {
    const first = (Array.isArray(chunk?.choices) ? chunk.choices : [])
      .find((choice: { index?: number }) => (Number(choice?.index) || 0) === 0) as Record<string, Record<string, unknown> | undefined> | undefined;
    if (first?.delta) {
      mergeReasoningDetails(details, first.delta.reasoning_details);
      for (const field of ['reasoning_content', 'reasoning'] as const) {
        if (typeof first.delta[field] === 'string') streamed[field] += first.delta[field];
      }
      mergeToolCallDeltas(toolCalls, first.delta.tool_calls);
      noteCitations(first.delta.annotations);
    }
    if (first?.message && typeof first.message === 'object') {
      finalMessage = first.message;
      noteCitations(first.message.annotations);
    }

    const deltaText = collectChatDeltaText(chunk);
    if (deltaText) {
      full += deltaText;
      try { onTextDelta?.(full, deltaText, chunk); } catch { /* ignore */ }
    }

    // Top-level reasoning field carries the reasoning so far
    const topLevelReasoning = collectChatReasoningContent((chunk as Record<string, unknown>)?.reasoning);
    if (topLevelReasoning) setReasoning(0, topLevelReasoning);

    const choices = Array.isArray(chunk?.choices) ? chunk.choices : [];
    for (const choice of choices as Array<{ index?: number; delta?: { reasoning_content?: unknown; reasoning?: unknown }; message?: { reasoning_content?: unknown; reasoning?: unknown }; finish_reason?: string }>) {
      const idx = Number.isFinite(Number(choice?.index)) ? Number(choice.index) : 0;
      let next = reasoningByIndex.get(idx) || '';
      const deltaSummary = collectChatReasoningContent(choice?.delta?.reasoning_content) || collectChatReasoningContent(choice?.delta?.reasoning);
      if (deltaSummary) next += deltaSummary;
      const messageSummary = collectChatReasoningContent(choice?.message?.reasoning_content) || collectChatReasoningContent(choice?.message?.reasoning);
      if (messageSummary) next = messageSummary;
      setReasoning(idx, next);
      // Reasoning is over once the answer starts or the choice finishes.
      if (deltaText || (typeof choice?.finish_reason === 'string' && choice.finish_reason)) log.settle();
    }
  }, onEvent);

  await readSseLines(response, processLine);

  const fields = pickReasoningFields(finalMessage)
    ?? pickReasoningFields({ reasoning_details: details, ...streamed });
  const calls = assembledCalls(Array.isArray(finalMessage?.tool_calls) ? finalMessage.tool_calls : toolCalls.filter(Boolean));
  const webSearchResult = search.sources.length ? search : undefined;
  if (webSearchResult) {
    try { onWebSearchResult?.(webSearchResult); } catch { /* ignore */ }
  }
  return {
    reply: { text: full, activity: log.settle(), webSearchResult, native: nativeTurn(ctx, full, fields) },
    calls,
    fields,
  };
}

/** A complete response's reasoning as a single thinking step. */
function reasoningActivity(res: unknown): ActivityStep[] {
  const text = extractChatReasoningSummary(res);
  return text ? [{ id: 'reasoning-0', kind: 'thinking', status: 'done', text }] : [];
}

async function respondOnce(ctx: ProviderRequestContext, extra: ChatMessage[]): Promise<RoundReply> {
  const abortController = createAbort(ctx.provideAbort);

  const response = await fetch(`${ctx.baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ctx.apiKey}`,
    },
    body: JSON.stringify(buildChatRequest(ctx, extra)),
    signal: abortController.signal,
  });
  await ensureOkResponse(response, 'API error');

  const res = await response.json();
  throwIfErrorBody(res);
  const text = extractOutputText(res);
  const message = Array.isArray(res?.choices) ? res.choices[0]?.message : undefined;
  const fields = pickReasoningFields(message);
  const search: WebSearchResult = { citations: [], sources: [] };
  collectUrlCitations(message?.annotations, search);
  const activity = reasoningActivity(res);
  if (search.sources.length) {
    activity.unshift({ id: SEARCH_STEP_ID, ...searchStep(search) });
    try { ctx.callbacks.onWebSearchResult?.(search); } catch { /* ignore */ }
  }
  return {
    reply: { text, activity, webSearchResult: search.sources.length ? search : undefined, native: nativeTurn(ctx, text, fields) },
    calls: assembledCalls(message?.tool_calls),
    fields,
  };
}

function toLoopCalls(calls: AssembledCall[]): BrowserToolCall[] {
  return calls.map(call => ({ id: call.id, name: call.function.name, arguments: call.function.arguments }));
}

function respond(ctx: ProviderRequestContext, stream: boolean): Promise<GenerationResponse> {
  return runToolLoop<ChatMessage>(ctx, {
    async send(roundCtx, extra) {
      const round = await (stream ? respondStreaming(roundCtx, extra) : respondOnce(roundCtx, extra));
      const turn: ChatMessage[] = round.calls.length
        ? [{ role: 'assistant', content: round.reply.text || null, tool_calls: round.calls, ...(round.fields ?? {}) }]
        : [];
      return { reply: round.reply, calls: toLoopCalls(round.calls), turn } satisfies ToolRound<ChatMessage>;
    },
    answer: (answers, steers) => [
      ...answers.map(({ call, output }) => ({ role: 'tool', tool_call_id: call.id, content: output })),
      ...steers.map(content => ({ role: 'user', content })),
    ],
    steer: texts => texts.map(content => ({ role: 'user', content })),
    partial: text => (text ? [{ role: 'assistant', content: text }] : []),
    native: (rounds, final, text) => ({
      api: 'chat_completions',
      endpoint: ctx.baseURL,
      model: ctx.model,
      text,
      data: {
        ...((final.reply.native?.data as ReasoningFields | undefined) ?? {}),
        toolTurns: rounds,
        finalText: final.reply.text,
      } satisfies StoredReply,
    }),
  });
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

export const chatCompletionsAdapter: ProviderAdapter = {
  respond,
  listModels,
};
