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
  readSseLines,
  sortModels,
  throwIfErrorBody,
  type ContentPart,
  type ProviderAdapter,
  type ProviderRequestContext,
} from '../core.js';
import { ActivityLog } from '../activity.js';
import type { ActivityStep, GenerationResponse, NativeTurn } from '../../types/index.js';

type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'file'; file: { file_data: string; filename: string } };

type ChatMessage = { role: string; content: string | ChatContentPart[] } & Record<string, unknown>;

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

/** Converts normalized provider input into Chat Completions messages. */
function buildChatMessages(ctx: ProviderRequestContext): ChatMessage[] {
  const input = ctx.input;
  if (!Array.isArray(input)) {
    return typeof input === 'string' && input
      ? [{ role: 'user', content: input }]
      : [];
  }
  return input.map((message): ChatMessage => {
    const { native: _native, ...msg } = message;
    const reasoning = msg.role === 'assistant'
      ? nativeData(message, 'chat_completions', ctx.baseURL) as ReasoningFields | undefined
      : undefined;
    const fields: Record<string, unknown> = {};
    for (const field of REASONING_FIELDS) {
      if (reasoning && reasoning[field] != null) fields[field] = reasoning[field];
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
        return { role: msg.role, content: contentArray, ...fields };
      }
    }
    return { ...(msg as { role: string; content: string }), ...fields };
  });
}

function buildChatRequest(ctx: ProviderRequestContext): Record<string, unknown> {
  const chatRequest: Record<string, unknown> = { model: ctx.model, messages: buildChatMessages(ctx) };
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
  return chatRequest;
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

async function respondStreaming(ctx: ProviderRequestContext): Promise<GenerationResponse> {
  const { onEvent, onTextDelta, onActivity } = ctx.callbacks;
  const abortController = createAbort(ctx.provideAbort);

  const response = await fetch(`${ctx.baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ctx.apiKey}`,
    },
    body: JSON.stringify({ ...buildChatRequest(ctx), stream: true }),
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

  const processLine = createSseJsonLineProcessor((chunk) => {
    const first = (Array.isArray(chunk?.choices) ? chunk.choices : [])
      .find((choice: { index?: number }) => (Number(choice?.index) || 0) === 0) as Record<string, Record<string, unknown> | undefined> | undefined;
    if (first?.delta) {
      mergeReasoningDetails(details, first.delta.reasoning_details);
      for (const field of ['reasoning_content', 'reasoning'] as const) {
        if (typeof first.delta[field] === 'string') streamed[field] += first.delta[field];
      }
    }
    if (first?.message && typeof first.message === 'object') finalMessage = first.message;

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
  return { text: full, activity: log.settle(), native: nativeTurn(ctx, full, fields) };
}

/** A complete response's reasoning as a single thinking step. */
function reasoningActivity(res: unknown): ActivityStep[] {
  const text = extractChatReasoningSummary(res);
  return text ? [{ id: 'reasoning-0', kind: 'thinking', status: 'done', text }] : [];
}

async function respondOnce(ctx: ProviderRequestContext): Promise<GenerationResponse> {
  const abortController = createAbort(ctx.provideAbort);

  const response = await fetch(`${ctx.baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ctx.apiKey}`,
    },
    body: JSON.stringify(buildChatRequest(ctx)),
    signal: abortController.signal,
  });
  await ensureOkResponse(response, 'API error');

  const res = await response.json();
  throwIfErrorBody(res);
  const text = extractOutputText(res);
  const message = Array.isArray(res?.choices) ? res.choices[0]?.message : undefined;
  return { text, activity: reasoningActivity(res), native: nativeTurn(ctx, text, pickReasoningFields(message)) };
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
  respond(ctx, stream) {
    return stream ? respondStreaming(ctx) : respondOnce(ctx);
  },
  listModels,
};
