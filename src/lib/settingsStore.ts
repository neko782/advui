// Simple localStorage-backed settings store for API connections and chat presets
import { toIntOrNull } from './utils/numbers.js';
import { safeRead, safeWrite } from './utils/localStorageHelper.js';
import {
  DEFAULT_PRESET_FIELDS,
  makeDefaultPreset,
  ensurePresetList,
  deriveDefaultPreset
} from './utils/presetHelpers.js';
import type {
  Settings,
  Connection,
  Preset,
  ApiMode,
  Keybinds,
  DefaultChatSettings
} from './types/index.js';

export const SETTINGS_KEY = 'openai.settings.v1';

function genConnectionId(): string {
  return `connection_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

const API_MODE_VALUES: ReadonlySet<string> = new Set(['responses', 'chat_completions']);

const DEFAULT_API_BASE_URL = 'https://api.openai.com/v1';

interface MakeDefaultConnectionOptions {
  apiKey?: string;
  apiBaseUrl?: string;
  apiMode?: string;
}

function makeDefaultConnection(options: MakeDefaultConnectionOptions = {}): Connection {
  const { apiKey = '', apiBaseUrl = DEFAULT_API_BASE_URL, apiMode = 'responses' } = options;
  const normalizedMode: ApiMode = API_MODE_VALUES.has(apiMode) ? apiMode as ApiMode : 'responses';
  return {
    id: 'connection-default',
    name: 'Default',
    apiKey: typeof apiKey === 'string' ? apiKey : '',
    apiBaseUrl: normalizeApiBaseUrl(apiBaseUrl),
    apiMode: normalizedMode,
  };
}

function normalizeApiBaseUrl(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_API_BASE_URL;
  const trimmed = value.trim();
  if (!trimmed) return DEFAULT_API_BASE_URL;
  return trimmed;
}

interface NormalizeConnectionOptions {
  fallbackApiMode?: string;
}

function normalizeConnection(
  raw: unknown,
  index: number = 0,
  options: NormalizeConnectionOptions = {}
): Connection | null {
  const { fallbackApiMode = 'responses' } = options;
  if (!raw || typeof raw !== 'object') return null;
  const connection = { ...(raw as Record<string, unknown>) } as Partial<Connection>;
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
  connection.apiMode = API_MODE_VALUES.has(rawMode) ? rawMode as ApiMode : 'responses';
  return connection as Connection;
}

interface FallbackOptions {
  apiKey?: string;
  apiBaseUrl?: string;
  apiMode?: string;
}

function ensureConnectionList(list: unknown, fallback: FallbackOptions = {}): Connection[] {
  const arr = Array.isArray(list) ? list : [];
  const fallbackApiMode = API_MODE_VALUES.has(fallback?.apiMode || '') ? fallback.apiMode! : 'responses';
  let normalized = arr
    .map((item, index) => normalizeConnection(item, index, { fallbackApiMode }))
    .filter((item): item is Connection => item !== null);
  if (!normalized.length) {
    normalized = [makeDefaultConnection({ ...fallback, apiMode: fallbackApiMode })];
  }
  const seen = new Set<string>();
  return normalized.map((item, index) => {
    let id = item.id;
    while (seen.has(id)) id = genConnectionId();
    seen.add(id);
    const mode: ApiMode = API_MODE_VALUES.has(item.apiMode) ? item.apiMode : 'responses';
    return {
      ...item,
      id,
      name: (typeof item.name === 'string' && item.name.trim()) ? item.name.trim() : `Connection ${index + 1}`,
      apiMode: mode,
    };
  });
}

function attachCompatFields(out: Partial<Settings> & Record<string, unknown>): Settings {
  const fallbackMode: ApiMode = API_MODE_VALUES.has(out?.apiMode as string || '') ? out.apiMode as ApiMode : 'responses';
  const connections = ensureConnectionList(out.connections, {
    apiKey: out.apiKey as string,
    apiBaseUrl: out.apiBaseUrl as string,
    apiMode: fallbackMode,
  });
  const connectionIds = connections.map((c) => c.id);
  let selectedConnectionId = typeof out.selectedConnectionId === 'string' ? out.selectedConnectionId : '';
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
    ? candidatePresetId!
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
  const activeApiMode: ApiMode = API_MODE_VALUES.has(activeConnection?.apiMode) ? activeConnection.apiMode : 'responses';
  out.apiMode = activeApiMode;
  out.apiKey = typeof activeConnection?.apiKey === 'string' ? activeConnection.apiKey : '';
  out.apiBaseUrl = normalizeApiBaseUrl(activeConnection?.apiBaseUrl);
  out.showThinkingSettings = !!out.showThinkingSettings;
  out.fancyEffects = !!out.fancyEffects;
  out.allowInlineHtml = !!out.allowInlineHtml;
  return out as Settings;
}

export function getConnections(settings: Partial<Settings> | null): Connection[] {
  return Array.isArray(settings?.connections) ? settings.connections : [];
}

export function findConnection(settings: Partial<Settings> | null, connectionId?: string | null): Connection | null {
  const list = getConnections(settings);
  if (connectionId) {
    const found = list.find((c) => c?.id === connectionId);
    if (found) return found;
  }
  const fallbackId = typeof settings?.selectedConnectionId === 'string' ? settings.selectedConnectionId : null;
  return list.find((c) => c?.id === fallbackId) || list[0] || null;
}

const DEFAULT_KEYBINDS: Keybinds = {
  sendMessage: 'Enter',
  newLine: 'Shift+Enter',
};

const VALID_KEYBINDS = ['Enter', 'Shift+Enter', 'Ctrl+Enter', 'Alt+Enter', 'None'];

function normalizeKeybinds(keybinds: unknown): Keybinds {
  if (!keybinds || typeof keybinds !== 'object') return { ...DEFAULT_KEYBINDS };

  const kb = keybinds as Record<string, unknown>;
  const normalized: Keybinds = { sendMessage: DEFAULT_KEYBINDS.sendMessage, newLine: DEFAULT_KEYBINDS.newLine };
  for (const action of ['sendMessage', 'newLine'] as const) {
    const value = kb[action];
    normalized[action] = VALID_KEYBINDS.includes(value as string) ? value as string : DEFAULT_KEYBINDS[action];
  }
  return normalized;
}

export function loadSettings(): Settings {
  const defaults = attachCompatFields({
    apiKey: '',
    apiBaseUrl: DEFAULT_API_BASE_URL,
    connections: [makeDefaultConnection()],
    selectedConnectionId: 'connection-default',
    presets: [makeDefaultPreset('connection-default')],
    selectedPresetId: 'preset-default',
    debug: false,
    apiMode: 'responses' as ApiMode,
    keybinds: { ...DEFAULT_KEYBINDS },
    showThinkingSettings: false,
    fancyEffects: false,
    allowInlineHtml: false,
  });
  const parsed = safeRead<Record<string, unknown> | null>(SETTINGS_KEY, null, (value) => (value && typeof value === 'object' ? value as Record<string, unknown> : null));
  if (!parsed) return defaults;
  try {
    const mode: ApiMode = typeof parsed?.apiMode === 'string' && API_MODE_VALUES.has(parsed.apiMode)
      ? parsed.apiMode as ApiMode
      : 'responses';
    const connections = ensureConnectionList(parsed?.connections, {
      apiKey: parsed?.apiKey as string,
      apiBaseUrl: parsed?.apiBaseUrl as string,
      apiMode: mode,
    });
    const connectionIds = connections.map((c) => c.id);
    let selectedConnectionId = typeof parsed?.selectedConnectionId === 'string' ? parsed.selectedConnectionId : '';
    if (!connectionIds.includes(selectedConnectionId)) {
      selectedConnectionId = connectionIds[0] || makeDefaultConnection().id;
    }
    const presetSource = (Array.isArray(parsed?.presets) && (parsed.presets as unknown[]).length)
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
      ? candidateId!
      : presets[0]?.id || makeDefaultPreset(selectedConnectionId).id;
    const debug = typeof parsed?.debug === 'boolean' ? !!parsed.debug : false;
    const apiKey = typeof parsed?.apiKey === 'string' ? parsed.apiKey : '';
    const apiBaseUrl = normalizeApiBaseUrl(parsed?.apiBaseUrl);
    const keybinds = normalizeKeybinds(parsed?.keybinds);
    const showThinkingSettings = !!parsed?.showThinkingSettings;
    const fancyEffects = !!parsed?.fancyEffects;
    const allowInlineHtml = !!parsed?.allowInlineHtml;
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
      fancyEffects,
      allowInlineHtml,
    });
  } catch (err) {
    console.error('Failed to load settings, falling back to defaults:', err);
    return defaults;
  }
}

export function saveSettings(next: Partial<Settings>): Settings {
  const fallbackApiMode: ApiMode = (() => {
    if (Array.isArray(next?.connections)) {
      const withMode = next.connections.find((c) => API_MODE_VALUES.has(c?.apiMode));
      if (withMode) return withMode.apiMode;
    }
    return API_MODE_VALUES.has(next?.apiMode || '') ? next.apiMode! : 'responses';
  })();
  const connections = ensureConnectionList(next?.connections, {
    apiKey: next?.apiKey,
    apiBaseUrl: next?.apiBaseUrl,
    apiMode: fallbackApiMode,
  });
  const connectionIds = connections.map((c) => c.id);
  let selectedConnectionId = typeof next?.selectedConnectionId === 'string' ? next.selectedConnectionId : '';
  if (!connectionIds.includes(selectedConnectionId)) {
    selectedConnectionId = connectionIds[0] || makeDefaultConnection().id;
  }
  const presets = ensurePresetList(next?.presets, {
    allowedConnectionIds: connectionIds,
    fallbackConnectionId: selectedConnectionId,
  });
  const candidateId = typeof next?.selectedPresetId === 'string' ? next.selectedPresetId : null;
  const selectedPresetId = presets.some((p) => p.id === candidateId)
    ? candidateId!
    : presets[0]?.id || makeDefaultPreset(selectedConnectionId).id;
  const activeConnection = connections.find((c) => c.id === selectedConnectionId)
    || connections[0]
    || makeDefaultConnection({ apiMode: fallbackApiMode });
  const activeApiMode: ApiMode = API_MODE_VALUES.has(activeConnection?.apiMode) ? activeConnection.apiMode : 'responses';
  const keybinds = normalizeKeybinds(next?.keybinds);
  const showThinkingSettings = !!next?.showThinkingSettings;
  const fancyEffects = !!next?.fancyEffects;
  const allowInlineHtml = !!next?.allowInlineHtml;
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
    fancyEffects,
    allowInlineHtml,
  });
  const ok = safeWrite(SETTINGS_KEY, data);
  if (!ok) {
    throw new Error('Failed to persist settings.');
  }
  return data;
}

