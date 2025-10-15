// Simple localStorage-backed settings store for API connections and chat presets
import { toIntOrNull } from './utils/numbers.js'
import { safeRead, safeWrite } from './utils/localStorageHelper.js'
import { DEFAULT_PRESET_FIELDS, makeDefaultPreset, ensurePresetList, deriveDefaultPreset } from './utils/presetHelpers.js'

export const SETTINGS_KEY = 'openai.settings.v1';

function genConnectionId() {
  return `connection_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

const API_MODE_VALUES = new Set(['responses', 'chat_completions'])

const DEFAULT_API_BASE_URL = 'https://api.openai.com/v1';

function makeDefaultConnection({ apiKey = '', apiBaseUrl = DEFAULT_API_BASE_URL, apiMode = 'responses' } = {}) {
  const normalizedMode = API_MODE_VALUES.has(apiMode) ? apiMode : 'responses';
  return {
    id: 'connection-default',
    name: 'Default',
    apiKey: typeof apiKey === 'string' ? apiKey : '',
    apiBaseUrl: normalizeApiBaseUrl(apiBaseUrl),
    apiMode: normalizedMode,
  };
}

function normalizeApiBaseUrl(value) {
  if (typeof value !== 'string') return DEFAULT_API_BASE_URL;
  const trimmed = value.trim();
  if (!trimmed) return DEFAULT_API_BASE_URL;
  return trimmed;
}

function normalizeConnection(raw, index = 0, { fallbackApiMode = 'responses' } = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const connection = { ...raw };
  connection.id = typeof connection.id === 'string' && connection.id.trim()
    ? connection.id.trim()
    : genConnectionId();
  const nameSource = typeof connection.name === 'string' && connection.name.trim()
    ? connection.name.trim()
    : `Connection ${index + 1}`;
  connection.name = nameSource;
  connection.apiKey = typeof connection.apiKey === 'string' ? connection.apiKey : '';
  connection.apiBaseUrl = normalizeApiBaseUrl(connection.apiBaseUrl);
  const rawMode = typeof connection.apiMode === 'string' ? connection.apiMode : fallbackApiMode;
  connection.apiMode = API_MODE_VALUES.has(rawMode) ? rawMode : 'responses';
  return connection;
}

function ensureConnectionList(list, fallback = {}) {
  const arr = Array.isArray(list) ? list : [];
  const fallbackApiMode = API_MODE_VALUES.has(fallback?.apiMode) ? fallback.apiMode : 'responses';
  let normalized = arr
    .map((item, index) => normalizeConnection(item, index, { fallbackApiMode }))
    .filter(Boolean);
  if (!normalized.length) {
    normalized = [makeDefaultConnection({ ...fallback, apiMode: fallbackApiMode })];
  }
  const seen = new Set();
  return normalized.map((item, index) => {
    let id = item.id;
    while (seen.has(id)) id = genConnectionId();
    seen.add(id);
    const mode = API_MODE_VALUES.has(item.apiMode) ? item.apiMode : fallbackApiMode;
    return {
      ...item,
      id,
      name: (typeof item.name === 'string' && item.name.trim()) ? item.name.trim() : `Connection ${index + 1}`,
      apiMode: mode,
    };
  });
}

function attachCompatFields(out) {
  const fallbackMode = API_MODE_VALUES.has(out?.apiMode) ? out.apiMode : 'responses';
  const connections = ensureConnectionList(out.connections, {
    apiKey: out.apiKey,
    apiBaseUrl: out.apiBaseUrl,
    apiMode: fallbackMode,
  });
  const connectionIds = connections.map((c) => c.id);
  let selectedConnectionId = typeof out.selectedConnectionId === 'string' ? out.selectedConnectionId : null;
  if (!connectionIds.includes(selectedConnectionId)) {
    selectedConnectionId = connectionIds[0] || makeDefaultConnection().id;
  }
  out.connections = connections.map((c) => ({
    ...c,
    apiBaseUrl: normalizeApiBaseUrl(c.apiBaseUrl),
  }));
  out.selectedConnectionId = selectedConnectionId;

  const fallbackConnectionId = selectedConnectionId || connectionIds[0] || null;
  const ensuredPresets = ensurePresetList(out.presets, {
    allowedConnectionIds: connectionIds,
    fallbackConnectionId,
  });
  const candidatePresetId = typeof out.selectedPresetId === 'string' ? out.selectedPresetId : null;
  const selectedPresetId = ensuredPresets.some((p) => p.id === candidatePresetId)
    ? candidatePresetId
    : ensuredPresets[0]?.id || makeDefaultPreset(fallbackConnectionId).id;
  out.presets = ensuredPresets;
  out.selectedPresetId = selectedPresetId;

  const active = out.presets.find((p) => p.id === out.selectedPresetId) || out.presets[0] || makeDefaultPreset(fallbackConnectionId);
  out.defaultChat = {
    model: active.model,
    streaming: active.streaming,
    maxOutputTokens: active.maxOutputTokens ?? null,
    topP: active.topP ?? null,
    temperature: active.temperature ?? null,
    reasoningEffort: active.reasoningEffort || 'none',
    textVerbosity: active.textVerbosity || 'medium',
    reasoningSummary: active.reasoningSummary || 'auto',
    thinkingEnabled: !!active.thinkingEnabled,
    thinkingBudgetTokens: toIntOrNull(active.thinkingBudgetTokens),
    connectionId: active.connectionId || fallbackConnectionId,
  };
  out.model = active.model;
  const activeConnection = out.connections.find((c) => c.id === out.selectedConnectionId)
    || out.connections[0]
    || makeDefaultConnection();
  const activeApiMode = API_MODE_VALUES.has(activeConnection?.apiMode) ? activeConnection.apiMode : 'responses';
  out.apiMode = activeApiMode;
  out.apiKey = typeof activeConnection?.apiKey === 'string' ? activeConnection.apiKey : '';
  out.apiBaseUrl = normalizeApiBaseUrl(activeConnection?.apiBaseUrl);
  out.showThinkingSettings = !!out.showThinkingSettings;
  return out;
}

export function getConnections(settings) {
  return Array.isArray(settings?.connections) ? settings.connections : [];
}

export function findConnection(settings, connectionId) {
  const list = getConnections(settings);
  if (connectionId) {
    const found = list.find((c) => c?.id === connectionId);
    if (found) return found;
  }
  const fallbackId = typeof settings?.selectedConnectionId === 'string' ? settings.selectedConnectionId : null;
  return list.find((c) => c?.id === fallbackId) || list[0] || null;
}

// Normalized shape returned by loadSettings():
// {
//   apiKey,
//   apiBaseUrl,
//   connections,
//   selectedConnectionId,
//   presets,
//   selectedPresetId,
//   debug,
//   defaultChat,
//   model,
//   apiMode,
// }
const DEFAULT_KEYBINDS = {
  sendMessage: 'Enter',
  newLine: 'Shift+Enter',
};

const VALID_KEYBINDS = ['Enter', 'Shift+Enter', 'Ctrl+Enter', 'Alt+Enter', 'None'];

function normalizeKeybinds(keybinds) {
  if (!keybinds || typeof keybinds !== 'object') return { ...DEFAULT_KEYBINDS };

  const normalized = {};
  for (const action of ['sendMessage', 'newLine']) {
    const value = keybinds[action];
    normalized[action] = VALID_KEYBINDS.includes(value) ? value : DEFAULT_KEYBINDS[action];
  }
  return normalized;
}

export function loadSettings() {
  const defaults = attachCompatFields({
    apiKey: '',
    apiBaseUrl: DEFAULT_API_BASE_URL,
    connections: [makeDefaultConnection()],
    selectedConnectionId: 'connection-default',
    presets: [makeDefaultPreset('connection-default')],
    selectedPresetId: 'preset-default',
    debug: false,
    apiMode: 'responses',
    keybinds: { ...DEFAULT_KEYBINDS },
    showThinkingSettings: false,
  });
  const parsed = safeRead(SETTINGS_KEY, null, (value) => (value && typeof value === 'object' ? value : null));
  if (!parsed) return defaults;
  try {
    const mode = typeof parsed?.apiMode === 'string' && API_MODE_VALUES.has(parsed.apiMode)
      ? parsed.apiMode
      : 'responses';
    const connections = ensureConnectionList(parsed?.connections, {
      apiKey: parsed?.apiKey,
      apiBaseUrl: parsed?.apiBaseUrl,
      apiMode: mode,
    });
    const connectionIds = connections.map((c) => c.id);
    let selectedConnectionId = typeof parsed?.selectedConnectionId === 'string' ? parsed.selectedConnectionId : null;
    if (!connectionIds.includes(selectedConnectionId)) {
      selectedConnectionId = connectionIds[0] || makeDefaultConnection().id;
    }
    const presetSource = (Array.isArray(parsed?.presets) && parsed.presets.length)
      ? parsed.presets
      : [deriveDefaultPreset(parsed, {
        allowedConnectionIds: connectionIds,
        fallbackConnectionId: selectedConnectionId,
      })];
    const presets = ensurePresetList(presetSource, {
      allowedConnectionIds: connectionIds,
      fallbackConnectionId: selectedConnectionId,
    });
    const candidateId = typeof parsed?.selectedPresetId === 'string' ? parsed.selectedPresetId : null;
    const selectedPresetId = presets.some((p) => p.id === candidateId)
      ? candidateId
      : presets[0]?.id || makeDefaultPreset(selectedConnectionId).id;
    const debug = typeof parsed?.debug === 'boolean' ? !!parsed.debug : false;
    const apiKey = typeof parsed?.apiKey === 'string' ? parsed.apiKey : '';
    const apiBaseUrl = normalizeApiBaseUrl(parsed?.apiBaseUrl);
    const keybinds = normalizeKeybinds(parsed?.keybinds);
    const showThinkingSettings = !!parsed?.showThinkingSettings;
    return attachCompatFields({
      apiKey,
      apiBaseUrl,
      connections,
      selectedConnectionId,
      presets,
      selectedPresetId,
      debug,
      apiMode: mode,
      keybinds,
      showThinkingSettings,
    });
  } catch (err) {
    console.error('Failed to load settings, falling back to defaults:', err);
    return defaults;
  }
}

export function saveSettings(next) {
  const fallbackApiMode = (() => {
    if (Array.isArray(next?.connections)) {
      const withMode = next.connections.find((c) => API_MODE_VALUES.has(c?.apiMode));
      if (withMode) return withMode.apiMode;
    }
    return API_MODE_VALUES.has(next?.apiMode) ? next.apiMode : 'responses';
  })();
  const connections = ensureConnectionList(next?.connections, {
    apiKey: next?.apiKey,
    apiBaseUrl: next?.apiBaseUrl,
    apiMode: fallbackApiMode,
  });
  const connectionIds = connections.map((c) => c.id);
  let selectedConnectionId = typeof next?.selectedConnectionId === 'string' ? next.selectedConnectionId : null;
  if (!connectionIds.includes(selectedConnectionId)) {
    selectedConnectionId = connectionIds[0] || makeDefaultConnection().id;
  }
  const presets = ensurePresetList(next?.presets, {
    allowedConnectionIds: connectionIds,
    fallbackConnectionId: selectedConnectionId,
  });
  const candidateId = typeof next?.selectedPresetId === 'string' ? next.selectedPresetId : null;
  const selectedPresetId = presets.some((p) => p.id === candidateId)
    ? candidateId
    : presets[0]?.id || makeDefaultPreset(selectedConnectionId).id;
  const activeConnection = connections.find((c) => c.id === selectedConnectionId)
    || connections[0]
    || makeDefaultConnection({ apiMode: fallbackApiMode });
  const activeApiMode = API_MODE_VALUES.has(activeConnection?.apiMode) ? activeConnection.apiMode : 'responses';
  const keybinds = normalizeKeybinds(next?.keybinds);
  const showThinkingSettings = !!next?.showThinkingSettings;
  const data = attachCompatFields({
    apiKey: typeof next?.apiKey === 'string' ? next.apiKey : '',
    apiBaseUrl: normalizeApiBaseUrl(next?.apiBaseUrl),
    connections,
    selectedConnectionId,
    presets,
    selectedPresetId,
    debug: !!next?.debug,
    apiMode: activeApiMode,
    keybinds,
    showThinkingSettings,
  });
  const ok = safeWrite(SETTINGS_KEY, data);
  if (!ok) {
    throw new Error('Failed to persist settings.');
  }
  return data;
}
