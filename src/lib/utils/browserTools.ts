// Stored browser-tool selections (presets and chats).
import { BROWSER_TOOL_NAMES, DEFAULT_BROWSER_TOOLS } from '../constants/defaults.js';
import type { BrowserToolName } from '../types/index.js';

/** The valid, distinct tool names of a stored list, in display order; undefined when nothing was stored. */
export function normalizeBrowserTools(value: unknown): BrowserToolName[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return BROWSER_TOOL_NAMES.filter(name => value.includes(name));
}

/** The tools a chat offers: none while browser tools are off, the default set when it never picked. */
export function activeBrowserTools(enabled: boolean | undefined, selected: unknown): BrowserToolName[] {
  if (!enabled) return [];
  return normalizeBrowserTools(selected) ?? [...DEFAULT_BROWSER_TOOLS];
}
