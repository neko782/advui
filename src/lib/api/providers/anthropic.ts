// ============================================================================
// Anthropic provider adapter (Claude Messages API, /v1/messages)
// Thinking, web search, code execution and remote MCP servers all run on
// Anthropic's side; their content blocks are reported as activity steps.
// ============================================================================

import { DEFAULT_API_BASE_URL } from '../../constants/index.js';
import { toIntOrNull, toClampedNumber } from '../../utils/numbers.js';
import { parseMcpAllowedTools } from '../../utils/mcp.js';
import { isPdfMimeType } from '../../attachments/mime.js';
import { ActivityLog, prettyJson } from '../activity.js';
import { browserToolNames, browserToolSpecs } from '../browserTools.js';
import { runToolLoop, type BrowserToolCall, type ToolRound } from '../toolLoop.js';
import {
  createAbort,
  createSseJsonLineProcessor,
  ensureOkResponse,
  labelMcpServers,
  nativeData,
  plainTurns,
  readSseLines,
  throwIfErrorBody,
  type ContentPart,
  type ProviderAdapter,
  type ProviderRequestContext,
} from '../core.js';
import type { ActivityStep, GenerationResponse, NativeTurn } from '../../types/index.js';

export const DEFAULT_ANTHROPIC_BASE_URL = 'https://api.anthropic.com/v1';
const ANTHROPIC_VERSION = '2023-06-01';
const MCP_BETA = 'mcp-client-2025-11-20';
const LEGACY_CODE_EXECUTION_BETA = 'code-execution-2025-08-25';
const LEGACY_WEB_FETCH_BETA = 'web-fetch-2025-09-10';
/** Lets a request ask for invalidated thinking blocks to be dropped instead of refused. */
const THINKING_BINDING_BETA = 'thinking-binding-controls-2026-08-01';
const DEFAULT_MAX_TOKENS = 32000;
const DEFAULT_THINKING_BUDGET = 8000;
/** How often a turn paused by the server-side tool loop is resumed. */
const MAX_CONTINUATIONS = 8;

type Json = Record<string, unknown>;

// ============================================================================
// Model generations
// ============================================================================

/**
 * Models before Claude 4.6 take a fixed thinking budget and the first
 * generation of server tools; 4.6 and later use adaptive thinking, effort
 * and the current tool versions. Unrecognized ids are treated as current.
 */
export function isLegacyClaudeModel(model: string): boolean {
  const id = model.toLowerCase();
  if (/claude-(3|2|instant)/.test(id)) return true;
  const match = /claude-(?:opus|sonnet|haiku)-(\d+)(?:[-.](\d{1,2}))?(?![\d])/.exec(id);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = match[2] ? Number(match[2]) : 0;
  return major < 4 || (major === 4 && minor < 6);
}

/**
 * How a model turns thinking off, for the "none" reasoning level. Fable,
 * Mythos and Opus 5.5+ always think (lowest effort is the closest), Sonnet
 * 5.5+ has a between-tools mode, the rest accept a plain disable.
 */
export function thinkingOffMode(model: string): 'disabled' | 'between_tools' | 'always_on' {
  const id = model.toLowerCase();
  if (/claude-(fable|mythos)/.test(id)) return 'always_on';
  const match = /claude-(opus|sonnet|haiku)-(\d+)(?:[-.](\d{1,2}))?(?![\d])/.exec(id);
  if (!match) return 'disabled';
  const version = Number(match[2]) + (match[3] ? Number(match[3]) / 100 : 0);
  if (match[1] === 'opus' && version >= 5.05) return 'always_on';
  if (match[1] === 'sonnet' && version >= 5.05) return 'between_tools';
  return 'disabled';
}

// ============================================================================
// Request building
// ============================================================================

function splitDataUrl(dataUrl: string): { mimeType: string; data: string } | null {
  const match = /^data:([^;,]*)(?:;[^,]*)?,([\s\S]*)$/.exec(dataUrl);
  return match && match[2] ? { mimeType: match[1] || '', data: match[2] } : null;
}

function decodeBase64Text(data: string): string | null {
  try {
    const bytes = Uint8Array.from(atob(data), char => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

function toContentBlocks(parts: ContentPart[]): Json[] {
  const blocks: Json[] = [];
  for (const part of parts) {
    if (part.type === 'input_text') {
      if (part.text) blocks.push({ type: 'text', text: part.text });
    } else if (part.type === 'input_image') {
      const image = splitDataUrl(part.image_url);
      if (image) blocks.push({ type: 'image', source: { type: 'base64', media_type: image.mimeType || 'image/jpeg', data: image.data } });
    } else if (part.type === 'input_file') {
      const file = splitDataUrl(part.file_data);
      if (!file) continue;
      if (isPdfMimeType(file.mimeType) || part.filename.toLowerCase().endsWith('.pdf')) {
        blocks.push({ type: 'document', title: part.filename, source: { type: 'base64', media_type: 'application/pdf', data: file.data } });
      } else {
        // Claude reads other files as plain text; binary formats are left out.
        const text = /^(text\/|application\/(json|xml|javascript|x-yaml|yaml))/.test(file.mimeType) || !file.mimeType || file.mimeType === 'application/octet-stream'
          ? decodeBase64Text(file.data)
          : null;
        if (text && !text.includes('\u0000')) {
          blocks.push({ type: 'document', title: part.filename, source: { type: 'text', media_type: 'text/plain', data: text } });
        }
      }
    }
    // Audio and video are not accepted by the Messages API.
  }
  // Documents and images go before the text that refers to them.
  return [...blocks.filter(b => b.type !== 'text'), ...blocks.filter(b => b.type === 'text')];
}

/** What the request offers, which decides which stored tool blocks can go back. */
export interface ReplayScope {
  endpoint: string;
  /** Whether web search, web fetch or code execution is declared. */
  serverTools: boolean;
  /** Names of the MCP servers declared. */
  mcpServers: ReadonlySet<string>;
  /** Names of the browser tools declared. */
  clientTools?: ReadonlySet<string>;
}

const TOOL_USE_TYPES = new Set(['server_tool_use', 'mcp_tool_use']);

/**
 * A stored reply's content blocks, ready to send back unchanged, or null
 * when they cannot be: a block the API would reject (thinking cut off before
 * its signature) or a tool call whose tool this request no longer declares.
 * Thinking blocks go back on every request, whichever model reads them; the
 * API drops, unbilled, those the current model cannot use.
 */
export function replayBlocks(data: unknown, scope: Omit<ReplayScope, 'endpoint'>): Json[] | null {
  if (!Array.isArray(data) || !data.length) return null;
  const blocks = data.filter((block): block is Json => !!block && typeof block === 'object');
  for (const block of blocks) {
    const type = str(block.type);
    if (type === 'thinking' && !str(block.signature)) return null;
    if (type === 'redacted_thinking' && !str(block.data)) return null;
    if (type === 'mcp_tool_use' && !scope.mcpServers.has(str(block.server_name))) return null;
    if (type === 'tool_use' && !scope.clientTools?.has(str(block.name))) return null;
    if ((type === 'server_tool_use' || (type.endsWith('_tool_result') && type !== 'mcp_tool_result')) && !scope.serverTools) return null;
  }
  // A tool call has to be followed by its result.
  const answered = new Set(blocks.filter(b => str(b.type).endsWith('_tool_result')).map(b => str(b.tool_use_id)));
  if (blocks.some(b => TOOL_USE_TYPES.has(str(b.type)) && !answered.has(str(b.id)))) return null;
  return blocks;
}

/**
 * A stored reply as the messages it goes back as. A reply that called
 * browser tools is several messages (each call answered by a user turn of
 * results); it only goes back whole, ending with the assistant.
 */
export function replayMessages(data: unknown, scope: Omit<ReplayScope, 'endpoint'>): Json[] | null {
  if (Array.isArray(data)) {
    const blocks = replayBlocks(data, scope);
    return blocks ? [{ role: 'assistant', content: blocks }] : null;
  }
  const messages = data && typeof data === 'object' ? (data as Json).messages : undefined;
  if (!Array.isArray(messages) || !messages.length) return null;
  const out: Json[] = [];
  for (const [index, message] of (messages as Json[]).entries()) {
    if (message?.role === 'assistant') {
      const blocks = replayBlocks(message.content, scope);
      if (!blocks) return null;
      const calls = blocks.filter(block => block.type === 'tool_use').map(block => str(block.id));
      if (calls.length) {
        const next = (messages as Json[])[index + 1];
        const results = Array.isArray(next?.content) ? (next.content as Json[]).filter(block => block?.type === 'tool_result') : [];
        if (next?.role !== 'user' || !calls.every(id => results.some(block => str(block.tool_use_id) === id))) return null;
      }
      out.push({ role: 'assistant', content: blocks });
    } else if (message?.role === 'user' && Array.isArray(message.content)) {
      out.push({ role: 'user', content: message.content });
    } else {
      return null;
    }
  }
  return out[out.length - 1]?.role === 'assistant' ? out : null;
}

export function convertToAnthropicFormat(
  input: ProviderRequestContext['input'],
  scope?: ReplayScope,
): { system: string; messages: Json[]; replayedThinking: boolean } {
  if (!Array.isArray(input)) {
    return { system: '', messages: input ? [{ role: 'user', content: input }] : [], replayedThinking: false };
  }
  const systemTexts: string[] = [];
  const messages: Json[] = [];
  let replayedThinking = false;
  for (const msg of input) {
    if (msg.role === 'system') {
      const text = typeof msg.content === 'string'
        ? msg.content
        : msg.content.filter(p => p.type === 'input_text').map(p => (p as { text: string }).text).join('\n');
      if (text.trim()) systemTexts.push(text);
      continue;
    }
    const role = msg.role === 'assistant' ? 'assistant' : 'user';
    const native = role === 'assistant' && scope
      ? replayMessages(nativeData(msg, 'anthropic', scope.endpoint), scope)
      : null;
    if (native) {
      messages.push(...native);
      if (native.some(message => message.role === 'assistant'
        && (message.content as Json[]).some(block => block.type === 'thinking' || block.type === 'redacted_thinking'))) {
        replayedThinking = true;
      }
    } else {
      for (const turn of plainTurns(msg)) {
        const turnRole = turn.role === 'assistant' ? 'assistant' : 'user';
        if (typeof turn.content === 'string') {
          // Empty text blocks are rejected.
          if (turn.content.trim()) messages.push({ role: turnRole, content: turn.content });
        } else {
          const blocks = toContentBlocks(turn.content);
          if (blocks.length) messages.push({ role: turnRole, content: blocks });
        }
      }
    }
  }
  // A conversation has to open with the user (character greetings do not).
  if (messages[0]?.role === 'assistant') messages.unshift({ role: 'user', content: '[Start]' });
  return { system: systemTexts.join('\n\n'), messages, replayedThinking };
}

function buildTools(ctx: ProviderRequestContext, legacy: boolean): { tools: Json[]; mcpServers: Json[] } {
  const { webSearch, webFetch, codeInterpreter, mcpServers } = ctx.tools;
  const tools: Json[] = [];
  const codeExecution = !!codeInterpreter?.enabled;

  if (webSearch?.enabled) {
    // The current web search runs its own code execution to filter results,
    // so it is not combined with a separately declared code execution tool.
    const tool: Json = { type: legacy || codeExecution ? 'web_search_20250305' : 'web_search_20260209', name: 'web_search' };
    if (webSearch.filters?.allowed_domains?.length) tool.allowed_domains = webSearch.filters.allowed_domains;
    if (webSearch.user_location) {
      const loc: Record<string, string> = { type: 'approximate' };
      for (const key of ['country', 'city', 'region', 'timezone'] as const) {
        const value = webSearch.user_location[key];
        if (value) loc[key] = value;
      }
      tool.user_location = loc;
    }
    tools.push(tool);
  }

  if (webFetch) {
    // Like web search, the current version filters with its own code execution.
    tools.push({ type: legacy || codeExecution ? 'web_fetch_20250910' : 'web_fetch_20260209', name: 'web_fetch' });
  }

  if (codeExecution) {
    tools.push({ type: legacy ? 'code_execution_20250825' : 'code_execution_20260521', name: 'code_execution' });
  }

  for (const spec of browserToolSpecs(ctx.tools.browserTools)) {
    tools.push({ name: spec.name, description: spec.description, input_schema: spec.parameters });
  }

  const servers: Json[] = [];
  for (const { server, label } of labelMcpServers(mcpServers)) {
    const entry: Json = { type: 'url', url: server.url, name: label };
    if (server.authorization) entry.authorization_token = server.authorization;
    servers.push(entry);
    // Every server needs exactly one toolset that refers to it by name.
    const toolset: Json = { type: 'mcp_toolset', mcp_server_name: label };
    const allowed = parseMcpAllowedTools(server.allowedTools);
    if (allowed.length) {
      toolset.default_config = { enabled: false };
      toolset.configs = Object.fromEntries(allowed.map(name => [name, { enabled: true }]));
    }
    tools.push(toolset);
  }

  return { tools, mcpServers: servers };
}

export function buildAnthropicRequest(ctx: ProviderRequestContext): { body: Json; betas: string[] } {
  const legacy = isLegacyClaudeModel(ctx.model);
  const endpoint = anthropicBaseUrl(ctx.apiBaseUrl);
  const { system, messages, replayedThinking } = convertToAnthropicFormat(ctx.input, {
    endpoint,
    serverTools: !!(ctx.tools.webSearch?.enabled || ctx.tools.webFetch || ctx.tools.codeInterpreter?.enabled),
    mcpServers: new Set(labelMcpServers(ctx.tools.mcpServers).map(({ label }) => label)),
    clientTools: browserToolNames(ctx.tools.browserTools),
  });
  const { reasoningEffort, reasoningSummary, thinkingEnabled, thinkingBudgetTokens } = ctx.params;

  let maxTokens = toIntOrNull(ctx.params.maxOutputTokens, { belowMin: 'unset' })
    ?? (/claude-(3|2|instant)/.test(ctx.model.toLowerCase()) ? 4096 : DEFAULT_MAX_TOKENS);

  const body: Json = { model: ctx.model, messages };
  if (system) body.system = system;

  if (legacy) {
    // Fixed-budget thinking, opted into with the "Anthropic thinking" setting.
    if (thinkingEnabled) {
      const budget = Math.max(1024, toIntOrNull(thinkingBudgetTokens, { belowMin: 'unset' }) ?? DEFAULT_THINKING_BUDGET);
      body.thinking = { type: 'enabled', budget_tokens: budget };
      if (maxTokens <= budget) maxTokens = budget + 4096;
    }
  } else if (reasoningEffort === 'none' && thinkingOffMode(ctx.model) !== 'always_on') {
    body.thinking = { type: thinkingOffMode(ctx.model) };
  } else if (reasoningEffort === 'none') {
    // Thinking cannot be turned off here; the lowest effort is the closest.
    body.thinking = { type: 'adaptive' };
    body.output_config = { effort: 'low' };
  } else {
    // Summaries have to be asked for; without them thinking blocks arrive empty.
    body.thinking = reasoningSummary === 'none'
      ? { type: 'adaptive' }
      : { type: 'adaptive', display: 'summarized' };
    if (reasoningEffort && reasoningEffort !== 'default' && reasoningEffort !== 'minimal') {
      body.output_config = { effort: reasoningEffort };
    }
  }
  body.max_tokens = maxTokens;

  // Sampling parameters are only accepted by older models; they are sent
  // when set (the controls live behind "Deprecated parameters").
  const tempVal = toClampedNumber(ctx.params.temperature, 0, 1);
  if (tempVal != null) body.temperature = tempVal;
  const topPVal = toClampedNumber(ctx.params.topP, 0, 1);
  if (topPVal != null) body.top_p = topPVal;

  const { tools, mcpServers } = buildTools(ctx, legacy);
  if (tools.length) body.tools = tools;
  if (mcpServers.length) body.mcp_servers = mcpServers;

  const betas: string[] = [];
  // Editing or branching earlier turns, or changing the system prompt or
  // tools, invalidates the thinking blocks that came after; the API is asked
  // to drop those rather than refuse the request. Only the official API is
  // known to accept this, and only alongside adaptive thinking.
  const thinking = body.thinking as Json | undefined;
  if (replayedThinking && thinking?.type === 'adaptive' && endpoint === DEFAULT_ANTHROPIC_BASE_URL) {
    body.thinking = { ...thinking, block_binding: { prefix_mismatch_behavior: 'drop_block' } };
    betas.push(THINKING_BINDING_BETA);
  }
  if (mcpServers.length) betas.push(MCP_BETA);
  if (legacy && ctx.tools.codeInterpreter?.enabled) betas.push(LEGACY_CODE_EXECUTION_BETA);
  if (legacy && ctx.tools.webFetch) betas.push(LEGACY_WEB_FETCH_BETA);
  return { body, betas };
}

export function anthropicBaseUrl(baseURL?: string): string {
  const configured = baseURL?.trim().replace(/\/+$/, '');
  // Connections store the app's default URL for every API mode; neither it
  // nor the OpenAI one is an Anthropic endpoint.
  if (!configured || configured === DEFAULT_API_BASE_URL || configured === 'https://api.openai.com/v1') return DEFAULT_ANTHROPIC_BASE_URL;
  return configured;
}

function anthropicHeaders(apiKey: string, betas: string[] = []): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': ANTHROPIC_VERSION,
    // Required for calls made straight from a browser with the user's own key.
    'anthropic-dangerous-direct-browser-access': 'true',
  };
  if (betas.length) headers['anthropic-beta'] = betas.join(',');
  return headers;
}

// ============================================================================
// Content blocks -> text and activity steps
// ============================================================================

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function firstLine(text: string): string {
  return text.split('\n').find(line => line.trim())?.trim() || '';
}

/** The step a server-side tool call starts as, refined once its input is known. */
function describeToolUse(block: Json): Partial<ActivityStep> {
  const name = str(block.name);
  const input = block.input && typeof block.input === 'object' ? block.input as Json : {};
  const hasInput = Object.keys(input).length > 0;
  if (block.type === 'mcp_tool_use') {
    return { kind: 'mcp', subject: name, server: str(block.server_name) || undefined, input: hasInput ? prettyJson(input) : undefined };
  }
  switch (name) {
    case 'web_search':
      return { kind: 'search', subject: str(input.query) || undefined };
    case 'web_fetch':
      return { kind: 'fetch', subject: str(input.url) || undefined };
    case 'code_execution':
      return { kind: 'code', input: str(input.code) || (hasInput ? prettyJson(input) : undefined) };
    case 'bash_code_execution':
      return { kind: 'shell', subject: firstLine(str(input.command)) || undefined, input: str(input.command) || undefined };
    case 'text_editor_code_execution': {
      const command = str(input.command);
      const verb = command === 'view' ? 'Viewed' : command === 'create' ? 'Created' : 'Edited';
      return { kind: 'tool', subject: `${verb} ${str(input.path) || 'a file'}`, input: str(input.file_text) || (hasInput ? prettyJson(input) : undefined) };
    }
    default:
      return { kind: 'tool', subject: name || undefined, input: hasInput ? prettyJson(input) : undefined };
  }
}

function blockText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map(part => (part && typeof part === 'object' ? str((part as Json).text) : ''))
    .filter(Boolean)
    .join('\n');
}

/** What a `*_tool_result` block adds to the step of the call it answers. */
function describeToolResult(block: Json): Partial<ActivityStep> {
  const content = block.content;
  const obj = content && typeof content === 'object' && !Array.isArray(content) ? content as Json : null;

  // Server-tool failures come back as a result holding an error code.
  if (obj && (str(obj.error_code) || str(obj.type).endsWith('_error'))) {
    return { status: 'failed', error: str(obj.error_code) || str(obj.type) };
  }

  if (block.type === 'mcp_tool_result') {
    const text = blockText(content);
    return block.is_error === true
      ? { status: 'failed', error: text || 'The tool reported an error.' }
      : { status: 'done', output: prettyJson(text) || undefined };
  }

  if (block.type === 'web_search_tool_result' && Array.isArray(content)) {
    const lines = (content as Json[])
      .filter(result => str(result?.url))
      .map(result => (str(result.title) ? `${str(result.title)}\n${str(result.url)}` : str(result.url)));
    return { status: 'done', output: lines.join('\n\n') || undefined };
  }

  if (block.type === 'web_fetch_tool_result' && obj) {
    const doc = obj.content && typeof obj.content === 'object' ? obj.content as Json : null;
    const source = doc?.source && typeof doc.source === 'object' ? doc.source as Json : null;
    const body = source?.type === 'text' ? str(source.data) : '';
    return { status: 'done', output: [str(doc?.title), str(obj.url), body].filter(Boolean).join('\n\n') || undefined };
  }

  if (obj && ('stdout' in obj || 'stderr' in obj || 'return_code' in obj)) {
    const output = [str(obj.stdout), str(obj.stderr)].filter(text => text.trim()).join('\n');
    const code = typeof obj.return_code === 'number' ? obj.return_code : 0;
    return code !== 0
      ? { status: 'failed', output: output || undefined, error: `Exit code ${code}` }
      : { status: 'done', output: output || undefined };
  }

  if (obj) {
    const text = str(obj.content) || blockText(obj.content);
    // Results that only acknowledge the call (e.g. a file write) have nothing to show.
    return { status: 'done', output: text || undefined };
  }
  return { status: 'done', output: blockText(content) || undefined };
}

interface TurnResult {
  /** Content blocks as the API needs them back to resume a paused turn. */
  blocks: Json[];
  stopReason: string;
  stopDetails: Json | null;
}

/**
 * Collects one reply across as many API turns as it takes: the visible text,
 * the activity steps, and the raw content blocks of the turn in progress.
 */
class ReplyReader {
  text = '';
  readonly log: ActivityLog;
  private turn = 0;
  private blocks: Json[] = [];
  private partialJson = new Map<number, string>();

  constructor(private callbacks: ProviderRequestContext['callbacks']) {
    this.log = new ActivityLog(callbacks.onActivity);
  }

  beginTurn(): void {
    this.turn++;
    this.blocks = [];
    this.partialJson.clear();
  }

  private thinkingId(index: number): string {
    return `thinking-${this.turn}-${index}`;
  }

  startBlock(index: number, block: Json, event?: unknown): void {
    this.blocks[index] = { ...block };
    const type = str(block.type);
    if (type === 'text') {
      this.addText(str(block.text), event);
    } else if (type === 'thinking') {
      this.log.set(this.thinkingId(index), { kind: 'thinking', status: 'running', text: str(block.thinking) });
    } else if (type === 'server_tool_use' || type === 'mcp_tool_use') {
      const id = str(block.id);
      if (id) this.log.set(id, { status: 'running', ...describeToolUse(block) });
    } else if (type === 'tool_use') {
      // A browser tool call: the tool loop reports it once it runs.
    } else if (type.endsWith('_tool_result')) {
      const id = str(block.tool_use_id);
      if (id) this.log.set(id, describeToolResult(block));
    }
  }

  delta(index: number, delta: Json, event?: unknown): void {
    const block = this.blocks[index];
    if (!block) return;
    const type = str(delta.type);
    if (type === 'text_delta') {
      block.text = str(block.text) + str(delta.text);
      this.addText(str(delta.text), event);
    } else if (type === 'thinking_delta') {
      block.thinking = str(block.thinking) + str(delta.thinking);
      this.log.append(this.thinkingId(index), 'text', str(delta.thinking), { kind: 'thinking', status: 'running' });
    } else if (type === 'signature_delta') {
      block.signature = str(block.signature) + str(delta.signature);
    } else if (type === 'input_json_delta') {
      this.partialJson.set(index, (this.partialJson.get(index) || '') + str(delta.partial_json));
    } else if (type === 'citations_delta' && delta.citation) {
      block.citations = [...(Array.isArray(block.citations) ? block.citations : []), delta.citation];
    }
  }

  stopBlock(index: number): void {
    const block = this.blocks[index];
    if (!block) return;
    const type = str(block.type);
    if (type === 'thinking') {
      const id = this.thinkingId(index);
      if (this.log.has(id)) this.log.set(id, { status: 'done' });
    } else if (type === 'server_tool_use' || type === 'mcp_tool_use' || type === 'tool_use') {
      const json = this.partialJson.get(index);
      if (json) {
        try { block.input = JSON.parse(json); } catch { /* keep the input the block started with */ }
      }
      const id = str(block.id);
      if (id && type !== 'tool_use') this.log.set(id, describeToolUse(block));
    }
  }

  private addText(delta: string, event?: unknown): void {
    if (!delta) return;
    this.text += delta;
    try { this.callbacks.onTextDelta?.(this.text, delta, event); } catch { /* ignore */ }
  }

  /** The finished turn's blocks, without the empty fields the API rejects. */
  turnBlocks(): Json[] {
    return this.blocks.filter(Boolean).map(block => {
      const clean = { ...block };
      if (clean.citations == null) delete clean.citations;
      return clean;
    });
  }
}

function stopError(stopReason: string, stopDetails: Json | null): Error | null {
  if (stopReason === 'max_tokens') {
    return new Error('The reply hit the max output tokens limit before any text was produced. Raise the limit and regenerate.');
  }
  if (stopReason === 'refusal') {
    const explanation = str(stopDetails?.explanation);
    return new Error(explanation ? `Claude declined to reply: ${explanation}` : 'Claude declined to reply to this request.');
  }
  if (stopReason === 'model_context_window_exceeded') {
    return new Error('The conversation no longer fits in the model\'s context window.');
  }
  if (stopReason === 'pause_turn') {
    return new Error('The reply was still using tools when it reached the continuation limit. Regenerate to try again.');
  }
  return null;
}

// ============================================================================
// Requests
// ============================================================================

async function streamTurn(url: string, headers: Record<string, string>, body: Json, signal: AbortSignal, reader: ReplyReader, onEvent?: (event: unknown) => void): Promise<TurnResult> {
  const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ ...body, stream: true }), signal });
  await ensureOkResponse(response, 'Anthropic API error');

  let stopReason = '';
  let stopDetails: Json | null = null;
  let finished = false;

  const processLine = createSseJsonLineProcessor((event) => {
    const type = str(event.type);
    const index = Number(event.index) || 0;
    if (type === 'content_block_start' && event.content_block && typeof event.content_block === 'object') {
      reader.startBlock(index, event.content_block as Json, event);
    } else if (type === 'content_block_delta' && event.delta && typeof event.delta === 'object') {
      reader.delta(index, event.delta as Json, event);
    } else if (type === 'content_block_stop') {
      reader.stopBlock(index);
    } else if (type === 'message_delta') {
      const delta = event.delta && typeof event.delta === 'object' ? event.delta as Json : {};
      if (str(delta.stop_reason)) stopReason = str(delta.stop_reason);
      if (delta.stop_details && typeof delta.stop_details === 'object') stopDetails = delta.stop_details as Json;
    } else if (type === 'message_stop') {
      finished = true;
    }
  }, onEvent);

  await readSseLines(response, processLine, () => finished);
  if (!finished) throw new Error('The reply stream was interrupted before it finished. Regenerate to try again.');
  return { blocks: reader.turnBlocks(), stopReason, stopDetails };
}

async function fetchTurn(url: string, headers: Record<string, string>, body: Json, signal: AbortSignal, reader: ReplyReader): Promise<TurnResult> {
  const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
  await ensureOkResponse(response, 'Anthropic API error');
  const res = await response.json() as Json;
  throwIfErrorBody(res);

  const content = Array.isArray(res.content) ? res.content as Json[] : [];
  content.forEach((block, index) => {
    reader.startBlock(index, block);
    reader.stopBlock(index);
  });
  return {
    blocks: reader.turnBlocks(),
    stopReason: str(res.stop_reason),
    stopDetails: res.stop_details && typeof res.stop_details === 'object' ? res.stop_details as Json : null,
  };
}

async function respondRound(ctx: ProviderRequestContext, stream: boolean, extra: Json[]): Promise<ToolRound<Json>> {
  const abortController = createAbort(ctx.provideAbort);
  const { body, betas } = buildAnthropicRequest(ctx);
  const url = `${anthropicBaseUrl(ctx.apiBaseUrl)}/messages`;
  const headers = anthropicHeaders(ctx.apiKey, betas);
  const baseMessages = [...(body.messages as Json[]), ...extra];
  const reader = new ReplyReader(ctx.callbacks);

  // A long run of server-side tool calls ends its turn with "pause_turn";
  // sending the reply so far back as the assistant turn resumes it.
  const paused: Json[] = [];
  let native: NativeTurn | undefined;
  let turn: TurnResult;
  for (let attempt = 0; ; attempt++) {
    const request = { ...body, messages: paused.length ? [...baseMessages, { role: 'assistant', content: paused }] : baseMessages };
    reader.beginTurn();
    turn = stream
      ? await streamTurn(url, headers, request, abortController.signal, reader, ctx.callbacks.onEvent)
      : await fetchTurn(url, headers, request, abortController.signal, reader);
    if (turn.stopReason !== 'pause_turn' || attempt >= MAX_CONTINUATIONS) break;
    paused.push(...turn.blocks);
  }
  // The whole reply, every continuation included, is one assistant turn.
  const blocks = [...paused, ...turn.blocks];
  const calls: BrowserToolCall[] = turn.stopReason === 'tool_use'
    ? blocks.filter(block => block.type === 'tool_use')
      .map(block => ({ id: str(block.id), name: str(block.name), arguments: block.input ?? {} }))
    : [];
  // A reply still paused mid-tool, or waiting on browser tools, cannot be
  // followed by a user turn.
  if (turn.stopReason !== 'pause_turn' && !calls.length && blocks.length) {
    native = { api: 'anthropic', endpoint: url.slice(0, -'/messages'.length), model: ctx.model, text: reader.text, data: blocks };
  }

  // Partial text is still a usable reply; only an empty one is an error.
  if (!reader.text && !calls.length) {
    const error = stopError(turn.stopReason, turn.stopDetails);
    if (error) throw error;
  }
  return {
    reply: { text: reader.text, activity: reader.log.settle(), native },
    calls,
    turn: blocks.length ? [{ role: 'assistant', content: blocks }] : [],
  };
}

function respond(ctx: ProviderRequestContext, stream: boolean): Promise<GenerationResponse> {
  return runToolLoop<Json>(ctx, {
    send: (roundCtx, extra) => respondRound(roundCtx, stream, extra),
    // Text has to come after every tool_result in the turn.
    answer: (answers, steers) => [{
      role: 'user',
      content: [
        ...answers.map(({ call, output, isError }) => ({
          type: 'tool_result',
          tool_use_id: call.id,
          content: output,
          ...(isError ? { is_error: true } : {}),
        })),
        ...steers.map(text => ({ type: 'text', text })),
      ],
    }],
    steer: texts => (texts.length ? [{ role: 'user', content: texts.map(text => ({ type: 'text', text })) }] : []),
    partial: text => (text ? [{ role: 'assistant', content: [{ type: 'text', text }] }] : []),
    // A server tool call still waiting for its result has to be answered by
    // tool results alone; text there ends the turn early (or is refused).
    acceptsSteer: round => {
      const blocks = round.turn.flatMap(message => (Array.isArray(message.content) ? message.content as Json[] : []));
      const answered = new Set(blocks.filter(block => str(block.type).endsWith('_tool_result')).map(block => str(block.tool_use_id)));
      return !blocks.some(block => TOOL_USE_TYPES.has(str(block.type)) && !answered.has(str(block.id)));
    },
    native: (rounds, final, text) => ({
      api: 'anthropic',
      endpoint: anthropicBaseUrl(ctx.apiBaseUrl),
      model: ctx.model,
      text,
      data: { messages: [...rounds, ...final.turn] },
    }),
  });
}

async function listModels({ apiKey, baseURL }: { apiKey: string; baseURL: string }): Promise<string[]> {
  const response = await fetch(`${anthropicBaseUrl(baseURL)}/models?limit=1000`, {
    method: 'GET',
    headers: anthropicHeaders(apiKey),
  });
  await ensureOkResponse(response, 'Anthropic API error');

  const res = await response.json();
  const items = Array.isArray(res?.data) ? res.data as Json[] : [];
  return items
    .map(item => ({ id: str(item?.id), created: Date.parse(str(item?.created_at)) || 0 }))
    .filter(item => item.id)
    .sort((a, b) => b.created - a.created)
    .map(item => item.id);
}

export const anthropicAdapter: ProviderAdapter = {
  respond,
  listModels,
};
