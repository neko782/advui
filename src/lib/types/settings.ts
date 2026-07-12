// ============================================================================
// Settings Types
// Connections, presets, app settings, theme.
// ============================================================================

import type {
  ApiMode,
  ReasoningEffort,
  TextVerbosity,
  ReasoningSummary,
  McpServerConfig,
} from './api.js';
import type { PromptPreset, Persona } from './tavern.js';

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
  apiMode?: ApiMode;
}

// ============================================================================
// Preset Types
// ============================================================================

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
  // Web Search settings (Responses API only)
  webSearchEnabled?: boolean;
  webSearchDomains?: string;  // Comma-separated list of allowed domains
  webSearchCountry?: string;  // Two-letter ISO country code
  webSearchCity?: string;
  webSearchRegion?: string;
  webSearchTimezone?: string; // IANA timezone
  webSearchCacheOnly?: boolean;  // external_web_access = false
  // Code Interpreter settings (Responses API only)
  codeInterpreterEnabled?: boolean;
  codeInterpreterNetworkEnabled?: boolean;
  codeInterpreterAllowedDomains?: string;
  // Shell settings (Responses API only)
  shellEnabled?: boolean;
  shellNetworkEnabled?: boolean;
  shellAllowedDomains?: string;
  // Image Generation settings (Responses API only)
  imageGenerationEnabled?: boolean;
  imageGenerationModel?: string;  // Model for image generation tool (e.g., gpt-image-1)
  // MCP settings (Responses API only)
  mcpEnabled?: boolean;
  mcpServers?: McpServerConfig[];
  /** When true, the preset is only offered in tavern mode (hidden from chat mode pickers). */
  tavernOnly?: boolean;
}

export interface Preset extends PresetFields {
  id: string | null;
  name?: string;
}

// ============================================================================
// Message Action Button Types
// ============================================================================

export type MessageActionId =
  | 'regenerate'
  | 'copy'
  | 'delete'
  | 'edit'
  | 'fork'
  | 'moveDown'
  | 'moveUp';

export type MessageActionRole = 'user' | 'assistant' | 'system';
export type MessageActionRoles = Record<MessageActionRole, boolean>;

export interface MessageActionButton {
  id: MessageActionId;
  label: string;
  enabled: boolean;
  roles?: MessageActionRoles;
}

export type EditorActionId =
  | 'editSend'
  | 'editBranch'
  | 'editReplace';

export interface EditorActionButton {
  id: EditorActionId;
  label: string;
  enabled: boolean;
}

// ============================================================================
// Default Tool Settings (Responses API)
// ============================================================================

export interface DefaultToolSettings {
  webSearch: boolean;
  codeInterpreter: boolean;
  shell: boolean;
  imageGeneration: boolean;
  mcp: boolean;
}

// ============================================================================
// App Settings
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
  fancyEffects: boolean;
  allowInlineHtml: boolean;
  renderLatex: boolean;
  defaultChat: DefaultChatSettings;
  model: string;
  messageActions?: MessageActionButton[];
  editorActions?: EditorActionButton[];
  defaultTools?: DefaultToolSettings;
  disableRoleSwitching?: boolean;
  disableSendRolePopup?: boolean;
  showAddWithoutSend?: boolean;
  showInsertButtons?: boolean;
  // Tavern: shareable prompt presets (ordered prompt blocks) + personas
  promptPresets?: PromptPreset[];
  selectedPromptPresetId?: string;
  /** The active persona (derived from personas + selectedPersonaId). */
  persona?: Persona;
  personas?: Persona[];
  selectedPersonaId?: string;
  /** Shape of the character avatar next to messages. */
  tavernAvatarShape?: 'circle' | 'rounded' | 'card';
  /** Preset selection used by tavern chats (independent from chat mode). */
  tavernSelectedPresetId?: string;
  /** @deprecated No longer used; tavern keeps its own selection. Kept for stored-settings compat. */
  tavernSharePresetSelection?: boolean;
  /** When true, tavern chats manage presets per chat, exactly like chat mode. */
  tavernPerChatPresets?: boolean;
  /** Preset used automatically for new chat-mode chats (skips the preset menu). Empty = ask. */
  defaultNewChatPresetId?: string;
}

// ============================================================================
// Theme Types
// ============================================================================

export type ThemeMode = 'light' | 'dark' | 'system';
export type ThemeValue = 'light' | 'dark';

export interface ThemeState {
  mode: ThemeMode;
  theme: ThemeValue;
}

export type ThemeListener = (state: ThemeState) => void;
