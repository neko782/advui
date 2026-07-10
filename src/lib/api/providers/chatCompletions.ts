// ============================================================================
// Chat Completions provider adapter (OpenAI-compatible /chat/completions)
// ============================================================================

import { toIntOrNull, toClampedNumber } from '../../utils/numbers.js';
import { ensureDataUrl } from '../../attachments/mime.js';
import {
  collectContentText,
  createAbort,
  createSseJsonLineProcessor,
  ensureOkResponse,
  extractOutputText,
  normalizeReasoningText,
  readSseLines,
  sortModels,
  type ContentPart,
  type ProviderAdapter,
  type ProviderRequestContext,
} from '../core.js';
import type { GenerationResponse } from '../../types/index.js';

type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'file'; file: { file_data: string; filename: string } };

/** Converts normalized provider input into Chat Completions messages. */
function buildChatMessages(ctx: ProviderRequestContext): Array<{ role: string; content: string | ChatContentPart[] }> {
  const input = ctx.input;
  if (!Array.isArray(input)) {
    return typeof input === 'string' && input
      ? [{ role: 'user', content: input }]
      : [];
  }
  return input.map(msg => {
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
  const { onEvent, onTextDelta, onReasoningSummaryDelta, onReasoningSummaryDone } = ctx.callbacks;
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
  const summaryByIndex = new Map<number, string>();
  let summaryDelivered = false;
  const buildSummary = (): string => {
    const ordered = Array.from(summaryByIndex.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([, text]) => (typeof text === 'string' ? text : ''))
      .filter(Boolean);
    if (!ordered.length) return '';
    const combined = ordered.join('\n\n\n');
    return normalizeReasoningText(combined);
  };

  const processLine = createSseJsonLineProcessor((chunk) => {
    const deltaText = collectChatDeltaText(chunk);
    if (deltaText) {
      full += deltaText;
      try { onTextDelta?.(full, deltaText, chunk); } catch { /* ignore */ }
    }

    // Check for top-level reasoning field in chunk
    const topLevelReasoning = collectChatReasoningContent((chunk as Record<string, unknown>)?.reasoning);
    if (topLevelReasoning) {
      const prev = summaryByIndex.get(0) || '';
      const next = topLevelReasoning;
      if (next !== prev) {
        summaryByIndex.set(0, next);
        const summary = buildSummary();
        try { onReasoningSummaryDelta?.(summary, topLevelReasoning, chunk); } catch { /* ignore */ }
      }
    }

    const choices = Array.isArray(chunk?.choices) ? chunk.choices : [];
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
  }, onEvent);

  await readSseLines(response, processLine);

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

async function respondOnce(ctx: ProviderRequestContext): Promise<GenerationResponse> {
  const { onReasoningSummaryDone } = ctx.callbacks;
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
  const text = extractOutputText(res);
  const summary = extractChatReasoningSummary(res);
  try { onReasoningSummaryDone?.(summary || '', null); } catch { /* ignore */ }
  return { text, reasoningSummary: summary || '' };
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
