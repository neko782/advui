// ============================================================================
// Gemini provider adapter (generateContent / streamGenerateContent)
// ============================================================================

import { isReasoningLevelSupported } from '../../utils/reasoningLevels.js';
import { DEFAULT_API_BASE_URL } from '../../constants/index.js';
import { toIntOrNull, toClampedNumber } from '../../utils/numbers.js';
import {
  createAbort,
  createSseJsonLineProcessor,
  ensureOkResponse,
  readSseLines,
  type ContentPart,
  type ProviderAdapter,
  type ProviderInput,
  type ProviderRequestContext,
} from '../core.js';
import { ActivityLog } from '../activity.js';
import type { ActivityStep, GenerationResponse } from '../../types/index.js';

export const DEFAULT_GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const THOUGHT_STEP_ID = 'thoughts';

type GeminiPart =
  | { text: string; thought?: boolean }
  | { inlineData: { mimeType: string; data: string } };

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

interface GeminiRequest {
  contents: GeminiContent[];
  systemInstruction?: { parts: Array<{ text: string }> };
  generationConfig?: {
    temperature?: number;
    topP?: number;
    maxOutputTokens?: number;
    thinkingConfig?: { thinkingLevel: string };
  };
}

function inlineDataFromDataUrl(dataUrl: string): GeminiPart | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (match && match[1] && match[2]) {
    return { inlineData: { mimeType: match[1], data: match[2] } };
  }
  return null;
}

// Convert messages to Gemini format
export function convertToGeminiFormat(
  messages: Array<{ role: string; content: string | ContentPart[] }>,
  prompt?: string
): { contents: GeminiContent[]; systemInstruction?: { parts: Array<{ text: string }> } } {
  const contents: GeminiContent[] = [];
  let systemInstruction: { parts: Array<{ text: string }> } | undefined;
  const systemTexts: string[] = [];

  // Handle simple prompt case
  if (typeof prompt === 'string' && prompt && (!messages || !messages.length)) {
    return {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    };
  }

  for (const msg of messages) {
    // Handle system messages as systemInstruction
    if (msg.role === 'system') {
      const text = typeof msg.content === 'string'
        ? msg.content
        : (msg.content as ContentPart[])
            .filter(p => p.type === 'input_text')
            .map(p => (p as { text: string }).text)
            .join('\n');
      if (text) {
        systemTexts.push(text);
        systemInstruction = { parts: [{ text: systemTexts.join('\n\n') }] };
      }
      continue;
    }

    // Map roles: user -> user, assistant -> model
    const geminiRole: 'user' | 'model' = msg.role === 'assistant' ? 'model' : 'user';
    const parts: GeminiPart[] = [];

    // Gemini rejects empty text parts, so blank messages are left out.
    if (typeof msg.content === 'string') {
      if (msg.content) parts.push({ text: msg.content });
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content as ContentPart[]) {
        if (part.type === 'input_text') {
          if (part.text) parts.push({ text: part.text });
        } else if (part.type === 'input_image') {
          const inline = inlineDataFromDataUrl((part as { image_url: string }).image_url);
          if (inline) parts.push(inline);
        } else if (part.type === 'input_video') {
          const inline = inlineDataFromDataUrl((part as { video_url: string }).video_url);
          if (inline) parts.push(inline);
        } else if (part.type === 'input_audio') {
          const inline = inlineDataFromDataUrl((part as { audio_url: string }).audio_url);
          if (inline) parts.push(inline);
        } else if (part.type === 'input_file') {
          // Handle file attachments (PDFs, etc.)
          const inline = inlineDataFromDataUrl((part as { file_data: string }).file_data);
          if (inline) parts.push(inline);
        }
      }
    }

    if (parts.length > 0) {
      contents.push({ role: geminiRole, parts });
    }
  }

  return { contents, systemInstruction };
}

export function extractGeminiParts(source: unknown): { text: string; reasoningSummary: string } {
  const sourceObj = source as Record<string, unknown>;
  let text = '';
  let reasoningSummary = '';

  try {
    const candidates = sourceObj?.candidates as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(candidates) && candidates.length > 0) {
      const content = candidates[0]?.content as Record<string, unknown> | undefined;
      const parts = content?.parts as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(parts)) {
        for (const part of parts) {
          if (typeof part?.text !== 'string') continue;
          if (part?.thought === true) {
            reasoningSummary += part.text;
            continue;
          }
          text += part.text;
        }
      }
    }
  } catch { /* ignore */ }

  return { text, reasoningSummary };
}

/**
 * Gemini reports refusals inside a successful response: a blocked prompt has
 * no candidates and a `promptFeedback.blockReason`, and a blocked or truncated
 * reply carries a non-STOP `finishReason`. Returns a message for those, or
 * null for a normal response.
 */
export function describeGeminiStop(source: unknown): string | null {
  const obj = source && typeof source === 'object' ? source as Record<string, unknown> : null;
  if (!obj) return null;
  const feedback = obj.promptFeedback && typeof obj.promptFeedback === 'object'
    ? obj.promptFeedback as Record<string, unknown>
    : null;
  if (typeof feedback?.blockReason === 'string' && feedback.blockReason) {
    return `Gemini blocked the prompt (${feedback.blockReason}).`;
  }
  const candidates = Array.isArray(obj.candidates) ? obj.candidates as Array<Record<string, unknown>> : [];
  const finishReason = candidates[0]?.finishReason;
  if (typeof finishReason !== 'string' || !finishReason || finishReason === 'STOP') return null;
  if (finishReason === 'MAX_TOKENS') {
    return 'The reply hit the max output tokens limit before any text was produced. Raise the limit and regenerate.';
  }
  return `Gemini stopped without a reply (${finishReason}).`;
}

function buildGeminiRequest(ctx: ProviderRequestContext): GeminiRequest {
  const input: ProviderInput = ctx.input;
  const { contents, systemInstruction } = convertToGeminiFormat(
    Array.isArray(input) ? input : [],
    typeof input === 'string' ? input : undefined
  );

  const geminiRequest: GeminiRequest = { contents };
  if (systemInstruction) {
    geminiRequest.systemInstruction = systemInstruction;
  }

  // Add generation config
  const generationConfig: GeminiRequest['generationConfig'] = {};
  const tempVal = toClampedNumber(ctx.params.temperature, 0, 2);
  if (tempVal != null) generationConfig.temperature = tempVal;
  const topPVal = toClampedNumber(ctx.params.topP, 0, 1);
  if (topPVal != null) generationConfig.topP = topPVal;
  const tokens = toIntOrNull(ctx.params.maxOutputTokens, { belowMin: 'unset' });
  if (tokens != null) generationConfig.maxOutputTokens = tokens;
  const { reasoningEffort } = ctx.params;
  if (isReasoningLevelSupported('gemini', reasoningEffort)) {
    generationConfig.thinkingConfig = { thinkingLevel: reasoningEffort };
  }
  if (Object.keys(generationConfig).length > 0) {
    geminiRequest.generationConfig = generationConfig;
  }

  return geminiRequest;
}

function normalizeGeminiBaseUrl(baseURL?: string): string {
  const configured = baseURL?.trim().replace(/\/+$/, '');
  // Connections store the app's default URL for every API mode; neither the
  // current default nor the historical OpenAI one is a Gemini endpoint.
  if (!configured || configured === DEFAULT_API_BASE_URL || configured === 'https://api.openai.com/v1') return DEFAULT_GEMINI_BASE_URL;
  return configured;
}

function geminiBaseUrlFor(ctx: ProviderRequestContext): string {
  return normalizeGeminiBaseUrl(ctx.apiBaseUrl);
}

async function respondStreaming(ctx: ProviderRequestContext): Promise<GenerationResponse> {
  const { onEvent, onTextDelta, onActivity } = ctx.callbacks;
  const abortController = createAbort(ctx.provideAbort);
  const endpoint = `${geminiBaseUrlFor(ctx)}/models/${ctx.model}:streamGenerateContent?alt=sse&key=${ctx.apiKey}`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildGeminiRequest(ctx)),
    signal: abortController.signal,
  });
  await ensureOkResponse(response, 'Gemini API error');

  let full = '';
  // Thought summaries stream as one run of text, read as a single thinking step.
  const log = new ActivityLog(onActivity);
  let stopMessage: string | null = null;

  const processLine = createSseJsonLineProcessor((chunk) => {
    stopMessage = describeGeminiStop(chunk) ?? stopMessage;
    const { text: delta, reasoningSummary: reasoningDelta } = extractGeminiParts(chunk);
    if (reasoningDelta) log.append(THOUGHT_STEP_ID, 'text', reasoningDelta, { kind: 'thinking', status: 'running' });
    if (delta) {
      log.settle();
      full += delta;
      try { onTextDelta?.(full, delta, chunk); } catch { /* ignore */ }
    }
  }, onEvent);

  await readSseLines(response, processLine);
  // Partial text is still a usable reply; only an empty one is an error.
  if (!full && stopMessage) throw new Error(stopMessage);

  return { text: full, activity: log.settle() };
}

async function respondOnce(ctx: ProviderRequestContext): Promise<GenerationResponse> {
  const abortController = createAbort(ctx.provideAbort);
  const endpoint = `${geminiBaseUrlFor(ctx)}/models/${ctx.model}:generateContent?key=${ctx.apiKey}`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildGeminiRequest(ctx)),
    signal: abortController.signal,
  });
  await ensureOkResponse(response, 'Gemini API error');

  const res = await response.json();
  const { text, reasoningSummary: summary } = extractGeminiParts(res);
  if (!text) {
    const stopMessage = describeGeminiStop(res);
    if (stopMessage) throw new Error(stopMessage);
  }
  const activity: ActivityStep[] = summary
    ? [{ id: THOUGHT_STEP_ID, kind: 'thinking', status: 'done', text: summary }]
    : [];
  return { text, activity };
}

async function listModels({ apiKey, baseURL }: { apiKey: string; baseURL: string }): Promise<string[]> {
  const geminiBaseUrl = normalizeGeminiBaseUrl(baseURL);
  const response = await fetch(`${geminiBaseUrl}/models?key=${apiKey}`, {
    method: 'GET',
  });
  await ensureOkResponse(response, 'Gemini API error');

  const res = await response.json();
  const models = Array.isArray(res?.models) ? res.models : [];
  // Filter to only generative models and extract model names
  return models
    .filter((m: Record<string, unknown>) =>
      typeof m?.name === 'string' &&
      m.name.includes('/') &&
      (m.supportedGenerationMethods as string[] || []).includes('generateContent')
    )
    .map((m: Record<string, unknown>) => {
      // Extract model ID from full name (e.g., "models/gemini-pro" -> "gemini-pro")
      const name = m.name as string;
      return name.startsWith('models/') ? name.slice(7) : name;
    })
    .sort();
}

export const geminiAdapter: ProviderAdapter = {
  respond(ctx, stream) {
    return stream ? respondStreaming(ctx) : respondOnce(ctx);
  },
  listModels,
};
