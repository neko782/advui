// What each API can do, for the settings that only apply to some of them.
import type { ApiMode, DisabledTools, ToolId } from '../types/index.js';

/** Responses and Chat Completions endpoints, which OpenRouter also serves. */
export function isOpenAiCompatible(apiMode: ApiMode | undefined): boolean {
  return apiMode !== 'gemini' && apiMode !== 'anthropic';
}

/**
 * Built-in tools the API has no equivalent for. Browser tools run in the app
 * and work everywhere. Chat Completions has no hosted tools of its own, but
 * OpenRouter adds web search to it.
 */
export function unsupportedTools(apiMode: ApiMode | undefined, openRouter = false): DisabledTools {
  switch (apiMode) {
    case 'anthropic':
      return { shell: true, imageGeneration: true };
    case 'gemini':
      return { shell: true, imageGeneration: true, mcp: true };
    case 'chat_completions':
      return { webSearch: !openRouter, webFetch: true, codeInterpreter: true, shell: true, imageGeneration: true, mcp: true };
    default:
      return { webFetch: true };
  }
}

/** The enabled flag behind each tool. */
export const TOOL_ENABLED_KEYS = {
  webSearch: 'webSearchEnabled',
  webFetch: 'webFetchEnabled',
  codeInterpreter: 'codeInterpreterEnabled',
  shell: 'shellEnabled',
  imageGeneration: 'imageGenerationEnabled',
  mcp: 'mcpEnabled',
  browser: 'browserToolsEnabled',
} as const satisfies Record<ToolId, string>;

/**
 * Turns off the tools a connection's API cannot use, for when a chat or
 * preset moves to that connection. Tools it can use are left as they are.
 */
export function toolsOffFor(apiMode: ApiMode | undefined, openRouter = false): Partial<Record<(typeof TOOL_ENABLED_KEYS)[ToolId], false>> {
  const patch: Partial<Record<(typeof TOOL_ENABLED_KEYS)[ToolId], false>> = {};
  for (const [id, off] of Object.entries(unsupportedTools(apiMode, openRouter))) {
    if (off) patch[TOOL_ENABLED_KEYS[id as ToolId]] = false;
  }
  return patch;
}
