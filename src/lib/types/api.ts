// ============================================================================
// API / Provider Types
// Types describing requests and responses exchanged with model providers.
// ============================================================================

// Message roles
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

// Reasoning options
export type ReasoningEffort = 'default' | 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type TextVerbosity = 'none' | 'low' | 'medium' | 'high';
export type ReasoningSummary = 'none' | 'auto' | 'concise' | 'detailed';

// API modes
export type ApiMode = 'responses' | 'chat_completions' | 'gemini' | 'anthropic';

// ============================================================================
// Image / Attachment Payload Types
// ============================================================================

export interface ImageReference {
  id: string;
  mimeType?: string;
  name?: string;
}

export interface ImageData extends ImageReference {
  data: string;
}

export interface ImageCacheEntry {
  data: string;
  mimeType?: string;
  name?: string;
}

// ============================================================================
// Client Types
// ============================================================================

export interface OpenAIClientOptions {
  apiKey: string;
  baseURL?: string;
  dangerouslyAllowBrowser?: boolean;
}

export interface ResolvedConnection {
  openRouterEnabled?: boolean;
  id: string | null;
  apiKey: string;
  apiBaseUrl?: string;
  apiMode: ApiMode;
}

// ============================================================================
// Web Search Types (Responses API)
// ============================================================================

export interface WebSearchUserLocation {
  type: 'approximate';
  country?: string;  // Two-letter ISO country code (e.g., "US", "GB")
  city?: string;     // Free text string (e.g., "London")
  region?: string;   // Free text string (e.g., "California")
  timezone?: string; // IANA timezone (e.g., "America/Chicago")
}

export interface WebSearchFilters {
  allowed_domains?: string[];  // Up to 100 URLs, without http/https prefix
}

export interface WebSearchOptions {
  enabled?: boolean;
  filters?: WebSearchFilters;
  user_location?: WebSearchUserLocation;
  external_web_access?: boolean;  // Default true, set false for cache-only mode
}

export interface WebSearchCitation {
  type: 'url_citation';
  start_index: number;
  end_index: number;
  url: string;
  title: string;
}

export interface WebSearchSource {
  url: string;
  title?: string;
  type?: string;  // Can be 'oai-sports', 'oai-weather', 'oai-finance' for real-time feeds
}

export interface WebSearchCallAction {
  type: 'search' | 'open_page' | 'find_in_page';
  query?: string;
  domains?: string[];
  sources?: WebSearchSource[];
}

export interface WebSearchResult {
  citations: WebSearchCitation[];
  sources: WebSearchSource[];
}

// ============================================================================
// Container Tool Types (Responses API)
// ============================================================================

export interface ContainerNetworkPolicy {
  type: 'disabled' | 'allowlist';
  allowed_domains?: string[];
}

export interface CodeInterpreterOptions {
  enabled?: boolean;
  network_policy?: ContainerNetworkPolicy;
}

export interface ShellOptions {
  enabled?: boolean;
  network_policy?: ContainerNetworkPolicy;
}

// ============================================================================
// Image Generation Types (Responses API)
// ============================================================================

export interface ImageGenerationOptions {
  enabled?: boolean;
  model?: string;  // Image generation model (e.g., gpt-image-1, gpt-image-1-mini)
}

export interface GeneratedImage {
  id: string;
  data?: string;  // Base64 encoded image data while in transit; persisted in media storage
  mimeType?: string;
  name?: string;
  revisedPrompt?: string;
}

// ============================================================================
// Browser tools
// Function tools the app runs itself, in the browser, for any API.
// ============================================================================

export type BrowserToolName = 'clock' | 'javascript' | 'chatSearch';

// ============================================================================
// MCP Types
// ============================================================================

export interface McpServerConfig {
  label: string;
  url: string;
  /** OAuth / bearer access token the API forwards to the server. */
  authorization?: string;
  /** Comma-separated tool names to import; empty imports every tool. */
  allowedTools?: string;
}

// ============================================================================
// Activity Types
// What the model did besides writing the reply: thinking and tool calls, as
// one ordered list of steps. Every provider reports into this shape.
// ============================================================================

export type ActivityKind =
  | 'thinking'
  | 'search'    // web search
  | 'fetch'     // opening / reading a page
  | 'code'      // code execution
  | 'shell'
  | 'image'     // image generation
  | 'mcp'       // MCP tool call
  | 'mcp_list'  // MCP tool discovery
  | 'time'      // browser tool: reading the clock
  | 'chats'     // browser tool: searching the user's other chats
  | 'tool';     // anything else

export type ActivityStatus = 'running' | 'done' | 'failed';

export interface ActivityStep {
  id: string;
  kind: ActivityKind;
  status: ActivityStatus;
  /** Thinking: the reasoning text (markdown). */
  text?: string;
  /** What a tool acted on: the query, URL, command or tool name. */
  subject?: string;
  /** MCP server the call went to. */
  server?: string;
  /** Tool input: arguments, code, commands. */
  input?: string;
  /** Tool result. */
  output?: string;
  error?: string;
}

// ============================================================================
// Request / Response Types
// ============================================================================

/**
 * A reply exactly as the provider returned it (reasoning, signatures, tool
 * calls and results), so later turns can send it back the way the provider
 * expects instead of as plain text.
 */
export interface NativeTurn {
  api: ApiMode;
  /** Base URL that produced it; other endpoints get the plain text. */
  endpoint: string;
  model: string;
  /** The reply text it goes with; once the reply is edited it is sent as plain text. */
  text: string;
  /**
   * Tag of the API key it was made with (a hash, not the key). Responses
   * reasoning is encrypted for one organization, so under another key it is
   * left out.
   */
  account?: string;
  /**
   * Anthropic: content blocks. Responses: output items. Gemini: parts.
   * Chat Completions: the assistant message's reasoning fields.
   */
  data: unknown;
}

export interface HistoryMessage {
  role: MessageRole;
  content: string;
  images?: ImageData[];
  native?: NativeTurn;
}

export interface GenerationResponse {
  text: string;
  /** Thinking and tool steps, in the order they happened. */
  activity?: ActivityStep[];
  /** The reply as the provider returned it, for replay on later turns. */
  native?: NativeTurn;
  webSearchResult?: WebSearchResult;
  generatedImages?: GeneratedImage[];
}

export interface RespondOptions {
  prompt?: string;
  messages?: HistoryMessage[];
  model: string;
  connectionId?: string | null;
  stream?: boolean;
  onTextDelta?: (fullText: string, delta?: string, event?: unknown) => void;
  onEvent?: (event: unknown) => void;
  maxOutputTokens?: number | null;
  topP?: number | null;
  temperature?: number | null;
  reasoningEffort?: ReasoningEffort;
  textVerbosity?: TextVerbosity;
  reasoningSummary?: ReasoningSummary;
  openRouterProvider?: string;
  openRouterZdr?: boolean;
  thinkingEnabled?: boolean;
  thinkingBudgetTokens?: number | null;
  /** Called with the full step list whenever a step is added or changes. */
  onActivity?: (steps: ActivityStep[]) => void;
  onAbort?: (abortFn: () => void) => void;
  // Web Search options (Responses API only)
  webSearch?: WebSearchOptions;
  onWebSearchResult?: (result: WebSearchResult) => void;
  // Code Interpreter options (Responses API only)
  codeInterpreter?: CodeInterpreterOptions;
  // Shell options (Responses API only)
  shell?: ShellOptions;
  // Image Generation options (Responses API only)
  imageGeneration?: ImageGenerationOptions;
  onImageGenerated?: (images: GeneratedImage[]) => void;
  // MCP server tools
  mcpServers?: McpServerConfig[];
  /** Read pages at URLs from the conversation (Anthropic web fetch, Gemini URL context). */
  webFetch?: boolean;
  /** Browser tools offered to the model; empty or missing offers none. */
  browserTools?: BrowserToolName[];
}
