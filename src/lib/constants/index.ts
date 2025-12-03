// Application-wide constants
import type { ReasoningEffort, TextVerbosity, ReasoningSummary, MessageRole } from '../types/index.js';

export const REASONING_OPTIONS: readonly ReasoningEffort[] = ['none', 'minimal', 'low', 'medium', 'high'] as const;
export const TEXT_VERBOSITY_OPTIONS: readonly TextVerbosity[] = ['low', 'medium', 'high'] as const;
export const REASONING_SUMMARY_OPTIONS: readonly ReasoningSummary[] = ['none', 'auto', 'concise', 'detailed'] as const;
export const DEFAULT_API_BASE_URL = 'https://api.openai.com/v1';
export const VALID_MESSAGE_ROLES: ReadonlySet<MessageRole> = new Set(['user', 'assistant', 'system'] as const);
export const BUG_NOTICE = 'This indicates a bug in the app. Please try to reproduce it and report it.';
export const DEBUG_AUTOFIX_NOTICE = 'Autofix is disabled in debug mode.';
export const NO_API_KEY_NOTICE_TEXT = 'Add your OpenAI API key in Settings to send messages.';

