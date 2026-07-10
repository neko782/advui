// Default values for configurable settings (runtime constants).
import type {
  EditorActionButton,
  MessageActionButton,
  DefaultToolSettings,
} from '../types/settings.js';

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

export const DEFAULT_TOOL_SETTINGS: DefaultToolSettings = {
  webSearch: true,
  codeInterpreter: true,
  shell: true,
  imageGeneration: true,
  mcp: false,
};
