// Simple localStorage-backed settings store for API key and defaults
export const SETTINGS_KEY = 'openai.settings.v1';

// Normalized shape returned by loadSettings():
// { apiKey: string, defaultChat: { model: string }, model: string }
// Note: `model` at top-level is kept for backward compatibility and mirrors defaultChat.model
export function loadSettings() {
  const defaults = { apiKey: '', defaultChat: { model: 'gpt-4o-mini' } };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...defaults, model: defaults.defaultChat.model };
    const parsed = JSON.parse(raw);
    const model = (parsed?.defaultChat?.model) || parsed?.model || 'gpt-4o-mini';
    const out = {
      apiKey: parsed?.apiKey || '',
      defaultChat: { model },
      // Preserve legacy top-level model for any older callers
      model,
    };
    return out;
  } catch {
    return { ...defaults, model: defaults.defaultChat.model };
  }
}

export function saveSettings(next) {
  const model = (next?.defaultChat?.model) || next?.model || 'gpt-4o-mini';
  const data = {
    apiKey: next?.apiKey || '',
    defaultChat: { model },
    // Keep mirrored top-level model for compatibility
    model,
  };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(data));
}
