// ============================================================================
// Gemini provider adapter (generateContent / streamGenerateContent)
// ============================================================================

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
import type { GenerationResponse } from '../../types/index.js';

export const DEFAULT_GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

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
    thinkingConfig?: {
      thinkingMode?: string;
      thinkingBudget?: number;
    };
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

    if (typeof msg.content === 'string') {
      parts.push({ text: msg.content });
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content as ContentPart[]) {
        if (part.type === 'input_text') {
          parts.push({ text: (part as { text: string }).text });
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
  if (Object.keys(generationConfig).length > 0) {
    geminiRequest.generationConfig = generationConfig;
  }

  return geminiRequest;
}

function geminiBaseUrlFor(ctx: ProviderRequestContext): string {
  return ctx.apiBaseUrl?.trim() || DEFAULT_GEMINI_BASE_URL;
}

async function respondStreaming(ctx: ProviderRequestContext): Promise<GenerationResponse> {
  const { onEvent, onTextDelta, onReasoningSummaryDelta, onReasoningSummaryDone } = ctx.callbacks;
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
  let summary = '';

  const processLine = createSseJsonLineProcessor((chunk) => {
    const { text: delta, reasoningSummary: reasoningDelta } = extractGeminiParts(chunk);
    if (reasoningDelta) {
      summary += reasoningDelta;
      try { onReasoningSummaryDelta?.(summary, reasoningDelta, chunk); } catch { /* ignore */ }
    }
    if (delta) {
      full += delta;
      try { onTextDelta?.(full, delta, chunk); } catch { /* ignore */ }
    }
  }, onEvent);

  await readSseLines(response, processLine);

  try { onReasoningSummaryDone?.(summary || '', null); } catch { /* ignore */ }
  return { text: full, reasoningSummary: summary };
}

async function respondOnce(ctx: ProviderRequestContext): Promise<GenerationResponse> {
  const { onReasoningSummaryDone } = ctx.callbacks;
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
  try { onReasoningSummaryDone?.(summary || '', res); } catch { /* ignore */ }
  return { text, reasoningSummary: summary };
}

async function listModels({ apiKey, baseURL }: { apiKey: string; baseURL: string }): Promise<string[]> {
  const geminiBaseUrl = baseURL.includes('generativelanguage.googleapis.com')
    ? baseURL
    : DEFAULT_GEMINI_BASE_URL;
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
