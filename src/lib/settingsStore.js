// Simple localStorage-backed settings store for API key and chat presets
export const SETTINGS_KEY = 'openai.settings.v1';

function genPresetId() {
  return `preset_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function makeDefaultPreset() {
  return { id: 'preset-default', name: 'Default', model: 'gpt-4o-mini', streaming: true };
}

function normalizePreset(raw, index = 0) {
  if (!raw || typeof raw !== 'object') return null;
  const preset = { ...raw };
  preset.model = typeof preset.model === 'string' && preset.model.trim() ? preset.model.trim() : 'gpt-4o-mini';
  preset.streaming = typeof preset.streaming === 'boolean' ? preset.streaming : true;
  const nameSource = typeof preset.name === 'string' && preset.name.trim()
    ? preset.name.trim()
    : `Preset ${index + 1}`;
  preset.name = nameSource;
  preset.id = typeof preset.id === 'string' && preset.id.trim()
    ? preset.id.trim()
    : genPresetId();
  return preset;
}

function ensurePresetList(list) {
  const arr = Array.isArray(list) ? list : [];
  const normalized = arr
    .map((p, i) => normalizePreset(p, i))
    .filter(Boolean);
  if (!normalized.length) return [makeDefaultPreset()];
  const seen = new Set();
  return normalized.map((p) => {
    let id = p.id;
    while (seen.has(id)) id = genPresetId();
    seen.add(id);
    return { ...p, id };
  });
}

function deriveDefaultPreset(parsed) {
  const fromDefault = normalizePreset({
    id: 'preset-default',
    name: 'Default',
    model: (parsed?.defaultChat?.model) || parsed?.model || 'gpt-4o-mini',
    streaming: typeof parsed?.defaultChat?.streaming === 'boolean'
      ? parsed.defaultChat.streaming
      : true,
  }, 0);
  return fromDefault || makeDefaultPreset();
}

function attachCompatFields(out) {
  const active = out.presets.find((p) => p.id === out.selectedPresetId) || out.presets[0] || makeDefaultPreset();
  out.defaultChat = { model: active.model, streaming: active.streaming };
  out.model = active.model;
  return out;
}

// Normalized shape returned by loadSettings():
// { apiKey, presets, selectedPresetId, debug, defaultChat, model }
export function loadSettings() {
  const defaults = attachCompatFields({
    apiKey: '',
    presets: [makeDefaultPreset()],
    selectedPresetId: 'preset-default',
    debug: false,
  });
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    let presets = ensurePresetList(parsed?.presets);
    if (!presets.length) {
      presets = ensurePresetList([deriveDefaultPreset(parsed)]);
    }
    const candidateId = typeof parsed?.selectedPresetId === 'string' ? parsed.selectedPresetId : null;
    const selectedPresetId = presets.some((p) => p.id === candidateId)
      ? candidateId
      : presets[0]?.id || makeDefaultPreset().id;
    const debug = typeof parsed?.debug === 'boolean' ? !!parsed.debug : false;
    const apiKey = typeof parsed?.apiKey === 'string' ? parsed.apiKey : '';
    return attachCompatFields({ apiKey, presets, selectedPresetId, debug });
  } catch {
    return defaults;
  }
}

export function saveSettings(next) {
  const presets = ensurePresetList(next?.presets);
  const candidateId = typeof next?.selectedPresetId === 'string' ? next.selectedPresetId : null;
  const selectedPresetId = presets.some((p) => p.id === candidateId)
    ? candidateId
    : presets[0]?.id || makeDefaultPreset().id;
  const data = attachCompatFields({
    apiKey: typeof next?.apiKey === 'string' ? next.apiKey : '',
    presets,
    selectedPresetId,
    debug: !!next?.debug,
  });
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(data));
}
