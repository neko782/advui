// Client-side OpenAI helper for Responses and Chat Completions APIs
// Uses native fetch for minimal bundle size

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
  ImageData,
  WebSearchOptions,
  WebSearchResult,
  WebSearchCitation,
  WebSearchSource,
  ImageGenerationOptions,
  GeneratedImage
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
    const apiMode: ApiMode = connection.apiMode === 'chat_completions' 
      ? 'chat_completions' 
      : connection.apiMode === 'gemini' 
        ? 'gemini' 
        : 'responses';
    return { id, apiKey, apiBaseUrl, apiMode };
  }
  const srcSettings = settings || loadSettings();
  const resolved = findConnection(srcSettings, connectionId);
  return {
    id: resolved?.id || null,
    apiKey: typeof resolved?.apiKey === 'string' ? resolved.apiKey : '',
    apiBaseUrl: resolved?.apiBaseUrl,
    apiMode: resolved?.apiMode === 'chat_completions' 
      ? 'chat_completions' 
      : resolved?.apiMode === 'gemini' 
        ? 'gemini' 
        : 'responses',
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

function isVideoMimeType(mimeType: string | undefined): boolean {
  const normalized = normalizeMimeType(mimeType);
  return normalized.startsWith('video/');
}

function isAudioMimeType(mimeType: string | undefined): boolean {
  const normalized = normalizeMimeType(mimeType);
  return normalized.startsWith('audio/');
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
    baseURL: clientOptions.baseURL || 'https://api.openai.com/v1',
  };
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
  | { type: 'input_video'; video_url: string; mimeType: string }
  | { type: 'input_audio'; audio_url: string; mimeType: string }
  | { type: 'input_file'; file_data: string; filename: string };

type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'file'; file: { file_data: string; filename: string } };

// Gemini API types
type GeminiPart = 
  | { text: string }
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

const DEFAULT_GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

// Convert messages to Gemini format
function convertToGeminiFormat(
  messages: Array<{ role: string; content: string | ContentPart[] }>,
  prompt?: string
): { contents: GeminiContent[]; systemInstruction?: { parts: Array<{ text: string }> } } {
  const contents: GeminiContent[] = [];
  let systemInstruction: { parts: Array<{ text: string }> } | undefined;

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
        systemInstruction = { parts: [{ text }] };
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
          // Extract base64 data from data URL
          const imageUrl = (part as { image_url: string }).image_url;
          const match = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
          if (match && match[1] && match[2]) {
            parts.push({
              inlineData: {
                mimeType: match[1],
                data: match[2],
              },
            });
          }
        } else if (part.type === 'input_video') {
          // Handle video attachments for Gemini
          const videoPart = part as { video_url: string; mimeType: string };
          const match = videoPart.video_url.match(/^data:([^;]+);base64,(.+)$/);
          if (match && match[1] && match[2]) {
            parts.push({
              inlineData: {
                mimeType: match[1],
                data: match[2],
              },
            });
          }
        } else if (part.type === 'input_audio') {
          // Handle audio attachments for Gemini
          const audioPart = part as { audio_url: string; mimeType: string };
          const match = audioPart.audio_url.match(/^data:([^;]+);base64,(.+)$/);
          if (match && match[1] && match[2]) {
            parts.push({
              inlineData: {
                mimeType: match[1],
                data: match[2],
              },
            });
          }
        } else if (part.type === 'input_file') {
          // Handle file attachments (PDFs, etc.)
          const filePart = part as { file_data: string; filename: string };
          const match = filePart.file_data.match(/^data:([^;]+);base64,(.+)$/);
          if (match && match[1] && match[2]) {
            parts.push({
              inlineData: {
                mimeType: match[1],
                data: match[2],
              },
            });
          }
        }
      }
    }

    if (parts.length > 0) {
      contents.push({ role: geminiRole, parts });
    }
  }

  return { contents, systemInstruction };
}

// Extract text from Gemini response
function extractGeminiText(res: unknown): string {
  const resObj = res as Record<string, unknown>;
  try {
    const candidates = resObj?.candidates as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(candidates) && candidates.length > 0) {
      const content = candidates[0]?.content as Record<string, unknown> | undefined;
      const parts = content?.parts as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(parts)) {
        return parts
          .filter(p => typeof p?.text === 'string')
          .map(p => p.text as string)
          .join('');
      }
    }
  } catch { /* ignore */ }
  return '';
}

// Extract text delta from Gemini streaming chunk
function extractGeminiStreamDelta(chunk: unknown): string {
  const chunkObj = chunk as Record<string, unknown>;
  try {
    const candidates = chunkObj?.candidates as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(candidates) && candidates.length > 0) {
      const content = candidates[0]?.content as Record<string, unknown> | undefined;
      const parts = content?.parts as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(parts)) {
        return parts
          .filter(p => typeof p?.text === 'string')
          .map(p => p.text as string)
          .join('');
      }
    }
  } catch { /* ignore */ }
  return '';
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
    webSearch,
    onWebSearchResult,
    imageGeneration,
    onImageGenerated,
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
    throw new Error('Missing API key. Set it in Settings.');
  }
  const apiMode = resolvedConnection.apiMode === 'chat_completions' 
    ? 'chat_completions' 
    : resolvedConnection.apiMode === 'gemini' 
      ? 'gemini' 
      : 'responses';
  const useChatCompletions = apiMode === 'chat_completions';
  const useGemini = apiMode === 'gemini';

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
  const { apiKey, baseURL } = clientConfig;

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

  // Build tools array for Responses API
  const tools: Record<string, unknown>[] = [];

  // Web Search tool (Responses API only)
  if (webSearch?.enabled && !useChatCompletions) {
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

  // Image Generation tool (Responses API only)
  if (imageGeneration?.enabled && !useChatCompletions) {
    const imageGenTool: Record<string, unknown> = { type: 'image_generation' };

    // Add model if specified (e.g., gpt-image-1, gpt-image-1-mini)
    if (imageGeneration.model) {
      imageGenTool.model = imageGeneration.model;
    }

    tools.push(imageGenTool);
  }

  // Add tools to request if any are enabled
  if (tools.length > 0) {
    request.tools = tools;
  }

  if (stream) {
    // Gemini streaming
    if (useGemini) {
      const abortController = new AbortController();
      provideAbort(() => {
        try { abortController.abort(); } catch { /* ignore */ }
      });

      const geminiBaseUrl = resolvedConnection.apiBaseUrl?.trim() || DEFAULT_GEMINI_BASE_URL;
      const geminiEndpoint = `${geminiBaseUrl}/models/${useModel}:streamGenerateContent?alt=sse&key=${apiKey}`;

      // Convert messages to Gemini format
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
      const tempVal = toClampedNumber(temperature, 0, 2);
      if (tempVal != null) generationConfig.temperature = tempVal;
      const topPVal = toClampedNumber(topP, 0, 1);
      if (topPVal != null) generationConfig.topP = topPVal;
      const tokens = toIntOrNull(maxOutputTokens);
      if (tokens != null) generationConfig.maxOutputTokens = tokens;
      if (Object.keys(generationConfig).length > 0) {
        geminiRequest.generationConfig = generationConfig;
      }

      const response = await fetch(geminiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(geminiRequest),
        signal: abortController.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`Gemini API error ${response.status}: ${errorText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');
      const decoder = new TextDecoder();

      let full = '';
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed === 'data: [DONE]') continue;
            if (!trimmed.startsWith('data: ')) continue;

            try {
              const chunk = JSON.parse(trimmed.slice(6));
              try { onEvent?.(chunk); } catch { /* ignore */ }

              const delta = extractGeminiStreamDelta(chunk);
              if (delta) {
                full += delta;
                try { onTextDelta?.(full, delta, chunk); } catch { /* ignore */ }
              }
            } catch { /* ignore parse errors */ }
          }
        }
      } finally {
        reader.releaseLock();
      }

      return { text: full, reasoningSummary: '' };
    }

    if (useChatCompletions) {
      const abortController = new AbortController();
      provideAbort(() => {
        try { abortController.abort(); } catch { /* ignore */ }
      });

      const response = await fetch(`${baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ ...chatRequest, stream: true }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`API error ${response.status}: ${errorText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');
      const decoder = new TextDecoder();

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

      let buffer = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed === 'data: [DONE]') continue;
            if (!trimmed.startsWith('data: ')) continue;

            try {
              const chunk = JSON.parse(trimmed.slice(6));
              try { onEvent?.(chunk); } catch { /* ignore */ }

              const deltaText = collectChatDeltaText(chunk);
              if (deltaText) {
                full += deltaText;
                try { onTextDelta?.(full); } catch { /* ignore */ }
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
            } catch { /* ignore parse errors */ }
          }
        }
      } finally {
        reader.releaseLock();
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

    // Stream Responses API via fetch
    const abortController = new AbortController();
    provideAbort(() => {
      try { abortController.abort(); } catch { /* ignore */ }
    });

    const response = await fetch(`${baseURL}/responses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ ...request, stream: true }),
      signal: abortController.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`API error ${response.status}: ${errorText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');
    const decoder = new TextDecoder();
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
    let completed = false;
    // Web search tracking
    const webSearchCitations: WebSearchCitation[] = [];
    const webSearchSources: WebSearchSource[] = [];
    let webSearchResultDelivered = false;
    // Image generation tracking
    const generatedImages: GeneratedImage[] = [];
    let imageGenerationDelivered = false;

    let buffer = '';
    const processEvent = (event: Record<string, unknown>) => {
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
        } else if (t === 'response.web_search_call.completed' || t === 'web_search_call') {
          // Handle web search call completion - extract sources from action if available
          const action = event?.action as Record<string, unknown> | undefined;
          if (action?.sources && Array.isArray(action.sources)) {
            for (const src of action.sources as Array<Record<string, unknown>>) {
              if (src?.url && typeof src.url === 'string') {
                webSearchSources.push({
                  url: src.url,
                  title: typeof src.title === 'string' ? src.title : undefined,
                  type: typeof src.type === 'string' ? src.type : undefined,
                });
              }
            }
          }
        } else if (t === 'response.image_generation_call.completed' || t === 'image_generation_call') {
          // Handle image generation call completion - extract image data
          const result = event?.result as string | undefined;
          const id = event?.id as string | undefined;
          const revisedPrompt = event?.revised_prompt as string | undefined;
          if (result && typeof result === 'string') {
            generatedImages.push({
              id: id || `img_${Date.now()}_${generatedImages.length}`,
              data: result,
              revisedPrompt: revisedPrompt,
            });
          }
        } else if (t === 'response.completed' || t === 'response.text.done' || t === 'response.done') {
          completed = true;
          // Extract citations and sources from completed response
          const response = event?.response as Record<string, unknown> | undefined;
          const output = response?.output as Array<Record<string, unknown>> | undefined;
          if (Array.isArray(output)) {
            for (const item of output) {
              // Extract citations from message content annotations
              if (item?.type === 'message' && item?.content) {
                const content = item.content as Array<Record<string, unknown>>;
                if (Array.isArray(content)) {
                  for (const part of content) {
                    if (part?.annotations && Array.isArray(part.annotations)) {
                      for (const ann of part.annotations as Array<Record<string, unknown>>) {
                        if (ann?.type === 'url_citation' && typeof ann.url === 'string') {
                          webSearchCitations.push({
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
              }
              // Extract sources from web_search_call action
              if (item?.type === 'web_search_call' && item?.action) {
                const action = item.action as Record<string, unknown>;
                if (action?.sources && Array.isArray(action.sources)) {
                  for (const src of action.sources as Array<Record<string, unknown>>) {
                    if (src?.url && typeof src.url === 'string') {
                      const exists = webSearchSources.some(s => s.url === src.url);
                      if (!exists) {
                        webSearchSources.push({
                          url: src.url,
                          title: typeof src.title === 'string' ? src.title : undefined,
                          type: typeof src.type === 'string' ? src.type : undefined,
                        });
                      }
                    }
                  }
                }
              }
              // Extract generated images from image_generation_call
              if (item?.type === 'image_generation_call') {
                const result = item.result as string | undefined;
                const id = item.id as string | undefined;
                const revisedPrompt = item.revised_prompt as string | undefined;
                if (result && typeof result === 'string') {
                  const exists = generatedImages.some(img => img.id === id);
                  if (!exists) {
                    generatedImages.push({
                      id: id || `img_${Date.now()}_${generatedImages.length}`,
                      data: result,
                      revisedPrompt: revisedPrompt,
                    });
                  }
                }
              }
            }
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
          if (!summaryDelivered) {
            const summary = buildSummary();
            if (summary) {
              try {
                onReasoningSummaryDone?.(summary, event);
                summaryDelivered = true;
              } catch { /* ignore */ }
            }
          }
        } else if (t === 'response.failed' || t === 'error') {
          const msg = ((event?.error as Record<string, unknown>)?.message as string) || 'Stream failed.';
          throw new Error(msg);
        }
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === 'data: [DONE]') continue;
          if (!trimmed.startsWith('data: ')) continue;

          try {
            const event = JSON.parse(trimmed.slice(6));
            processEvent(event);
            if (completed) break;
          } catch { /* ignore parse errors */ }
        }
        if (completed) break;
      }
    } finally {
      reader.releaseLock();
    }
    const finalSummary = buildSummary();
    if (!summaryDelivered && finalSummary) {
      try {
        onReasoningSummaryDone?.(finalSummary, null);
        summaryDelivered = true;
      } catch { /* ignore */ }
    }
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
      text: full,
      reasoningSummary: finalSummary,
      webSearchResult: (webSearchCitations.length > 0 || webSearchSources.length > 0)
        ? { citations: webSearchCitations, sources: webSearchSources }
        : undefined,
      generatedImages: generatedImages.length > 0 ? generatedImages : undefined,
    };
  } else {
    // Gemini non-streaming
    if (useGemini) {
      const abortController = new AbortController();
      provideAbort(() => {
        try { abortController.abort(); } catch { /* ignore */ }
      });

      const geminiBaseUrl = resolvedConnection.apiBaseUrl?.trim() || DEFAULT_GEMINI_BASE_URL;
      const geminiEndpoint = `${geminiBaseUrl}/models/${useModel}:generateContent?key=${apiKey}`;

      // Convert messages to Gemini format
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
      const tempVal = toClampedNumber(temperature, 0, 2);
      if (tempVal != null) generationConfig.temperature = tempVal;
      const topPVal = toClampedNumber(topP, 0, 1);
      if (topPVal != null) generationConfig.topP = topPVal;
      const tokens = toIntOrNull(maxOutputTokens);
      if (tokens != null) generationConfig.maxOutputTokens = tokens;
      if (Object.keys(generationConfig).length > 0) {
        geminiRequest.generationConfig = generationConfig;
      }

      const response = await fetch(geminiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(geminiRequest),
        signal: abortController.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`Gemini API error ${response.status}: ${errorText}`);
      }

      const res = await response.json();
      const text = extractGeminiText(res);
      return { text, reasoningSummary: '' };
    }

    if (useChatCompletions) {
      const abortController = new AbortController();
      provideAbort(() => {
        try { abortController.abort(); } catch { /* ignore */ }
      });

      const response = await fetch(`${baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(chatRequest),
        signal: abortController.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`API error ${response.status}: ${errorText}`);
      }

      const res = await response.json();
      const text = extractOutputText(res);
      const summary = extractChatReasoningSummary(res);
      try { onReasoningSummaryDone?.(summary || '', null); } catch { /* ignore */ }
      return { text, reasoningSummary: summary || '' };
    }

    const abortController = new AbortController();
    provideAbort(() => {
      try { abortController.abort(); } catch { /* ignore */ }
    });

    const response = await fetch(`${baseURL}/responses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(request),
      signal: abortController.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`API error ${response.status}: ${errorText}`);
    }

    const res = await response.json();
    const text = extractOutputText(res);
    const summary = extractReasoningSummary(res);
    const webSearchResult = extractWebSearchResult(res);
    const generatedImages = extractGeneratedImages(res);
    if (summary) {
      try { onReasoningSummaryDone?.(summary, null); } catch { /* ignore */ }
    }
    if (webSearchResult && (webSearchResult.citations.length > 0 || webSearchResult.sources.length > 0)) {
      try { onWebSearchResult?.(webSearchResult); } catch { /* ignore */ }
    }
    if (generatedImages && generatedImages.length > 0) {
      try { onImageGenerated?.(generatedImages); } catch { /* ignore */ }
    }
    return { text, reasoningSummary: summary, webSearchResult, generatedImages };
  }
}

// List available models via the official SDK
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
    baseURL = clientOptions.baseURL || 'https://api.openai.com/v1';
    apiMode = options.apiMode || 'responses';
  } else {
    const settings = loadSettings();
    const connection = resolveConnection({
      connectionId: options.connectionId,
      settings,
    });
    if (!connection.apiKey) throw new Error('Missing API key. Set it in Settings.');
    apiKey = connection.apiKey;
    baseURL = connection.apiBaseUrl || 'https://api.openai.com/v1';
    apiMode = connection.apiMode;
  }

  // Handle Gemini API
  if (apiMode === 'gemini') {
    const geminiBaseUrl = baseURL.includes('generativelanguage.googleapis.com') 
      ? baseURL 
      : DEFAULT_GEMINI_BASE_URL;
    const response = await fetch(`${geminiBaseUrl}/models?key=${apiKey}`, {
      method: 'GET',
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`Gemini API error ${response.status}: ${errorText}`);
    }

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

  // Handle OpenAI-compatible APIs
  const response = await fetch(`${baseURL}/models`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`API error ${response.status}: ${errorText}`);
  }

  const res = await response.json();
  const items = Array.isArray(res?.data) ? res.data : [];
  return sortModels(items).map(m => m.id);
}

// List models using a provided API key (without saving it)
export async function listModelsWithKey(apiKey: string, apiBaseUrl: string = '', apiMode?: ApiMode): Promise<string[]> {
  return listModels({ apiKey, apiBaseUrl, apiMode });
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

// Normalize reasoning text by ensuring proper newlines before bold headers
function normalizeReasoningText(text: string): string {
  if (!text) return '';
  // Add newlines before bold headers that don't have them (e.g., "...text.**Header**" -> "...text.\n\n**Header**")
  let normalized = text.replace(/([^\n])(\*\*[A-Z][^*]+\*\*)/g, '$1\n\n$2');
  // Normalize excessive newlines
  normalized = normalized.replace(/\n{4,}/g, '\n\n\n');
  return normalized;
}

function extractOutputText(res: unknown): string {
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
    return normalizeReasoningText(joined);
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

function extractWebSearchResult(res: unknown): WebSearchResult | undefined {
  const citations: WebSearchCitation[] = [];
  const sources: WebSearchSource[] = [];

  const processOutput = (output: unknown): void => {
    if (!Array.isArray(output)) return;
    for (const item of output as Array<Record<string, unknown>>) {
      // Extract citations from message content annotations
      if (item?.type === 'message' && item?.content) {
        const content = item.content as Array<Record<string, unknown>>;
        if (Array.isArray(content)) {
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
      }
      // Extract sources from web_search_call action
      if (item?.type === 'web_search_call' && item?.action) {
        const action = item.action as Record<string, unknown>;
        if (action?.sources && Array.isArray(action.sources)) {
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

  if (citations.length === 0 && sources.length === 0) return undefined;
  return { citations, sources };
}

function extractGeneratedImages(res: unknown): GeneratedImage[] | undefined {
  const images: GeneratedImage[] = [];

  const processOutput = (output: unknown): void => {
    if (!Array.isArray(output)) return;
    for (const item of output as Array<Record<string, unknown>>) {
      // Extract generated images from image_generation_call
      if (item?.type === 'image_generation_call') {
        const result = item.result as string | undefined;
        const id = item.id as string | undefined;
        const revisedPrompt = item.revised_prompt as string | undefined;
        if (result && typeof result === 'string') {
          const exists = images.some(img => img.id === id);
          if (!exists) {
            images.push({
              id: id || `img_${Date.now()}_${images.length}`,
              data: result,
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

function extractChatReasoningSummary(res: unknown): string {
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

