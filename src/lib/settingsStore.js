// Simple localStorage-backed settings store for API key and chat presets
export const SETTINGS_KEY = 'openai.settings.v1';

function genPresetId() {
  return `preset_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

const DEFAULT_PRESET_FIELDS = {
  model: 'gpt-4o-mini',
  streaming: true,
  maxOutputTokens: null,
  topP: null,
  temperature: null,
  reasoningEffort: 'none',
  textVerbosity: 'medium',
  reasoningSummary: 'auto',
};

function makeDefaultPreset() {
  return {
    id: 'preset-default',
    name: 'Default',
    ...DEFAULT_PRESET_FIELDS,
  };
}

function toIntOrNull(val) {
  if (val === '' || val == null) return null;
  const num = Number(val);
  if (!Number.isFinite(num)) return null;
  const rounded = Math.max(1, Math.floor(num));
  return Number.isFinite(rounded) ? rounded : null;
}

function toClampedNumber(val, min, max) {
  if (val === '' || val == null) return null;
  const num = Number(val);
  if (!Number.isFinite(num)) return null;
  const clamped = Math.min(max, Math.max(min, num));
  return clamped;
}

const REASONING_VALUES = new Set(['none', 'minimal', 'low', 'medium', 'high']);
const TEXT_VERBOSITY_VALUES = new Set(['low', 'medium', 'high']);
const REASONING_SUMMARY_VALUES = new Set(['auto', 'concise', 'detailed']);

function normalizePreset(raw, index = 0) {
  if (!raw || typeof raw !== 'object') return null;
  const preset = { ...raw };
  preset.model = typeof preset.model === 'string' && preset.model.trim() ? preset.model.trim() : 'gpt-4o-mini';
  preset.streaming = typeof preset.streaming === 'boolean' ? preset.streaming : true;
  preset.maxOutputTokens = toIntOrNull(preset.maxOutputTokens);
  preset.topP = toClampedNumber(preset.topP, 0, 1) ?? null;
  preset.temperature = toClampedNumber(preset.temperature, 0, 2) ?? null;
  preset.reasoningEffort = REASONING_VALUES.has(preset.reasoningEffort) ? preset.reasoningEffort : 'none';
  preset.textVerbosity = TEXT_VERBOSITY_VALUES.has(preset.textVerbosity) ? preset.textVerbosity : 'medium';
  preset.reasoningSummary = REASONING_SUMMARY_VALUES.has(preset.reasoningSummary)
    ? preset.reasoningSummary
    : 'auto';
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
    maxOutputTokens: parsed?.defaultChat?.maxOutputTokens ?? null,
    topP: parsed?.defaultChat?.topP ?? null,
    temperature: parsed?.defaultChat?.temperature ?? null,
    reasoningEffort: parsed?.defaultChat?.reasoningEffort || 'none',
    textVerbosity: parsed?.defaultChat?.textVerbosity || 'medium',
    reasoningSummary: parsed?.defaultChat?.reasoningSummary || 'auto',
  }, 0);
  return fromDefault || makeDefaultPreset();
}

function attachCompatFields(out) {
  const active = out.presets.find((p) => p.id === out.selectedPresetId) || out.presets[0] || makeDefaultPreset();
  out.defaultChat = {
    model: active.model,
    streaming: active.streaming,
    maxOutputTokens: active.maxOutputTokens ?? null,
    topP: active.topP ?? null,
    temperature: active.temperature ?? null,
    reasoningEffort: active.reasoningEffort || 'none',
    textVerbosity: active.textVerbosity || 'medium',
    reasoningSummary: active.reasoningSummary || 'auto',
  };
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
