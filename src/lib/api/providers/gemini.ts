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
  nativeData,
  plainTurns,
  readSseLines,
  type ContentPart,
  type ProviderAdapter,
  type ProviderInput,
  type ProviderMessage,
  type ProviderRequestContext,
} from '../core.js';
import { ActivityLog } from '../activity.js';
import { browserToolNames, browserToolSpecs } from '../browserTools.js';
import { runToolLoop, type BrowserToolCall, type ToolRound } from '../toolLoop.js';
import type { GenerationResponse, NativeTurn, WebSearchResult } from '../../types/index.js';

export const DEFAULT_GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const THOUGHT_STEP_ID = 'thoughts';

type GeminiPart =
  | { text: string; thought?: boolean; thoughtSignature?: string }
  | { inlineData: { mimeType: string; data: string } }
  | Record<string, unknown>;

export interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

interface GeminiRequest {
  contents: GeminiContent[];
  tools?: Array<Record<string, unknown>>;
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

/** Names of the functions a stored reply's contents call. */
function calledFunctions(contents: GeminiContent[]): string[] {
  return contents.flatMap(content => (Array.isArray(content?.parts) ? content.parts : [])
    .map(part => (part as { functionCall?: { name?: unknown } }).functionCall?.name)
    .filter((name): name is string => typeof name === 'string'));
}

/**
 * A stored reply's contents as they go back: every turn of a reply that
 * called browser tools while the request still offers them, otherwise just
 * the final model turn. Older replies stored only that turn's parts.
 */
function replayContents(native: unknown, functions: ReadonlySet<string>): GeminiContent[] {
  if (Array.isArray(native)) return native.length ? [{ role: 'model', parts: native as GeminiPart[] }] : [];
  const contents = native && typeof native === 'object' ? (native as { contents?: unknown }).contents : undefined;
  if (!Array.isArray(contents) || !contents.length) return [];
  const list = contents as GeminiContent[];
  if (calledFunctions(list).every(name => functions.has(name))) return list;
  // A steered reply goes back as plain text, with its steering messages.
  if (list.some(content => content?.role === 'user' && content.parts?.some(part => typeof (part as { text?: unknown })?.text === 'string'))) return [];
  const last = list[list.length - 1];
  return last?.role === 'model' ? [last] : [];
}

/** A plain message's content as Gemini parts. Gemini rejects empty text parts. */
function geminiParts(msg: ProviderMessage): GeminiPart[] {
  const parts: GeminiPart[] = [];
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
  return parts;
}

// Convert messages to Gemini format
export function convertToGeminiFormat(
  messages: ProviderMessage[],
  prompt?: string,
  endpoint?: string,
  functions: ReadonlySet<string> = new Set(),
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

    // Earlier replies go back with every part as it was returned, thought
    // signatures in place. Models that cannot read them drop them.
    const native = geminiRole === 'model' && endpoint != null ? replayContents(nativeData(msg, 'gemini', endpoint), functions) : [];
    if (native.length) {
      contents.push(...native);
      continue;
    }

    for (const turn of plainTurns(msg)) {
      const parts = geminiParts(turn);
      if (parts.length > 0) contents.push({ role: turn.role === 'assistant' ? 'model' : 'user', parts });
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

/**
 * Collects a reply's parts for replay. Streamed text is joined back into one
 * part per run, but a part carrying a thought signature is never merged with
 * another: the signature belongs to its position. A signature can arrive on
 * a part with empty text, which is kept as it came.
 */
export function appendGeminiParts(target: Array<Record<string, unknown>>, source: unknown): void {
  const candidates = (source as Record<string, unknown>)?.candidates;
  const content = Array.isArray(candidates) ? (candidates[0] as Record<string, unknown> | undefined)?.content : undefined;
  const parts = (content as Record<string, unknown> | undefined)?.parts;
  if (!Array.isArray(parts)) return;
  const isPlainText = (part: Record<string, unknown>) =>
    typeof part.text === 'string' && Object.keys(part).every(key => key === 'text' || key === 'thought');
  for (const part of parts as Array<Record<string, unknown>>) {
    if (!part || typeof part !== 'object') continue;
    const last = target[target.length - 1];
    if (last && isPlainText(last) && isPlainText(part) && !!last.thought === !!part.thought) {
      last.text = `${last.text as string}${part.text as string}`;
    } else {
      target.push({ ...part });
    }
  }
}

function nativeTurn(ctx: ProviderRequestContext, text: string, parts: Array<Record<string, unknown>>): NativeTurn | undefined {
  return parts.length
    ? { api: 'gemini', endpoint: geminiBaseUrlFor(ctx), model: ctx.model, text, data: parts }
    : undefined;
}

function buildGeminiTools(ctx: ProviderRequestContext): Array<Record<string, unknown>> {
  const tools: Array<Record<string, unknown>> = [];
  const functions = browserToolSpecs(ctx.tools.browserTools).map(spec => {
    const declaration: Record<string, unknown> = { name: spec.name, description: spec.description };
    const properties = (spec.parameters as { properties?: Record<string, unknown> }).properties;
    // A function without parameters leaves the schema out.
    if (properties && Object.keys(properties).length) declaration.parametersJsonSchema = spec.parameters;
    return declaration;
  });
  if (functions.length) tools.push({ functionDeclarations: functions });
  if (ctx.tools.webSearch?.enabled) tools.push({ googleSearch: {} });
  if (ctx.tools.webFetch) tools.push({ urlContext: {} });
  if (ctx.tools.codeInterpreter?.enabled) tools.push({ codeExecution: {} });
  return tools;
}

export function buildGeminiRequest(ctx: ProviderRequestContext, extra: GeminiContent[] = []): GeminiRequest {
  const input: ProviderInput = ctx.input;
  const { contents, systemInstruction } = convertToGeminiFormat(
    Array.isArray(input) ? input : [],
    typeof input === 'string' ? input : undefined,
    geminiBaseUrlFor(ctx),
    browserToolNames(ctx.tools.browserTools),
  );

  const geminiRequest: GeminiRequest = { contents: [...contents, ...extra] };
  const tools = buildGeminiTools(ctx);
  if (tools.length) geminiRequest.tools = tools;
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

// ============================================================================
// Built-in tools and function calls -> activity steps
// ============================================================================

type Json = Record<string, unknown>;

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function firstCandidate(source: unknown): Json | undefined {
  const candidates = (source as Json | undefined)?.candidates;
  return Array.isArray(candidates) && candidates[0] && typeof candidates[0] === 'object' ? candidates[0] as Json : undefined;
}

function candidateParts(source: unknown): Json[] {
  const content = firstCandidate(source)?.content as Json | undefined;
  return Array.isArray(content?.parts) ? (content.parts as Json[]).filter(part => part && typeof part === 'object') : [];
}

const GENERATED_CALL_ID = 'gemini-call-';

/**
 * Follows one reply's built-in tool use (code execution, Google Search, URL
 * context) and collects its function calls.
 */
export class GeminiToolReader {
  readonly calls: BrowserToolCall[] = [];
  readonly search: WebSearchResult = { citations: [], sources: [] };
  private codeSteps = 0;

  constructor(private log: ActivityLog) {}

  read(chunk: unknown): void {
    for (const part of candidateParts(chunk)) {
      const code = part.executableCode as Json | undefined;
      const result = part.codeExecutionResult as Json | undefined;
      const call = part.functionCall as Json | undefined;
      if (code) {
        this.codeSteps++;
        this.log.set(`code-${this.codeSteps}`, { kind: 'code', status: 'running', input: str(code.code) || undefined });
      } else if (result) {
        const id = `code-${Math.max(1, this.codeSteps)}`;
        const ok = str(result.outcome) === 'OUTCOME_OK' || !str(result.outcome);
        this.log.set(id, ok
          ? { kind: 'code', status: 'done', output: str(result.output) || undefined }
          : { kind: 'code', status: 'failed', output: str(result.output) || undefined, error: str(result.outcome) });
      } else if (call && str(call.name)) {
        this.calls.push({
          id: str(call.id) || `${GENERATED_CALL_ID}${this.calls.length}`,
          name: str(call.name),
          arguments: call.args ?? {},
        });
      }
    }

    const candidate = firstCandidate(chunk);
    const grounding = candidate?.groundingMetadata as Json | undefined;
    if (grounding) this.readGrounding(grounding);
    const urlContext = (candidate?.urlContextMetadata ?? candidate?.url_context_metadata) as Json | undefined;
    if (urlContext) this.readUrlContext(urlContext);
  }

  private readGrounding(grounding: Json): void {
    const queries = Array.isArray(grounding.webSearchQueries) ? grounding.webSearchQueries.filter((q): q is string => typeof q === 'string' && !!q) : [];
    const chunks = Array.isArray(grounding.groundingChunks) ? grounding.groundingChunks as Json[] : [];
    for (const chunk of chunks) {
      const web = chunk?.web as Json | undefined;
      const url = str(web?.uri);
      if (url && !this.search.sources.some(source => source.url === url)) {
        this.search.sources.push({ url, title: str(web?.title) || undefined });
      }
    }
    if (!queries.length && !this.search.sources.length) return;
    this.log.set('google-search', {
      kind: 'search',
      status: 'done',
      subject: queries[0] || undefined,
      input: queries.length > 1 ? queries.join('\n') : undefined,
      output: this.search.sources.map(source => (source.title ? `${source.title}\n${source.url}` : source.url)).join('\n\n') || undefined,
    }, -1);
  }

  private readUrlContext(metadata: Json): void {
    const entries = (metadata.urlMetadata ?? metadata.url_metadata) as Json[] | undefined;
    if (!Array.isArray(entries)) return;
    entries.forEach((entry, index) => {
      const url = str(entry?.retrievedUrl ?? entry?.retrieved_url);
      const status = str(entry?.urlRetrievalStatus ?? entry?.url_retrieval_status);
      const ok = !status || status === 'URL_RETRIEVAL_STATUS_SUCCESS';
      this.log.set(`url-${index}`, ok
        ? { kind: 'fetch', status: 'done', subject: url || undefined }
        : { kind: 'fetch', status: 'failed', subject: url || undefined, error: status.replace(/^URL_RETRIEVAL_STATUS_/, '').toLowerCase().replace(/_/g, ' ') }, -0.5);
    });
  }

  webSearchResult(): WebSearchResult | undefined {
    return this.search.sources.length ? this.search : undefined;
  }
}

// ============================================================================
// Requests
// ============================================================================

interface RoundReply {
  reply: GenerationResponse;
  calls: BrowserToolCall[];
  parts: Array<Record<string, unknown>>;
}

async function respondStreaming(ctx: ProviderRequestContext, extra: GeminiContent[]): Promise<RoundReply> {
  const { onEvent, onTextDelta, onActivity, onWebSearchResult } = ctx.callbacks;
  const abortController = createAbort(ctx.provideAbort);
  const endpoint = `${geminiBaseUrlFor(ctx)}/models/${ctx.model}:streamGenerateContent?alt=sse&key=${ctx.apiKey}`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildGeminiRequest(ctx, extra)),
    signal: abortController.signal,
  });
  await ensureOkResponse(response, 'Gemini API error');

  let full = '';
  // Thought summaries stream as one run of text, read as a single thinking step.
  const log = new ActivityLog(onActivity);
  const tools = new GeminiToolReader(log);
  let stopMessage: string | null = null;
  const parts: Array<Record<string, unknown>> = [];

  const processLine = createSseJsonLineProcessor((chunk) => {
    stopMessage = describeGeminiStop(chunk) ?? stopMessage;
    appendGeminiParts(parts, chunk);
    tools.read(chunk);
    const { text: delta, reasoningSummary: reasoningDelta } = extractGeminiParts(chunk);
    if (reasoningDelta) log.append(THOUGHT_STEP_ID, 'text', reasoningDelta, { kind: 'thinking', status: 'running' });
    if (delta) {
      if (log.get(THOUGHT_STEP_ID)?.status === 'running') log.set(THOUGHT_STEP_ID, { status: 'done' });
      full += delta;
      try { onTextDelta?.(full, delta, chunk); } catch { /* ignore */ }
    }
  }, onEvent);

  await readSseLines(response, processLine);
  // Partial text is still a usable reply; only an empty one is an error.
  if (!full && !tools.calls.length && stopMessage) throw new Error(stopMessage);

  const webSearchResult = tools.webSearchResult();
  if (webSearchResult) {
    try { onWebSearchResult?.(webSearchResult); } catch { /* ignore */ }
  }
  return {
    reply: { text: full, activity: log.settle(), webSearchResult, native: nativeTurn(ctx, full, parts) },
    calls: tools.calls,
    parts,
  };
}

async function respondOnce(ctx: ProviderRequestContext, extra: GeminiContent[]): Promise<RoundReply> {
  const abortController = createAbort(ctx.provideAbort);
  const endpoint = `${geminiBaseUrlFor(ctx)}/models/${ctx.model}:generateContent?key=${ctx.apiKey}`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildGeminiRequest(ctx, extra)),
    signal: abortController.signal,
  });
  await ensureOkResponse(response, 'Gemini API error');

  const res = await response.json();
  const { text, reasoningSummary: summary } = extractGeminiParts(res);
  const log = new ActivityLog();
  if (summary) log.set(THOUGHT_STEP_ID, { kind: 'thinking', status: 'done', text: summary });
  const tools = new GeminiToolReader(log);
  tools.read(res);
  if (!text && !tools.calls.length) {
    const stopMessage = describeGeminiStop(res);
    if (stopMessage) throw new Error(stopMessage);
  }
  const webSearchResult = tools.webSearchResult();
  if (webSearchResult) {
    try { ctx.callbacks.onWebSearchResult?.(webSearchResult); } catch { /* ignore */ }
  }
  const parts: Array<Record<string, unknown>> = [];
  appendGeminiParts(parts, res);
  return {
    reply: { text, activity: log.settle(), webSearchResult, native: nativeTurn(ctx, text, parts) },
    calls: tools.calls,
    parts,
  };
}

function respond(ctx: ProviderRequestContext, stream: boolean): Promise<GenerationResponse> {
  return runToolLoop<GeminiContent>(ctx, {
    async send(roundCtx, extra) {
      const round = await (stream ? respondStreaming(roundCtx, extra) : respondOnce(roundCtx, extra));
      const turn: GeminiContent[] = round.parts.length ? [{ role: 'model', parts: round.parts }] : [];
      return { reply: round.reply, calls: round.calls, turn } satisfies ToolRound<GeminiContent>;
    },
    // Steering text follows the function responses in the same user turn.
    answer: (answers, steers) => [{
      role: 'user',
      parts: [
        ...answers.map(({ call, output, isError }) => {
          const functionResponse: Json = { name: call.name, response: isError ? { error: output } : { result: output } };
          if (!call.id.startsWith(GENERATED_CALL_ID)) functionResponse.id = call.id;
          return { functionResponse };
        }),
        ...steers.map(text => ({ text })),
      ],
    }],
    steer: texts => (texts.length ? [{ role: 'user', parts: texts.map(text => ({ text })) }] : []),
    partial: text => (text ? [{ role: 'model', parts: [{ text }] }] : []),
    native: (rounds, final, text) => ({
      api: 'gemini',
      endpoint: geminiBaseUrlFor(ctx),
      model: ctx.model,
      text,
      data: { contents: [...rounds, ...final.turn] },
    }),
  });
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
  respond,
  listModels,
};
