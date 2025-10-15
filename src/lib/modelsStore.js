// Local cache for OpenAI models + helpers to fetch once and refresh on demand
import { listModels } from './openaiClient.js'
import { loadSettings, findConnection } from './settingsStore.js'
import { safeRead, safeWrite } from './utils/localStorageHelper.js'

const MODELS_KEY = 'openai.models.v2'
const DEFAULT_CACHE_ENTRY = { ids: [], fetchedAt: 0 }

function getCacheKey(connectionId) {
  if (typeof connectionId === 'string' && connectionId.trim()) return connectionId.trim()
  return 'default'
}

function sanitizeIdList(ids) {
  return Array.isArray(ids) ? ids.filter(id => typeof id === 'string' && id.trim()) : []
}

function readStore() {
  return safeRead(MODELS_KEY, { entries: {} }, (parsed) => {
    if (parsed && typeof parsed === 'object' && parsed.entries && typeof parsed.entries === 'object') {
      return { entries: parsed.entries }
    }
    if (Array.isArray(parsed?.ids)) {
      // migrate legacy v1 shape { ids, fetchedAt }
      return {
        entries: {
          default: {
            ids: sanitizeIdList(parsed.ids),
            fetchedAt: Number(parsed?.fetchedAt) || 0,
          },
        },
      }
    }
    return { entries: {} }
  })
}

function writeStore(store) {
  const ok = safeWrite(MODELS_KEY, { version: 2, entries: store.entries || {} })
  if (!ok) {
    console.error('Failed to persist models cache.')
  }
  return store
}

function getEntry(store, key) {
  const entry = store.entries?.[key]
  if (!entry || typeof entry !== 'object') return { ...DEFAULT_CACHE_ENTRY }
  return {
    ids: sanitizeIdList(entry.ids),
    fetchedAt: Number(entry.fetchedAt) || 0,
  }
}

export function loadModelsCache(connectionId) {
  const key = getCacheKey(connectionId)
  const store = readStore()
  return getEntry(store, key)
}

export function loadAllModelCaches() {
  const store = readStore()
  const out = {}
  for (const [key, value] of Object.entries(store.entries || {})) {
    out[key] = getEntry({ entries: { [key]: value } }, key)
  }
  return out
}

function saveEntry(connectionId, ids) {
  const key = getCacheKey(connectionId)
  const store = readStore()
  const entry = {
    ids: sanitizeIdList(ids),
    fetchedAt: Date.now(),
  }
  store.entries = { ...(store.entries || {}), [key]: entry }
  writeStore(store)
  return entry
}

function resolveConnection(input) {
  if (!input) {
    const settings = loadSettings()
    const active = findConnection(settings, settings?.selectedConnectionId)
    return {
      id: active?.id || 'default',
      apiKey: typeof active?.apiKey === 'string' ? active.apiKey : '',
      apiBaseUrl: active?.apiBaseUrl,
    }
  }
  if (typeof input === 'string') {
    const settings = loadSettings()
    const candidate = findConnection(settings, input)
    const fallback = findConnection(settings)
    const chosen = candidate || fallback
    return {
      id: chosen?.id || input || 'default',
      apiKey: typeof chosen?.apiKey === 'string' ? chosen.apiKey : '',
      apiBaseUrl: chosen?.apiBaseUrl,
    }
  }
  const id = typeof input?.id === 'string' && input.id.trim()
    ? input.id.trim()
    : (typeof input?.connectionId === 'string' && input.connectionId.trim() ? input.connectionId.trim() : null)
  return {
    id: id || 'default',
    apiKey: typeof input?.apiKey === 'string' ? input.apiKey : '',
    apiBaseUrl: input?.apiBaseUrl,
  }
}

export async function ensureModels(connectionInput) {
  const connection = resolveConnection(connectionInput)
  const cached = loadModelsCache(connection.id)
  if (cached.ids.length > 0) return cached
  if (!connection.apiKey) return cached
  const ids = await listModels({
    connectionId: connection.id,
    apiKey: connection.apiKey,
    apiBaseUrl: connection.apiBaseUrl,
  })
  return saveEntry(connection.id, ids)
}

export async function refreshModels(connectionInput) {
  const connection = resolveConnection(connectionInput)
  if (!connection.apiKey) throw new Error('Missing OpenAI API key.')
  const ids = await listModels({
    connectionId: connection.id,
    apiKey: connection.apiKey,
    apiBaseUrl: connection.apiBaseUrl,
  })
  return saveEntry(connection.id, ids)
}

export function setModelsCache(connectionId, ids) {
  return saveEntry(connectionId, ids)
}
