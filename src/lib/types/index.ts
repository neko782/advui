// ============================================================================
// Core Types for the Chat Application
// ============================================================================

// Message roles
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

// Reasoning options
export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high';
export type TextVerbosity = 'low' | 'medium' | 'high';
export type ReasoningSummary = 'none' | 'auto' | 'concise' | 'detailed';

// API modes
export type ApiMode = 'responses' | 'chat_completions';

// Theme modes
export type ThemeMode = 'light' | 'dark' | 'system';
export type ThemeValue = 'light' | 'dark';

// ============================================================================
// Image Types
// ============================================================================

export interface ImageReference {
  id: string;
  mimeType?: string;
  name?: string;
}

export interface ImageData extends ImageReference {
  data: string;
}

export interface StoredImage {
  id: string;
  data: string;
  mimeType?: string;
  name?: string;
  timestamp: number;
}

export interface ImageCacheEntry {
  data: string;
  mimeType?: string;
  name?: string;
}

// ============================================================================
// Message & Variant Types
// ============================================================================

export interface MessageVariant {
  id: number;
  role: MessageRole;
  content: string;
  time: number;
  typing: boolean;
  error?: string;
  next: number | null;
  images?: ImageReference[];
  reasoningSummary?: string;
  reasoningSummaryLoading?: boolean;
  locked?: boolean;
}

export interface ChatNode {
  id: number;
  variants: MessageVariant[];
  active: number;
  locked?: boolean;
}

export interface VisibleMessage {
  m: MessageVariant;
  i: number;
  nodeId: number;
  variantIndex: number;
  variantsLength: number;
}

export interface NodeLocation {
  node: ChatNode | null;
  index: number;
}

// ============================================================================
// Chat Types
// ============================================================================

export interface ChatSettings {
  model: string;
  streaming: boolean;
  presetId?: string;
  maxOutputTokens: number | null;
  topP: number | null;
  temperature: number | null;
  reasoningEffort: ReasoningEffort;
  textVerbosity: TextVerbosity;
  reasoningSummary: ReasoningSummary;
  thinkingEnabled: boolean;
  thinkingBudgetTokens: number | null;
  connectionId: string | null;
}

export interface Chat {
  id: string;
  title: string;
  updatedAt: number;
  settings: ChatSettings;
  nodes: ChatNode[];
  rootId: number | null;
  presetId: string | null;
  _version?: number;
  _expectedVersion?: number;
  _persistedAt?: number;
  locked?: boolean;
}

export interface ChatSelection {
  selectedId: string | null;
}

export interface ChatListItem {
  id: string;
  title: string;
  updatedAt: number;
}

// ============================================================================
// Connection Types
// ============================================================================

export interface Connection {
  id: string;
  name: string;
  apiKey: string;
  apiBaseUrl: string;
  apiMode: ApiMode;
}

export interface ConnectionOption {
  id: string;
  name: string;
}

// ============================================================================
// Preset Types
// ============================================================================

export interface Preset {
  id: string | null;
  name?: string;
  model: string;
  streaming: boolean;
  maxOutputTokens: number | null;
  topP: number | null;
  temperature: number | null;
  reasoningEffort: ReasoningEffort;
  textVerbosity: TextVerbosity;
  reasoningSummary: ReasoningSummary;
  thinkingEnabled: boolean;
  thinkingBudgetTokens: number | null;
  connectionId: string | null;
  systemPrompt: string;
}

export interface PresetFields {
  model: string;
  streaming: boolean;
  maxOutputTokens: number | null;
  topP: number | null;
  temperature: number | null;
  reasoningEffort: ReasoningEffort;
  textVerbosity: TextVerbosity;
  reasoningSummary: ReasoningSummary;
  thinkingEnabled: boolean;
  thinkingBudgetTokens: number | null;
  connectionId: string | null;
  systemPrompt: string;
}

// ============================================================================
// Settings Types
// ============================================================================

export interface Keybinds {
  sendMessage: string;
  newLine: string;
}

export interface DefaultChatSettings {
  model: string;
  streaming: boolean;
  maxOutputTokens: number | null;
  topP: number | null;
  temperature: number | null;
  reasoningEffort: ReasoningEffort;
  textVerbosity: TextVerbosity;
  reasoningSummary: ReasoningSummary;
  thinkingEnabled: boolean;
  thinkingBudgetTokens: number | null;
  connectionId: string | null;
}

export interface Settings {
  apiKey: string;
  apiBaseUrl: string;
  connections: Connection[];
  selectedConnectionId: string;
  presets: Preset[];
  selectedPresetId: string;
  debug: boolean;
  apiMode: ApiMode;
  keybinds: Keybinds;
  showThinkingSettings: boolean;
  defaultChat: DefaultChatSettings;
  model: string;
}

// ============================================================================
// Models Cache Types
// ============================================================================

export interface ModelsCacheEntry {
  ids: string[];
  fetchedAt: number;
}

export interface ModelsStore {
  version?: number;
  entries: Record<string, ModelsCacheEntry>;
}

// ============================================================================
// Storage Types
// ============================================================================

export interface StorageChange {
  type: 'put' | 'delete' | 'sync';
  chat?: Chat;
  chatId?: string;
  version?: number;
  fromOtherTab?: boolean;
  store?: {
    version: number;
    byId: Record<string, Chat>;
  };
}

export type StorageListener = (change: StorageChange) => void;

export interface StorageBackend {
  getAllChats(): Promise<Chat[]>;
  getChat(id: string): Promise<Chat | null>;
  putChat(chat: Chat): Promise<Chat>;
  deleteChat(id: string, expectedVersion?: number): Promise<Chat | null>;
  subscribeChatStorage(listener: StorageListener): () => void;
  isIndexedDBAvailable?(): boolean;
}

export interface LocalStorageStore {
  version: number;
  byId: Record<string, Chat>;
}

// ============================================================================
// Validation Types
// ============================================================================

export interface ChatValidationResult {
  valid: boolean;
  errors: string[];
}

export interface TreeValidationResult {
  ok: boolean;
  problems: string[];
  details: TreeValidationDetails;
}

export interface TreeValidationDetails {
  duplicateNodeIds: number[];
  multipleParents: Map<number, IncomingEdge[]>;
  missingTargets: Set<number>;
  cycles: number[][];
  multipleRoots: number[];
  rootHasParent: boolean;
  unreachableFromRoot: Set<number>;
}

export interface IncomingEdge {
  fromNodeId: number;
  variantIndex: number;
  variantId: number;
}

// ============================================================================
// Generation Types
// ============================================================================

export interface GenerationContext {
  nodes: ChatNode[];
  rootId: number | null;
  nextId: number;
  nextNodeId: number;
  typingVariantId: number | null;
  error: string | null;
}

export interface GenerationResponse {
  text: string;
  reasoningSummary?: string;
}

export interface GenerationOptions {
  nodes: ChatNode[];
  rootId: number | null;
  chatSettings: ChatSettings;
  connectionId: string | null;
  streaming: boolean;
  typingVariantId: number | null;
  onAbort?: (abortFn: () => void) => void;
  onTextDelta?: (fullText: string, delta?: string, event?: unknown) => void;
  onReasoningSummaryDelta?: (fullSummary: string, delta: string, event?: unknown) => void;
  onReasoningSummaryDone?: (fullSummary: string, event?: unknown) => void;
}

export interface PreparedUserMessage {
  nodes: ChatNode[];
  rootId: number | null;
  nextId: number;
  nextNodeId: number;
  newNodeId: number;
}

export interface PreparedTypingNode {
  nodes: ChatNode[];
  rootId: number | null;
  typingVariantId: number;
  nextId: number;
  nextNodeId: number;
}

export interface PreparedRefresh {
  nodes: ChatNode[];
  nextId: number;
  typingVariantId: number;
  history: HistoryMessage[];
  nextNodeId?: number;
}

export interface HistoryMessage {
  role: MessageRole;
  content: string;
  images?: ImageData[];
}

// ============================================================================
// Edit Action Types
// ============================================================================

export interface BranchResult {
  nodes: ChatNode[];
  nextId: number;
}

export interface BranchAndSendResult {
  shouldRefreshOnly: boolean;
  insertIndex?: number;
  nodes: ChatNode[];
  nextId: number;
  nextNodeId: number;
  typingVariantId?: number;
  history?: HistoryMessage[];
}

// ============================================================================
// Persistence Types
// ============================================================================

export interface PersistenceResult {
  updated: Chat | null;
  notice: string;
  nodes?: ChatNode[];
}

export interface SanitizedGraphResult {
  nodes: ChatNode[];
  notice: string;
}

// ============================================================================
// Export/Import Types
// ============================================================================

export interface ExportedChat {
  version: number;
  type: 'single_chat';
  exportedAt: string;
  chat: Chat;
}

export interface ImportResult {
  chatsImported: number;
  settingsImported: boolean;
  imagesImported: number;
  errors: string[];
}

export interface ChatManifestEntry {
  id: string;
  title: string;
  path: string;
}

export interface ImageManifestEntry {
  id: string;
  filename: string;
  mimeType?: string;
  name?: string;
}

export interface TarArchive {
  list(prefix?: string): string[];
  getText(path: string): Promise<string | null>;
  getBase64(path: string): Promise<string | null>;
}

// ============================================================================
// OpenAI Types
// ============================================================================

export interface OpenAIClientOptions {
  apiKey: string;
  baseURL?: string;
  dangerouslyAllowBrowser?: boolean;
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
}

export interface ResolvedConnection {
  id: string | null;
  apiKey: string;
  apiBaseUrl?: string;
  apiMode: ApiMode;
}

// ============================================================================
// Theme Types
// ============================================================================

export interface ThemeState {
  mode: ThemeMode;
  theme: ThemeValue;
}

export type ThemeListener = (state: ThemeState) => void;

// ============================================================================
// Notice Types
// ============================================================================

export interface NoticeState {
  dismissed: string;
  missingApiKey: string;
}

// ============================================================================
// Generation State Manager Types
// ============================================================================

export interface GenerationStateManager {
  reset(): void;
  startGeneration(): number;
  completeGeneration(sequence: number): boolean;
  isGenerationActive(): boolean;
  getGenerationSequence(): number;
  registerAbortHandler(fn: (() => void) | null): boolean;
  requestAbort(): boolean;
  setTypingVariantId(variantId: number | null): void;
  getTypingVariantId(): number | null;
  isAbortRequested(): boolean;
}

// ============================================================================
// Persistence Scheduler Types
// ============================================================================

export interface PersistenceScheduler {
  scheduleRefresh(callback: ((updated?: Chat) => void) | undefined, updated?: Chat | null): void;
  cancel(): void;
}

// ============================================================================
// Notice Manager Types
// ============================================================================

export interface NoticeManager {
  showMissingApiKeyNotice(currentDismissed: string): NoticeState;
  clearMissingApiKeyNotice(): { missingApiKey: string };
  dismissNotice(assembledNotice: string): string;
}

// ============================================================================
// Chat Loader Types
// ============================================================================

export interface LoadedChat {
  nodes: ChatNode[];
  rootId: number | null;
  chatSettings: ChatSettings;
  nextId: number;
  nextNodeId: number;
  persistSig: string;
  settings: Settings;
}

// ============================================================================
// Connection Resolver Types
// ============================================================================

export interface ConnectionContext {
  connectionId: string | null;
  apiKey: string;
  activeConnection: Connection | null;
  latestSettings: AppSettings;
}

// ============================================================================
// Image Validation Types
// ============================================================================

export interface ImageValidationResult {
  valid: boolean;
  orphaned: string[];
}

// ============================================================================
// Utility Types
// ============================================================================

export type VariantTransform = (variant: MessageVariant) => MessageVariant;

export interface SafeWriteOptions {
  warnThresholdBytes?: number;
}

// Type guard helpers
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function hasOwn<T extends object>(obj: T | null | undefined, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(obj ?? {}, key);
}

