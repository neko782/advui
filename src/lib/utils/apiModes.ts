// What each API can do, for the settings that only apply to some of them.
import type { ApiMode, DisabledTools } from '../types/index.js';

/** Responses and Chat Completions endpoints, which OpenRouter also serves. */
export function isOpenAiCompatible(apiMode: ApiMode | undefined): boolean {
  return apiMode !== 'gemini' && apiMode !== 'anthropic';
}

const ALL_TOOLS_OFF: DisabledTools = { webSearch: true, codeInterpreter: true, shell: true, imageGeneration: true, mcp: true };

/** Built-in tools the API has no equivalent for. */
export function unsupportedTools(apiMode: ApiMode | undefined): DisabledTools {
  if (apiMode === 'responses') return {};
  if (apiMode === 'anthropic') return { shell: true, imageGeneration: true };
  return ALL_TOOLS_OFF;
}
