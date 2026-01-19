// Local cache for OpenAI models + helpers to fetch once and refresh on demand
import { listModels } from './openaiClient.js';
import { loadSettings, findConnection } from './settingsStore.js';
import { safeRead, safeWrite } from './utils/localStorageHelper.js';
import type { ModelsCacheEntry, ModelsStore, Connection } from './types/index.js';

const MODELS_KEY = 'openai.models.v2';
const DEFAULT_CACHE_ENTRY: ModelsCacheEntry = { ids: [], fetchedAt: 0 };

function getCacheKey(connectionId: string | null | undefined): string {
  if (typeof connectionId === 'string' && connectionId.trim()) return connectionId.trim();
  return 'default';
}

function sanitizeIdList(ids: unknown): string[] {
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string' && !!id.trim()) : [];
}

function readStore(): ModelsStore {
  return safeRead<ModelsStore>(MODELS_KEY, { entries: {} }, (parsed) => {
    if (parsed && typeof parsed === 'object') {
      const p = parsed as Record<string, unknown>;
      if (p.entries && typeof p.entries === 'object') {
        return { entries: p.entries as Record<string, ModelsCacheEntry> };
      }
      if (Array.isArray((p as { ids?: unknown }).ids)) {
        // migrate legacy v1 shape { ids, fetchedAt }
        return {
          entries: {
            default: {
              ids: sanitizeIdList((p as { ids?: unknown }).ids),
              fetchedAt: Number((p as { fetchedAt?: unknown })?.fetchedAt) || 0,
            },
          },
        };
      }
    }
    return { entries: {} };
  });
}

function writeStore(store: ModelsStore): ModelsStore {
  const ok = safeWrite(MODELS_KEY, { version: 2, entries: store.entries || {} });
  if (!ok) {
    console.error('Failed to persist models cache.');
  }
  return store;
}

function getEntry(store: ModelsStore, key: string): ModelsCacheEntry {
  const entry = store.entries?.[key];
  if (!entry || typeof entry !== 'object') return { ...DEFAULT_CACHE_ENTRY };
  return {
    ids: sanitizeIdList(entry.ids),
    fetchedAt: Number(entry.fetchedAt) || 0,
  };
}

export function loadModelsCache(connectionId: string | null | undefined): ModelsCacheEntry {
  const key = getCacheKey(connectionId);
  const store = readStore();
  return getEntry(store, key);
}

export function loadAllModelCaches(): Record<string, ModelsCacheEntry> {
  const store = readStore();
  const out: Record<string, ModelsCacheEntry> = {};
  for (const [key, value] of Object.entries(store.entries || {})) {
    out[key] = getEntry({ entries: { [key]: value } }, key);
  }
  return out;
}

function saveEntry(connectionId: string | null | undefined, ids: string[]): ModelsCacheEntry {
  const key = getCacheKey(connectionId);
  const store = readStore();
  const entry: ModelsCacheEntry = {
    ids: sanitizeIdList(ids),
    fetchedAt: Date.now(),
  };
  store.entries = { ...(store.entries || {}), [key]: entry };
  writeStore(store);
  return entry;
}

interface ConnectionInput {
  id?: string;
  connectionId?: string;
  apiKey?: string;
  apiBaseUrl?: string;
  apiMode?: 'responses' | 'chat_completions' | 'gemini';
}

function resolveConnection(input: ConnectionInput | string | null | undefined): { id: string; apiKey: string; apiBaseUrl?: string; apiMode?: 'responses' | 'chat_completions' | 'gemini' } {
  if (!input) {
    const settings = loadSettings();
    const active = findConnection(settings, settings?.selectedConnectionId);
    return {
      id: active?.id || 'default',
      apiKey: typeof active?.apiKey === 'string' ? active.apiKey : '',
      apiBaseUrl: active?.apiBaseUrl,
      apiMode: active?.apiMode,
    };
  }
  if (typeof input === 'string') {
    const settings = loadSettings();
    const candidate = findConnection(settings, input);
    const fallback = findConnection(settings);
    const chosen = candidate || fallback;
    return {
      id: chosen?.id || input || 'default',
      apiKey: typeof chosen?.apiKey === 'string' ? chosen.apiKey : '',
      apiBaseUrl: chosen?.apiBaseUrl,
      apiMode: chosen?.apiMode,
    };
  }
  const id = typeof input?.id === 'string' && input.id.trim()
    ? input.id.trim()
    : (typeof input?.connectionId === 'string' && input.connectionId.trim() ? input.connectionId.trim() : null);
  return {
    id: id || 'default',
    apiKey: typeof input?.apiKey === 'string' ? input.apiKey : '',
    apiBaseUrl: input?.apiBaseUrl,
    apiMode: input?.apiMode,
  };
}

export async function ensureModels(connectionInput?: ConnectionInput | string | null): Promise<ModelsCacheEntry> {
  const connection = resolveConnection(connectionInput);
  const cached = loadModelsCache(connection.id);
  if (cached.ids.length > 0) return cached;
  if (!connection.apiKey) return cached;
  const ids = await listModels({
    connectionId: connection.id,
    apiKey: connection.apiKey,
    apiBaseUrl: connection.apiBaseUrl,
    apiMode: connection.apiMode,
  });
  return saveEntry(connection.id, ids);
}

export async function refreshModels(connectionInput?: ConnectionInput | string | null): Promise<ModelsCacheEntry> {
  const connection = resolveConnection(connectionInput);
  if (!connection.apiKey) throw new Error('Missing API key.');
  const ids = await listModels({
    connectionId: connection.id,
    apiKey: connection.apiKey,
    apiBaseUrl: connection.apiBaseUrl,
    apiMode: connection.apiMode,
  });
  return saveEntry(connection.id, ids);
}

export function setModelsCache(connectionId: string | null | undefined, ids: string[]): ModelsCacheEntry {
  return saveEntry(connectionId, ids);
}

