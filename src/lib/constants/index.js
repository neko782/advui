// Application-wide constants

export const REASONING_OPTIONS = ['none', 'minimal', 'low', 'medium', 'high']
export const TEXT_VERBOSITY_OPTIONS = ['low', 'medium', 'high']
export const REASONING_SUMMARY_OPTIONS = ['none', 'auto', 'concise', 'detailed']
export const DEFAULT_API_BASE_URL = 'https://api.openai.com/v1'
export const VALID_MESSAGE_ROLES = new Set(['user', 'assistant', 'system'])
export const BUG_NOTICE = 'This indicates a bug in the app. Please try to reproduce it and report it.'
export const DEBUG_AUTOFIX_NOTICE = 'Autofix is disabled in debug mode.'
export const NO_API_KEY_NOTICE_TEXT = 'Add your OpenAI API key in Settings to send messages.'