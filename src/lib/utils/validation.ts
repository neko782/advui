// Settings validation utilities
import { REASONING_OPTIONS, TEXT_VERBOSITY_OPTIONS, REASONING_SUMMARY_OPTIONS } from '../constants/index.js';
import { toIntOrNull, toClampedNumber } from './numbers.js';
import type { ReasoningEffort, TextVerbosity, ReasoningSummary } from '../types/index.js';

export function normalizeReasoning(val: unknown): ReasoningEffort {
  return (REASONING_OPTIONS as readonly string[]).includes(val as string) ? val as ReasoningEffort : 'none';
}

export function normalizeVerbosity(val: unknown): TextVerbosity {
  return (TEXT_VERBOSITY_OPTIONS as readonly string[]).includes(val as string) ? val as TextVerbosity : 'medium';
}

export function normalizeReasoningSummary(val: unknown): ReasoningSummary {
  return (REASONING_SUMMARY_OPTIONS as readonly string[]).includes(val as string) ? val as ReasoningSummary : 'auto';
}

export function parseMaxTokens(value: unknown): number | null {
  return toIntOrNull(value);
}

export function parseTopP(value: unknown): number | null {
  return toClampedNumber(value, 0, 1);
}

export function parseTemperature(value: unknown): number | null {
  return toClampedNumber(value, 0, 2);
}

export function parseThinkingBudgetTokens(value: unknown): number | null {
  return toIntOrNull(value);
}

