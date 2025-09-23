// Simple localStorage-backed settings store for API key and defaults
export const SETTINGS_KEY = 'openai.settings.v1';

// Normalized shape returned by loadSettings():
// { apiKey: string, defaultChat: { model: string, streaming: boolean }, model: string }
// Note: `model` at top-level is kept for backward compatibility and mirrors defaultChat.model
export function loadSettings() {
  const defaults = { apiKey: '', defaultChat: { model: 'gpt-4o-mini', streaming: true }, debug: false };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...defaults, model: defaults.defaultChat.model };
    const parsed = JSON.parse(raw);
    const model = (parsed?.defaultChat?.model) || parsed?.model || 'gpt-4o-mini';
    const streaming = (
      typeof parsed?.defaultChat?.streaming === 'boolean'
        ? parsed.defaultChat.streaming
        : true
    );
    const debug = (typeof parsed?.debug === 'boolean') ? !!parsed.debug : false;
    const out = {
      apiKey: parsed?.apiKey || '',
      defaultChat: { model, streaming },
      // Preserve legacy top-level model for any older callers
      model,
      debug,
    };
    return out;
  } catch {
    return { ...defaults, model: defaults.defaultChat.model };
  }
}

export function saveSettings(next) {
  const model = (next?.defaultChat?.model) || next?.model || 'gpt-4o-mini';
  const streaming = (typeof next?.defaultChat?.streaming === 'boolean') ? next.defaultChat.streaming : true;
  const data = {
    apiKey: next?.apiKey || '',
    defaultChat: { model, streaming },
    // Keep mirrored top-level model for compatibility
    model,
    debug: !!next?.debug,
  };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(data));
}
