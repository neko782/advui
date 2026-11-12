// Default values for configurable settings (runtime constants).
import type {
  EditorActionButton,
  MessageActionButton,
  ToolId,
} from '../types/settings.js';
import type { BrowserToolName } from '../types/api.js';

export const DEFAULT_EDITOR_ACTIONS: EditorActionButton[] = [
  { id: 'editSend', label: 'Send (branch + reply)', enabled: true },
  { id: 'editBranch', label: 'Branch (no reply)', enabled: true },
  { id: 'editReplace', label: 'Replace in branch', enabled: true },
];

export const DEFAULT_MESSAGE_ACTIONS: MessageActionButton[] = [
  { id: 'regenerate', label: 'Regenerate', enabled: true, roles: { user: true, assistant: true, system: false } },
  { id: 'copy', label: 'Copy', enabled: true, roles: { user: true, assistant: true, system: true } },
  { id: 'delete', label: 'Delete', enabled: true, roles: { user: true, assistant: true, system: true } },
  { id: 'edit', label: 'Edit', enabled: true, roles: { user: true, assistant: true, system: true } },
  { id: 'fork', label: 'Fork', enabled: false, roles: { user: true, assistant: true, system: true } },
  { id: 'moveDown', label: 'Move down', enabled: true, roles: { user: true, assistant: true, system: true } },
  { id: 'moveUp', label: 'Move up', enabled: true, roles: { user: true, assistant: true, system: true } },
];

export const TOOL_IDS: readonly ToolId[] = ['webSearch', 'webFetch', 'codeInterpreter', 'shell', 'imageGeneration', 'mcp', 'browser'];

/** Browser tools, in display order. */
export const BROWSER_TOOL_NAMES: readonly BrowserToolName[] = ['clock', 'javascript', 'chatSearch'];

/**
 * Browser tools offered when a chat or preset has not picked any. Chat
 * search sends other conversations to the provider, so it is opt-in.
 */
export const DEFAULT_BROWSER_TOOLS: readonly BrowserToolName[] = ['clock', 'javascript'];
