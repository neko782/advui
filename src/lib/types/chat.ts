// ============================================================================
// Chat Domain Types
// Conversation graph (nodes/variants), chat records, generation state,
// validation, and chat-service contracts.
// ============================================================================

import type {
  MessageRole,
  ReasoningEffort,
  TextVerbosity,
  ReasoningSummary,
  ImageReference,
  GeneratedImage,
  McpResponseItem,
  McpServerConfig,
  HistoryMessage,
} from './api.js';
import type { Connection, Settings } from './settings.js';

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
  generatedImages?: GeneratedImage[];
  mcpItems?: McpResponseItem[];
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

export type VariantTransform = (variant: MessageVariant) => MessageVariant;

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
  // Web Search settings (Responses API only)
  webSearchEnabled?: boolean;
  webSearchDomains?: string;
  webSearchCountry?: string;
  webSearchCity?: string;
  webSearchRegion?: string;
  webSearchTimezone?: string;
  webSearchCacheOnly?: boolean;
  // Code Interpreter settings (Responses API only)
  codeInterpreterEnabled?: boolean;
  codeInterpreterNetworkEnabled?: boolean;
  codeInterpreterAllowedDomains?: string;  // Comma-separated list of allowed domains
  // Shell settings (Responses API only)
  shellEnabled?: boolean;
  shellNetworkEnabled?: boolean;
  shellAllowedDomains?: string;  // Comma-separated list of allowed domains
  // Image Generation settings (Responses API only)
  imageGenerationEnabled?: boolean;
  imageGenerationModel?: string;
  // MCP settings (Responses API only)
  mcpEnabled?: boolean;
  mcpServers?: McpServerConfig[];
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

export interface ImageValidationResult {
  valid: boolean;
  orphaned: string[];
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

export interface InsertBetweenResult {
  nodes: ChatNode[];
  nextId: number;
  nextNodeId: number;
  insertedNodeId: number;
  insertedMessageId: number;
}

// ============================================================================
// Persistence Types
// ============================================================================

export interface PersistenceResult {
  updated: Chat | null;
  notice: string;
  nodes: ChatNode[];
  rootId: number | null;
}

export interface SanitizedGraphResult {
  nodes: ChatNode[];
  notice: string;
}

// ============================================================================
// Notice Types
// ============================================================================

export interface NoticeState {
  dismissed: string;
  missingApiKey: string;
}

export interface NoticeManager {
  showMissingApiKeyNotice(currentDismissed: string): NoticeState;
  clearMissingApiKeyNotice(): { missingApiKey: string };
  dismissNotice(assembledNotice: string): string;
}

// ============================================================================
// Generation State Manager Types
// ============================================================================

export interface GenerationStateSnapshot {
  sequence: number;
  typingVariantId: number | null;
  abortRequested: boolean;
}

export interface GenerationStateManager {
  reset(): void;
  startGeneration(): number;
  completeGeneration(sequence: number): boolean;
  isGenerationActive(): boolean;
  getGenerationSequence(): number;
  getStateSnapshot(): GenerationStateSnapshot;
  guardedUpdate<T>(snapshot: GenerationStateSnapshot, update: () => T): { applied: boolean; result: T | null };
  isSequenceValid(sequence: number): boolean;
  registerAbortHandler(sequence: number, fn: (() => void) | null): boolean;
  requestAbort(): boolean;
  forceStopGeneration(): boolean;
  setTypingVariantId(variantId: number | null): void;
  getTypingVariantId(): number | null;
  isAbortRequested(): boolean;
  getStateVersion(): number;
  incrementStateVersion(): void;
}

// ============================================================================
// Persistence Scheduler Types
// ============================================================================

export interface PersistenceScheduler {
  scheduleRefresh(callback: ((updated?: Chat) => void) | undefined, updated?: Chat | null): void;
  cancel(): void;
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
  latestSettings: Settings;
}
