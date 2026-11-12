// Reasoning effort levels differ per API, and each API retires levels over
// time. Selects offer only what the connection's API accepts today; retired
// levels come back with the "Deprecated parameters" setting.
import type { ApiMode, ReasoningEffort } from '../types/index.js';

type Level = Exclude<ReasoningEffort, 'default'>;

const ORDER: readonly Level[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

const LEVELS: Record<ApiMode, { current: readonly Level[]; deprecated: readonly Level[] }> = {
  responses: { current: ['none', 'low', 'medium', 'high', 'xhigh', 'max'], deprecated: ['minimal'] },
  chat_completions: { current: ['none', 'low', 'medium', 'high', 'xhigh', 'max'], deprecated: ['minimal'] },
  // Gemini's thinkingLevel
  gemini: { current: ['minimal', 'low', 'medium', 'high'], deprecated: [] },
};

export interface ReasoningLevelOption {
  value: ReasoningEffort;
  label: string;
}

/** Whether the API accepts this level at all (current or deprecated). */
export function isReasoningLevelSupported(apiMode: ApiMode | undefined, level: unknown): level is Level {
  const levels = LEVELS[apiMode ?? 'responses'] ?? LEVELS.responses;
  return levels.current.includes(level as Level) || levels.deprecated.includes(level as Level);
}

/**
 * Options for a reasoning-effort select. The already-selected level is always
 * listed, marked, so an old or mismatched value stays visible instead of
 * silently reading as something else.
 */
export function reasoningLevelOptions(
  apiMode: ApiMode | undefined,
  { legacy = false, selected }: { legacy?: boolean; selected?: ReasoningEffort } = {},
): ReasoningLevelOption[] {
  const levels = LEVELS[apiMode ?? 'responses'] ?? LEVELS.responses;
  const options: ReasoningLevelOption[] = [{ value: 'default', label: 'Default' }];
  for (const level of ORDER) {
    const deprecated = levels.deprecated.includes(level);
    if (levels.current.includes(level)) options.push({ value: level, label: level });
    else if (deprecated && (legacy || level === selected)) options.push({ value: level, label: `${level} (deprecated)` });
    else if (level === selected) options.push({ value: level, label: `${level} (not supported here)` });
  }
  return options;
}
