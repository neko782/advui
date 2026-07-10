// ============================================================================
// Shared API core
// Connection resolution, request-input normalization, SSE plumbing, and
// response-text extraction shared by all provider adapters.
// ============================================================================

import { loadSettings, findConnection } from '../settingsStore.js';
import { DEFAULT_MODEL } from '../utils/presetHelpers.js';
import {
  normalizeMimeType,
  isImageMimeType,
  isVideoMimeType,
  isAudioMimeType,
  isPdfMimeType,
  inferAttachmentFilename,
  ensureDataUrl,
} from '../attachments/mime.js';
import type {
  Settings,
  Connection,
  ApiMode,
  ResolvedConnection,
  GenerationResponse,
  HistoryMessage,
  ImageData,
  ReasoningEffort,
  TextVerbosity,
  ReasoningSummary,
  WebSearchOptions,
  WebSearchResult,
  CodeInterpreterOptions,
  ShellOptions,
  ImageGenerationOptions,
  GeneratedImage,
  McpServerConfig,
} from '../types/index.js';

// ============================================================================
// Connection resolution
// ============================================================================

const API_MODES: ReadonlySet<ApiMode> = new Set(['responses', 'chat_completions', 'gemini']);

export function normalizeApiMode(mode: unknown): ApiMode {
  return API_MODES.has(mode as ApiMode) ? (mode as ApiMode) : 'responses';
}

export function resolveConnection(options: {
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
    return { id, apiKey, apiBaseUrl, apiMode: normalizeApiMode(connection.apiMode) };
  }
  const srcSettings = settings || loadSettings();
  const resolved = findConnection(srcSettings, connectionId);
  return {
    id: resolved?.id || null,
    apiKey: typeof resolved?.apiKey === 'string' ? resolved.apiKey : '',
    apiBaseUrl: resolved?.apiBaseUrl,
    apiMode: normalizeApiMode(resolved?.apiMode),
  };
}

export interface ClientOptions {
  apiKey: string;
  baseURL?: string;
  dangerouslyAllowBrowser?: boolean;
}

export function buildClientOptions(options: { apiKey: string; apiBaseUrl?: string }): ClientOptions | null {
  const { apiKey, apiBaseUrl } = options;
  if (!apiKey) return null;
  const baseURL = typeof apiBaseUrl === 'string' && apiBaseUrl.trim() ? apiBaseUrl.trim() : '';
  const clientOptions: ClientOptions = { apiKey, dangerouslyAllowBrowser: true };
  if (baseURL) clientOptions.baseURL = baseURL;
  return clientOptions;
}

export function pickActivePreset(settings: Settings | null): { model: string; streaming: boolean; connectionId: string | null } {
  const list = Array.isArray(settings?.presets) ? settings.presets : [];
  const fallbackConnectionId = typeof settings?.selectedConnectionId === 'string' ? settings.selectedConnectionId : null;
  if (!list.length) return { model: DEFAULT_MODEL, streaming: true, connectionId: fallbackConnectionId };
  const selected = typeof settings?.selectedPresetId === 'string'
    ? list.find(p => p?.id === settings.selectedPresetId)
    : null;
  return selected || list[0] || { model: DEFAULT_MODEL, streaming: true, connectionId: fallbackConnectionId };
}

// ============================================================================
// MCP label helpers
// ============================================================================

export function sanitizeMcpLabel(raw: string): string {
  // OpenAI requires: ^[A-Za-z][A-Za-z0-9_-]*$
  const cleaned = raw.replace(/[^A-Za-z0-9_-]/g, '-').replace(/^[^A-Za-z]+/, '');
  return cleaned || 'mcp-server';
}

export function mcpLabelFromUrl(url: string): string {
  try {
    const hostname = new URL(url).hostname;
    return sanitizeMcpLabel(hostname || url.slice(0, 40) || 'mcp-server');
  } catch {
    return sanitizeMcpLabel(url.slice(0, 40) || 'mcp-server');
  }
}

export function formatMcpLabel(serverLabel: string): string {
  if (!serverLabel || serverLabel.toLowerCase() === 'mcp') return 'MCP';
  return serverLabel;
}

// ============================================================================
// Provider adapter contract
// ============================================================================

export type ContentPart =
  | { type: 'input_text'; text: string }
  | { type: 'input_image'; image_url: string }
  | { type: 'input_video'; video_url: string; mimeType: string }
  | { type: 'input_audio'; audio_url: string; mimeType: string }
  | { type: 'input_file'; file_data: string; filename: string };

export type ProviderInput = string | Array<{ role: string; content: string | ContentPart[] }>;

export interface ProviderParams {
  maxOutputTokens?: number | null;
  topP?: number | null;
  temperature?: number | null;
  reasoningEffort?: ReasoningEffort;
  textVerbosity?: TextVerbosity;
  reasoningSummary?: ReasoningSummary;
  thinkingEnabled?: boolean;
  thinkingBudgetTokens?: number | null;
}

export interface ProviderTools {
  webSearch?: WebSearchOptions;
  codeInterpreter?: CodeInterpreterOptions;
  shell?: ShellOptions;
  imageGeneration?: ImageGenerationOptions;
  mcpServers?: McpServerConfig[];
}

export interface ProviderCallbacks {
  onEvent?: (event: unknown) => void;
  onTextDelta?: (fullText: string, delta?: string, event?: unknown) => void;
  onReasoningSummaryDelta?: (fullSummary: string, delta: string, event?: unknown) => void;
  onReasoningSummaryDone?: (fullSummary: string, event?: unknown) => void;
  onWebSearchResult?: (result: WebSearchResult) => void;
  onImageGenerated?: (images: GeneratedImage[]) => void;
}

export interface ProviderRequestContext {
  model: string;
  apiKey: string;
  /** Normalized base URL (OpenAI-compatible providers). */
  baseURL: string;
  /** Raw base URL from the connection (Gemini uses its own default). */
  apiBaseUrl?: string;
  input: ProviderInput;
  params: ProviderParams;
  tools: ProviderTools;
  callbacks: ProviderCallbacks;
  /** Registers an abort function with the caller. */
  provideAbort: (fn: () => void) => void;
}

export interface ProviderAdapter {
  respond(ctx: ProviderRequestContext, stream: boolean): Promise<GenerationResponse>;
  listModels(options: { apiKey: string; baseURL: string }): Promise<string[]>;
}

// ============================================================================
// Input normalization (HistoryMessage[] -> role/ContentPart[] messages)
// ============================================================================

export function buildProviderInput(messages: HistoryMessage[] | undefined, prompt: string | undefined): ProviderInput {
  if (!Array.isArray(messages) || !messages.length) {
    return typeof prompt === 'string' ? prompt : '';
  }
  // Normalize: strip extra fields like ids/typing and keep valid roles only
  const allowed = new Set(['system', 'user', 'assistant']);
  return messages
    .filter(m => m && (typeof m.content === 'string' || (m.images && Array.isArray(m.images))) && allowed.has(m.role))
    .map(({ role, content, images }) => {
      // If there are images, convert content to array format
      if (images && Array.isArray(images) && images.length > 0) {
        const contentArray: ContentPart[] = [];
        if (content && typeof content === 'string') {
          contentArray.push({ type: 'input_text', text: content });
        }
        for (const img of images as ImageData[]) {
          if (img && typeof img.id === 'string' && typeof img.data === 'string') {
            const mimeType = normalizeMimeType(img.mimeType) || '';
            if (isImageMimeType(mimeType)) {
              contentArray.push({
                type: 'input_image',
                image_url: `data:${mimeType};base64,${img.data}`,
              });
            } else if (!mimeType && typeof img.data === 'string' && (!img.name || /\.(png|jpe?g|gif|webp|bmp|ico|svg|tiff?)$/i.test(img.name))) {
              // Legacy image data without mimeType - only assume image if name looks like one or is absent
              contentArray.push({
                type: 'input_image',
                image_url: `data:image/jpeg;base64,${img.data}`,
              });
            } else if (isVideoMimeType(mimeType)) {
              // Video attachments - supported by Gemini API
              contentArray.push({
                type: 'input_video',
                video_url: `data:${mimeType};base64,${img.data}`,
                mimeType: mimeType,
              });
            } else if (isAudioMimeType(mimeType)) {
              // Audio attachments - supported by Gemini API
              contentArray.push({
                type: 'input_audio',
                audio_url: `data:${mimeType};base64,${img.data}`,
                mimeType: mimeType,
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
}

// ============================================================================
// SSE plumbing
// ============================================================================

// Extract the JSON payload from an SSE line; returns null when the line is
// not a data line or carries the [DONE] sentinel. Per the SSE spec the space
// after "data:" is optional.
export function parseSseDataLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith('data:')) return null;
  const data = trimmed.slice(5).replace(/^ /, '');
  if (!data || data === '[DONE]') return null;
  return data;
}

export function extractStreamError(event: unknown): { code: string; message: string } | null {
  if (!event || typeof event !== 'object') return null;

  const eventObj = event as Record<string, unknown>;
  const type = typeof eventObj.type === 'string' ? eventObj.type : '';
  const topLevelError = eventObj.error && typeof eventObj.error === 'object'
    ? eventObj.error as Record<string, unknown>
    : null;
  const getCode = (errorObj: Record<string, unknown> | null, fallback: string): string => {
    if (!errorObj) return fallback;
    if (typeof errorObj.code === 'string' && errorObj.code.trim()) return errorObj.code.trim();
    if (typeof errorObj.type === 'string' && errorObj.type.trim()) return errorObj.type.trim();
    return fallback;
  };
  const getMessage = (errorObj: Record<string, unknown> | null, code: string): string => {
    if (errorObj && typeof errorObj.message === 'string' && errorObj.message.trim()) {
      return errorObj.message.trim();
    }
    return code ? `Stream failed (${code}).` : 'Stream failed.';
  };

  if (type === 'response.failed') {
    const responseObj = eventObj.response && typeof eventObj.response === 'object'
      ? eventObj.response as Record<string, unknown>
      : null;
    const errorObj = responseObj?.error && typeof responseObj.error === 'object'
      ? responseObj.error as Record<string, unknown>
      : topLevelError;
    const code = getCode(errorObj, 'response.failed');
    return { code, message: getMessage(errorObj, code) };
  }

  if (type === 'error' || (!type && topLevelError && !Array.isArray(eventObj.choices) && !Array.isArray(eventObj.output))) {
    const code = getCode(topLevelError, 'stream_error');
    return { code, message: getMessage(topLevelError, code) };
  }

  return null;
}

/**
 * Wraps a per-SSE-event handler into a per-line processor:
 * parses the data line, JSON-decodes it, forwards the raw event to onEvent,
 * throws on stream errors, then delegates to the handler.
 */
export function createSseJsonLineProcessor(
  handle: (chunk: Record<string, unknown>) => void,
  onEvent?: (event: unknown) => void,
): (line: string) => void {
  return (line: string) => {
    const data = parseSseDataLine(line);
    if (data == null) return;

    let chunk: Record<string, unknown>;
    try {
      chunk = JSON.parse(data);
    } catch {
      return; // ignore parse errors
    }
    try { onEvent?.(chunk); } catch { /* ignore */ }

    const streamError = extractStreamError(chunk);
    if (streamError) {
      throw new Error(streamError.message);
    }

    handle(chunk);
  };
}

/**
 * Reads an SSE response body line by line, buffering partial lines across
 * chunks and flushing the decoder at end of stream.
 */
export async function readSseLines(
  response: Response,
  processLine: (line: string) => void,
  isStopped?: () => boolean,
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        // Flush the decoder and process any remaining complete lines
        buffer += decoder.decode();
        for (const line of buffer.split('\n')) {
          processLine(line);
          if (isStopped?.()) break;
        }
        buffer = '';
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        processLine(line);
        if (isStopped?.()) break;
      }
      if (isStopped?.()) break;
    }
  } finally {
    try { reader.cancel().catch(() => {}); } catch { /* ignore */ }
    reader.releaseLock();
  }
}

/** Creates an AbortController and registers its abort with the caller. */
export function createAbort(provideAbort: (fn: () => void) => void): AbortController {
  const abortController = new AbortController();
  provideAbort(() => {
    try { abortController.abort(); } catch { /* ignore */ }
  });
  return abortController;
}

export async function ensureOkResponse(response: Response, errorPrefix: string): Promise<void> {
  if (response.ok) return;
  const errorText = await response.text().catch(() => '');
  throw new Error(`${errorPrefix} ${response.status}: ${errorText}`);
}

// ============================================================================
// Response text extraction (shared across providers)
// ============================================================================

export function collectContentText(content: unknown): string {
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

export function extractOutputText(res: unknown): string {
  const resObj = res as Record<string, unknown>;
  // SDK convenience property
  if (resObj && typeof resObj.output_text === 'string' && (resObj.output_text as string).length) return resObj.output_text as string;
  try {
    // Try Responses API shape - iterate through all output items to find message
    const parts = (resObj?.output ?? resObj?.choices ?? []) as unknown[];
    if (Array.isArray(parts) && parts.length) {
      for (const part of parts as Array<Record<string, unknown>>) {
        // Look for message type items (skip reasoning, web_search_call, etc.)
        if (part?.type === 'message' && part?.content) {
          const text = collectContentText(part.content);
          if (text) return text;
        }
        // Fallback for items without type
        if (!part?.type) {
          const content = part?.content ?? (part?.message as Record<string, unknown>)?.content ?? part;
          const text = collectContentText(content);
          if (text) return text;
        }
      }
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
  // No textual content found - never dump raw API JSON as the message
  return '';
}

// Normalize reasoning text by ensuring proper newlines before bold headers
export function normalizeReasoningText(text: string): string {
  if (!text) return '';
  // Add newlines before bold headers that don't have them (e.g., "...text.**Header**" -> "...text.\n\n**Header**")
  let normalized = text.replace(/([^\n])(\*\*[A-Z][^*]+\*\*)/g, '$1\n\n$2');
  // Normalize excessive newlines
  normalized = normalized.replace(/\n{4,}/g, '\n\n\n');
  return normalized;
}

// ============================================================================
// Model list helpers
// ============================================================================

export function sortModels(items: Array<{ id?: string; created?: number }>): Array<{ id: string; created: number }> {
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
