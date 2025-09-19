// Simple localStorage-backed settings store for API key and model
export const SETTINGS_KEY = 'openai.settings.v1';

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { apiKey: '', model: 'gpt-4o-mini' };
    const parsed = JSON.parse(raw);
    return {
      apiKey: parsed.apiKey || '',
      model: parsed.model || 'gpt-4o-mini',
    };
  } catch {
    return { apiKey: '', model: 'gpt-4o-mini' };
  }
}

export function saveSettings(next) {
  const data = {
    apiKey: next.apiKey || '',
    model: next.model || 'gpt-4o-mini',
  };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(data));
}

