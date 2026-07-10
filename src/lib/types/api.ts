// ============================================================================
// API / Provider Types
// Types describing requests and responses exchanged with model providers.
// ============================================================================

// Message roles
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

// Reasoning options
export type ReasoningEffort = 'default' | 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
export type TextVerbosity = 'none' | 'low' | 'medium' | 'high';
export type ReasoningSummary = 'none' | 'auto' | 'concise' | 'detailed';

// API modes
export type ApiMode = 'responses' | 'chat_completions' | 'gemini';

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
// MCP Types (Responses API)
// ============================================================================

export interface McpServerConfig {
  label: string;
  url: string;
}

export interface McpListedTool {
  name: string;
  description?: string | null;
  annotations?: unknown | null;
  inputSchema?: unknown;
}

export interface McpCallItem {
  id: string;
  type: 'mcp_call';
  serverLabel: string;
  name: string;
  arguments?: string | null;
  output?: string | null;
  error?: string | null;
  status?: 'in_progress' | 'completed' | 'incomplete' | 'calling' | 'failed';
  approvalRequestId?: string | null;
}

export interface McpListToolsItem {
  id: string;
  type: 'mcp_list_tools';
  serverLabel: string;
  tools: McpListedTool[];
  error?: string | null;
}

export interface McpApprovalRequestItem {
  id: string;
  type: 'mcp_approval_request';
  serverLabel: string;
  name: string;
  arguments?: string | null;
}

export type McpResponseItem = McpCallItem | McpListToolsItem | McpApprovalRequestItem;

// ============================================================================
// Request / Response Types
// ============================================================================

export interface HistoryMessage {
  role: MessageRole;
  content: string;
  images?: ImageData[];
}

export interface GenerationResponse {
  text: string;
  reasoningSummary?: string;
  webSearchResult?: WebSearchResult;
  generatedImages?: GeneratedImage[];
  mcpItems?: McpResponseItem[];
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
  thinkingEnabled?: boolean;
  thinkingBudgetTokens?: number | null;
  onReasoningSummaryDelta?: (fullSummary: string, delta: string, event?: unknown) => void;
  onReasoningSummaryDone?: (fullSummary: string, event?: unknown) => void;
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
  // MCP server tools (Responses API only)
  mcpServers?: McpServerConfig[];
}
