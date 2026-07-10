// ============================================================================
// Responses API provider adapter (OpenAI /responses)
// Handles streaming events, reasoning summaries interleaved with tool
// activity, web search, code interpreter, shell, image generation and MCP.
// ============================================================================

import { toIntOrNull, toClampedNumber } from '../../utils/numbers.js';
import { normalizeMcpServerList } from '../../utils/mcp.js';
import {
  createAbort,
  createSseJsonLineProcessor,
  ensureOkResponse,
  extractOutputText,
  formatMcpLabel,
  mcpLabelFromUrl,
  normalizeReasoningText,
  readSseLines,
  sanitizeMcpLabel,
  sortModels,
  type ProviderAdapter,
  type ProviderRequestContext,
} from '../core.js';
import type {
  GenerationResponse,
  WebSearchCitation,
  WebSearchSource,
  GeneratedImage,
  McpResponseItem,
} from '../../types/index.js';

// ============================================================================
// Request building
// ============================================================================

function buildResponsesRequest(ctx: ProviderRequestContext): Record<string, unknown> {
  const request: Record<string, unknown> = { model: ctx.model, input: ctx.input };

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
  const normalizedMcpServers = normalizeMcpServerList(mcpServers)
    .filter((server) => server.url);
  for (const server of normalizedMcpServers) {
    tools.push({
      type: 'mcp',
      server_label: server.label ? sanitizeMcpLabel(server.label) : mcpLabelFromUrl(server.url),
      server_url: server.url,
      require_approval: 'never',
    });
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

export function extractGeneratedImages(res: unknown): GeneratedImage[] | undefined {
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

export function extractMcpItems(res: unknown): McpResponseItem[] | undefined {
  const items: McpResponseItem[] = [];
  const seen = new Set<string>();

  const push = (item: McpResponseItem): void => {
    const key = `${item.type}:${item.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    items.push(item);
  };

  const processOutput = (output: unknown): void => {
    if (!Array.isArray(output)) return;
    for (const entry of output as Array<Record<string, unknown>>) {
      const type = typeof entry?.type === 'string' ? entry.type : '';
      if (type === 'mcp_call') {
        const id = typeof entry.id === 'string' ? entry.id : '';
        if (!id) continue;
        push({
          id,
          type: 'mcp_call',
          serverLabel: typeof entry.server_label === 'string' ? entry.server_label : '',
          name: typeof entry.name === 'string' ? entry.name : '',
          arguments: typeof entry.arguments === 'string' ? entry.arguments : null,
          output: typeof entry.output === 'string' ? entry.output : null,
          error: typeof entry.error === 'string' ? entry.error : null,
          status: typeof entry.status === 'string'
            ? entry.status as 'in_progress' | 'completed' | 'incomplete' | 'calling' | 'failed'
            : undefined,
          approvalRequestId: typeof entry.approval_request_id === 'string' ? entry.approval_request_id : null,
        });
        continue;
      }

      if (type === 'mcp_list_tools') {
        const id = typeof entry.id === 'string' ? entry.id : '';
        if (!id) continue;
        const tools = Array.isArray(entry.tools)
          ? entry.tools
              .filter((tool): tool is Record<string, unknown> => !!tool && typeof tool === 'object')
              .map((tool) => ({
                name: typeof tool.name === 'string' ? tool.name : '',
                description: typeof tool.description === 'string' ? tool.description : null,
                annotations: tool.annotations,
                inputSchema: tool.input_schema,
              }))
              .filter((tool) => tool.name)
          : [];
        push({
          id,
          type: 'mcp_list_tools',
          serverLabel: typeof entry.server_label === 'string' ? entry.server_label : '',
          tools,
          error: typeof entry.error === 'string' ? entry.error : null,
        });
        continue;
      }

      if (type === 'mcp_approval_request') {
        const id = typeof entry.id === 'string' ? entry.id : '';
        if (!id) continue;
        push({
          id,
          type: 'mcp_approval_request',
          serverLabel: typeof entry.server_label === 'string' ? entry.server_label : '',
          name: typeof entry.name === 'string' ? entry.name : '',
          arguments: typeof entry.arguments === 'string' ? entry.arguments : null,
        });
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

  return items.length > 0 ? items : undefined;
}

function buildToolLineFromItem(item: Record<string, unknown>): string {
  const type = typeof item?.type === 'string' ? item.type : '';
  if (type === 'web_search_call') {
    const action = item.action as Record<string, unknown> | undefined;
    const query = typeof action?.query === 'string' ? action.query : '';
    const sources = Array.isArray(action?.sources) ? action.sources as unknown[] : [];
    const status = typeof item.status === 'string' ? item.status : 'completed';
    let line = `**Web search** ${query ? `"${query}"` : ''} \u2014 *${status}*`;
    if (sources.length) line += ` (${sources.length} sources)`;
    return line;
  } else if (type === 'code_interpreter_call') {
    return `**Code interpreter** \u2014 *${typeof item.status === 'string' ? item.status : 'completed'}*`;
  } else if (type === 'shell_call') {
    return `**Shell** \u2014 *${typeof item.status === 'string' ? item.status : 'completed'}*`;
  } else if (type === 'image_generation_call') {
    return `**Image generation** \u2014 *${typeof item.status === 'string' ? item.status : 'completed'}*`;
  } else if (type === 'mcp_list_tools') {
    const sl = formatMcpLabel(typeof item.server_label === 'string' ? item.server_label : '');
    const tools = Array.isArray(item.tools) ? item.tools : [];
    return `**${sl}** discovered ${tools.length} tools \u2014 *completed*`;
  } else if (type === 'mcp_call') {
    const sl = formatMcpLabel(typeof item.server_label === 'string' ? item.server_label : '');
    const name = typeof item.name === 'string' ? item.name : '';
    const status = typeof item.status === 'string' ? item.status : 'completed';
    const error = typeof item.error === 'string' ? item.error : '';
    let line = `**${sl}** ${name ? `\`${name}\`` : ''} \u2014 *${status}*`;
    if (error) line += ` (${error})`;
    return line;
  }
  return '';
}

export function buildInterleavedFromOutput(output: unknown[]): string {
  if (!Array.isArray(output) || !output.length) return '';
  const parts: string[] = [];
  for (const item of output as Array<Record<string, unknown>>) {
    const type = typeof item?.type === 'string' ? item.type : '';
    if (type === 'reasoning') {
      const summaries = Array.isArray(item.summary) ? item.summary : [];
      for (const part of summaries as Array<Record<string, unknown>>) {
        if (part && typeof part.text === 'string' && part.text) parts.push(part.text);
      }
    } else {
      const line = buildToolLineFromItem(item);
      if (line) parts.push(line);
    }
  }
  if (!parts.length) return '';
  return normalizeReasoningText(parts.join('\n\n'));
}

// ============================================================================
// Streaming
// ============================================================================

async function respondStreaming(ctx: ProviderRequestContext): Promise<GenerationResponse> {
  const {
    onEvent,
    onTextDelta,
    onReasoningSummaryDelta,
    onReasoningSummaryDone,
    onWebSearchResult,
    onImageGenerated,
  } = ctx.callbacks;

  const abortController = createAbort(ctx.provideAbort);

  const response = await fetch(`${ctx.baseURL}/responses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ctx.apiKey}`,
    },
    body: JSON.stringify({ ...buildResponsesRequest(ctx), stream: true }),
    signal: abortController.signal,
  });
  await ensureOkResponse(response, 'API error');

  let full = '';
  type ResponseReasoningSummaryPart = {
    key: string;
    itemId: string;
    outputIndex: number | null;
    summaryIndex: number;
    order: number;
    text: string;
  };
  const summaryByKey = new Map<string, ResponseReasoningSummaryPart>();
  let nextSummaryOrder = 0;
  let summaryDelivered = false;
  const getResponseReasoningSummaryPart = (event: Record<string, unknown>) => {
    const summaryIndex = Number.isFinite(Number(event?.summary_index)) ? Number(event.summary_index) : 0;
    const outputIndex = Number.isFinite(Number(event?.output_index)) ? Number(event.output_index) : null;
    const eventItemId = typeof event?.item_id === 'string' && event.item_id.trim()
      ? event.item_id.trim()
      : '';
    const itemObj = event?.item && typeof event.item === 'object'
      ? event.item as Record<string, unknown>
      : null;
    const itemId = eventItemId || (typeof itemObj?.id === 'string' && itemObj.id.trim() ? itemObj.id.trim() : '');
    const key = `${outputIndex != null ? `output:${outputIndex}` : 'output:?'}:${itemId || 'item:?'}:summary:${summaryIndex}`;
    return { key, itemId, outputIndex, summaryIndex };
  };
  const upsertResponseReasoningSummary = (
    event: Record<string, unknown>,
    text: string,
    mode: 'append' | 'replace'
  ): void => {
    const part = getResponseReasoningSummaryPart(event);
    const existing = summaryByKey.get(part.key);
    const nextText = mode === 'append'
      ? `${existing?.text || ''}${text}`
      : (text || existing?.text || '');
    summaryByKey.set(part.key, {
      ...part,
      order: existing?.order ?? nextSummaryOrder++,
      text: nextText,
    });
  };
  let completed = false;
  // Web search tracking
  const webSearchCitations: WebSearchCitation[] = [];
  const webSearchSources: WebSearchSource[] = [];
  let webSearchResultDelivered = false;
  // Image generation tracking
  const generatedImages: GeneratedImage[] = [];
  let imageGenerationDelivered = false;
  let completedResponseOutput: unknown[] | null = null;

  // Tool activity tracking - interleaved with reasoning by outputIndex
  interface ToolActivityEntry {
    key: string;
    outputIndex: number | null;
    order: number;
    text: string;
  }
  const toolActivityByKey = new Map<string, ToolActivityEntry>();
  let nextToolOrder = 0;
  const buildCombinedSummary = (): string => {
    const allParts: { outputIndex: number | null; order: number; text: string }[] = [];
    for (const part of summaryByKey.values()) {
      allParts.push({ outputIndex: part.outputIndex, order: part.order, text: part.text });
    }
    for (const entry of toolActivityByKey.values()) {
      allParts.push({ outputIndex: entry.outputIndex, order: entry.order, text: entry.text });
    }
    allParts.sort((a, b) => {
      const aOut = a.outputIndex ?? Number.MAX_SAFE_INTEGER;
      const bOut = b.outputIndex ?? Number.MAX_SAFE_INTEGER;
      if (aOut !== bOut) return aOut - bOut;
      return a.order - b.order;
    });
    const texts = allParts.map(p => p.text).filter(Boolean);
    if (!texts.length) return '';
    return normalizeReasoningText(texts.join('\n\n'));
  };
  // Stable synthetic keys for id-less tool events so lifecycle events
  // (in_progress -> completed) for the same tool call map to one entry.
  const syntheticToolKeys = new Map<string, string>();
  const upsertToolActivity = (event: Record<string, unknown>, text: string) => {
    const outputIndex = Number.isFinite(Number(event?.output_index)) ? Number(event.output_index) : null;
    let id = (typeof event?.item_id === 'string' && event.item_id) ? event.item_id
      : (typeof event?.id === 'string' && event.id) ? event.id
      : '';
    if (!id) {
      const rawType = typeof event?.type === 'string' ? event.type : 'tool';
      const identity = rawType
        .replace(/^response\./, '')
        .replace(/\.(in_progress|searching|completed|failed|interpreting|executing|generating)$/, '');
      if (outputIndex != null) {
        id = `tool_${identity}_${outputIndex}`;
      } else {
        let key = syntheticToolKeys.get(identity);
        if (!key) {
          key = `tool_${identity}_${syntheticToolKeys.size}`;
          syntheticToolKeys.set(identity, key);
        }
        id = key;
      }
    }
    const existing = toolActivityByKey.get(id);
    toolActivityByKey.set(id, { key: id, outputIndex: existing?.outputIndex ?? outputIndex, order: existing?.order ?? nextToolOrder++, text });
  };
  const emitToolActivityDelta = (event: Record<string, unknown>) => {
    const combined = buildCombinedSummary();
    if (combined) {
      try { onReasoningSummaryDelta?.(combined, '', event); } catch { /* ignore */ }
    }
  };
  // Cache item details from output_item.added (streaming events often lack them)
  const itemCache = new Map<string, { serverLabel: string; name: string }>();
  const getItemDetails = (event: Record<string, unknown>): { serverLabel: string; name: string } => {
    const itemId = (typeof event?.item_id === 'string' && event.item_id) ? event.item_id : '';
    const item = event?.item as Record<string, unknown> | undefined;
    // Try item first, then event, then cache
    const sl = typeof item?.server_label === 'string' ? item.server_label
      : typeof event?.server_label === 'string' ? event.server_label
      : itemCache.get(itemId)?.serverLabel || '';
    const name = typeof item?.name === 'string' ? item.name
      : typeof event?.name === 'string' ? event.name
      : itemCache.get(itemId)?.name || '';
    return { serverLabel: sl, name };
  };

  const processEvent = (event: Record<string, unknown>) => {
    const t = (event?.type || event?.event || '') as string;
    if (t === 'response.output_text.delta') {
      const delta = event?.delta || '';
      if (typeof delta === 'string' && delta) {
        full += delta;
        try { onTextDelta?.(full, delta, event); } catch { /* ignore */ }
      }
    } else if (t === 'response.reasoning_summary_text.delta') {
      const delta = event?.delta || '';
      if (typeof delta === 'string' && delta) {
        upsertResponseReasoningSummary(event, delta, 'append');
        const combined = buildCombinedSummary();
        try { onReasoningSummaryDelta?.(combined, delta, event); } catch { /* ignore */ }
      }
    } else if (t === 'response.reasoning_summary_text.done') {
      const text = typeof event?.text === 'string' ? event.text : '';
      if (text) upsertResponseReasoningSummary(event, text, 'replace');
      const combined = buildCombinedSummary();
      try {
        onReasoningSummaryDone?.(combined, event);
        summaryDelivered = true;
      } catch { /* ignore */ }
    // ---- Cache item details when output items are added ----
    } else if (t === 'response.output_item.added') {
      const item = event?.item as Record<string, unknown> | undefined;
      const itemId = typeof item?.id === 'string' ? item.id : '';
      if (itemId && item) {
        const sl = typeof item.server_label === 'string' ? item.server_label : '';
        const nm = typeof item.name === 'string' ? item.name : '';
        if (sl || nm) itemCache.set(itemId, { serverLabel: sl, name: nm });
      }
    // ---- Web search streaming events ----
    } else if (t === 'response.web_search_call.in_progress') {
      upsertToolActivity(event, `**Web search** \u2014 *starting*`);
      emitToolActivityDelta(event);
    } else if (t === 'response.web_search_call.searching') {
      const item = event?.item as Record<string, unknown> | undefined;
      const action = (item?.action || event?.action) as Record<string, unknown> | undefined;
      const query = typeof action?.query === 'string' ? action.query : '';
      upsertToolActivity(event, `**Web search** ${query ? `"${query}"` : ''} \u2014 *searching*`);
      emitToolActivityDelta(event);
    } else if (t === 'response.web_search_call.completed' || t === 'web_search_call') {
      upsertToolActivity(event, `**Web search** \u2014 *completed*`);
      emitToolActivityDelta(event);
      const item = event?.item as Record<string, unknown> | undefined;
      const action = (item?.action || event?.action) as Record<string, unknown> | undefined;
      if (action?.sources && Array.isArray(action.sources)) {
        for (const src of action.sources as Array<Record<string, unknown>>) {
          if (src?.url && typeof src.url === 'string') {
            webSearchSources.push({ url: src.url, title: typeof src.title === 'string' ? src.title : undefined, type: typeof src.type === 'string' ? src.type : undefined });
          }
        }
      }
    // ---- Code interpreter streaming events ----
    } else if (t === 'response.code_interpreter_call.in_progress') {
      upsertToolActivity(event, `**Code interpreter** \u2014 *starting*`);
      emitToolActivityDelta(event);
    } else if (t === 'response.code_interpreter_call.interpreting') {
      upsertToolActivity(event, `**Code interpreter** \u2014 *running*`);
      emitToolActivityDelta(event);
    } else if (t === 'response.code_interpreter_call.completed') {
      upsertToolActivity(event, `**Code interpreter** \u2014 *completed*`);
      emitToolActivityDelta(event);
    // ---- Shell streaming events ----
    } else if (t === 'response.shell_call.in_progress') {
      upsertToolActivity(event, `**Shell** \u2014 *starting*`);
      emitToolActivityDelta(event);
    } else if (t === 'response.shell_call.executing') {
      upsertToolActivity(event, `**Shell** \u2014 *executing*`);
      emitToolActivityDelta(event);
    } else if (t === 'response.shell_call.completed') {
      upsertToolActivity(event, `**Shell** \u2014 *completed*`);
      emitToolActivityDelta(event);
    // ---- Image generation streaming events ----
    } else if (t === 'response.image_generation_call.in_progress') {
      upsertToolActivity(event, `**Image generation** \u2014 *starting*`);
      emitToolActivityDelta(event);
    } else if (t === 'response.image_generation_call.generating') {
      upsertToolActivity(event, `**Image generation** \u2014 *generating*`);
      emitToolActivityDelta(event);
    } else if (t === 'response.image_generation_call.completed' || t === 'image_generation_call') {
      upsertToolActivity(event, `**Image generation** \u2014 *completed*`);
      emitToolActivityDelta(event);
      const item = event?.item as Record<string, unknown> | undefined;
      const result = (item?.result || event?.result) as string | undefined;
      const imgId = (item?.id || event?.id) as string | undefined;
      const revisedPrompt = (item?.revised_prompt || event?.revised_prompt) as string | undefined;
      if (result && typeof result === 'string') {
        generatedImages.push({ id: imgId || `img_${Date.now()}_${generatedImages.length}`, data: result, revisedPrompt });
      }
    // ---- MCP streaming events ----
    } else if (t === 'response.mcp_list_tools.in_progress') {
      const d = getItemDetails(event);
      upsertToolActivity(event, `**${formatMcpLabel(d.serverLabel)}** \u2014 *discovering tools*`);
      emitToolActivityDelta(event);
    } else if (t === 'response.mcp_list_tools.completed') {
      const d = getItemDetails(event);
      const item = event?.item as Record<string, unknown> | undefined;
      const toolsArr = item?.tools ?? event?.tools;
      const hasCount = Array.isArray(toolsArr) && toolsArr.length > 0;
      upsertToolActivity(event, `**${formatMcpLabel(d.serverLabel)}** ${hasCount ? `discovered ${toolsArr.length} tools` : 'tools discovered'} \u2014 *completed*`);
      emitToolActivityDelta(event);
    } else if (t === 'response.mcp_call.in_progress') {
      const d = getItemDetails(event);
      upsertToolActivity(event, `**${formatMcpLabel(d.serverLabel)}** ${d.name ? `\`${d.name}\`` : ''} \u2014 *calling*`);
      emitToolActivityDelta(event);
    } else if (t === 'response.mcp_call_arguments.delta') {
      // no-op for args streaming
    } else if (t === 'response.mcp_call_arguments.done') {
      const d = getItemDetails(event);
      upsertToolActivity(event, `**${formatMcpLabel(d.serverLabel)}** ${d.name ? `\`${d.name}\`` : ''} \u2014 *executing*`);
      emitToolActivityDelta(event);
    } else if (t === 'response.mcp_call.completed') {
      const d = getItemDetails(event);
      upsertToolActivity(event, `**${formatMcpLabel(d.serverLabel)}** ${d.name ? `\`${d.name}\`` : ''} \u2014 *completed*`);
      emitToolActivityDelta(event);
    } else if (t === 'response.mcp_call.failed') {
      const d = getItemDetails(event);
      const item = event?.item as Record<string, unknown> | undefined;
      const error = typeof (item?.error ?? event?.error) === 'string' ? (item?.error ?? event?.error) as string : '';
      upsertToolActivity(event, `**${formatMcpLabel(d.serverLabel)}** ${d.name ? `\`${d.name}\`` : ''} \u2014 *failed*${error ? ` (${error})` : ''}`);
      emitToolActivityDelta(event);
    // ---- Response completion ----
    } else if (t === 'response.completed' || t === 'response.text.done' || t === 'response.done') {
      completed = true;
      // Extract citations and sources from completed response
      const response = event?.response as Record<string, unknown> | undefined;
      const output = response?.output as Array<Record<string, unknown>> | undefined;
      completedResponseOutput = Array.isArray(output) ? output : null;
      if (Array.isArray(output)) {
        for (const item of output) {
          collectCitationsFromMessageItem(item, webSearchCitations);
          collectSourcesFromWebSearchItem(item, webSearchSources);
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
        // Update tool activity with final details from completed output
        for (let idx = 0; idx < output.length; idx++) {
          const outItem = output[idx];
          if (!outItem) continue;
          const outType = typeof outItem.type === 'string' ? outItem.type : '';
          const outId = typeof outItem.id === 'string' ? outItem.id : '';
          if (!outId) continue;
          if (!['mcp_list_tools', 'mcp_call', 'web_search_call', 'code_interpreter_call', 'shell_call', 'image_generation_call'].includes(outType)) continue;
          const text = buildToolLineFromItem(outItem);
          if (!text) continue;
          const existing = toolActivityByKey.get(outId);
          toolActivityByKey.set(outId, { key: outId, outputIndex: idx, order: existing?.order ?? nextToolOrder++, text });
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
        const combined = buildCombinedSummary();
        if (combined) {
          try {
            onReasoningSummaryDone?.(combined, event);
            summaryDelivered = true;
          } catch { /* ignore */ }
        }
      }
    }
  };

  const processLine = createSseJsonLineProcessor(processEvent, onEvent);
  await readSseLines(response, processLine, () => completed);

  const finalCombined = buildCombinedSummary();
  if (!summaryDelivered && finalCombined) {
    try {
      onReasoningSummaryDone?.(finalCombined, null);
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
  const mcpItems = extractMcpItems({ output: completedResponseOutput || [] });
  return {
    text: full,
    reasoningSummary: buildCombinedSummary(),
    webSearchResult: (webSearchCitations.length > 0 || webSearchSources.length > 0)
      ? { citations: webSearchCitations, sources: webSearchSources }
      : undefined,
    generatedImages: generatedImages.length > 0 ? generatedImages : undefined,
    mcpItems,
  };
}

// ============================================================================
// Non-streaming
// ============================================================================

async function respondOnce(ctx: ProviderRequestContext): Promise<GenerationResponse> {
  const { onReasoningSummaryDone, onWebSearchResult, onImageGenerated } = ctx.callbacks;
  const abortController = createAbort(ctx.provideAbort);

  const response = await fetch(`${ctx.baseURL}/responses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ctx.apiKey}`,
    },
    body: JSON.stringify(buildResponsesRequest(ctx)),
    signal: abortController.signal,
  });
  await ensureOkResponse(response, 'API error');

  const res = await response.json();
  const text = extractOutputText(res);
  const webSearchResult = extractWebSearchResult(res);
  const generatedImages = extractGeneratedImages(res);
  const mcpItems = extractMcpItems(res);
  const resObj = res as Record<string, unknown>;
  const outputArr = Array.isArray(resObj?.output) ? resObj.output as unknown[]
    : Array.isArray((resObj?.response as Record<string, unknown>)?.output)
      ? (resObj.response as Record<string, unknown>).output as unknown[] : [];
  const summary = buildInterleavedFromOutput(outputArr);
  if (summary) {
    try { onReasoningSummaryDone?.(summary, null); } catch { /* ignore */ }
  }
  if (webSearchResult && (webSearchResult.citations.length > 0 || webSearchResult.sources.length > 0)) {
    try { onWebSearchResult?.(webSearchResult); } catch { /* ignore */ }
  }
  if (generatedImages && generatedImages.length > 0) {
    try { onImageGenerated?.(generatedImages); } catch { /* ignore */ }
  }
  return { text, reasoningSummary: summary, webSearchResult, generatedImages, mcpItems };
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

export const responsesAdapter: ProviderAdapter = {
  respond(ctx, stream) {
    return stream ? respondStreaming(ctx) : respondOnce(ctx);
  },
  listModels,
};
