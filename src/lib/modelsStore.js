// Local cache for OpenAI models + helpers to fetch once and refresh on demand
import { listModels } from './openaiClient.js'
import { loadSettings } from './settingsStore.js'

const MODELS_KEY = 'openai.models.v1'

export function loadModelsCache() {
  try {
    const raw = localStorage.getItem(MODELS_KEY)
    if (!raw) return { ids: [], fetchedAt: 0 }
    const parsed = JSON.parse(raw)
    return {
      ids: Array.isArray(parsed?.ids) ? parsed.ids.filter(x => typeof x === 'string') : [],
      fetchedAt: Number(parsed?.fetchedAt) || 0,
    }
  } catch {
    return { ids: [], fetchedAt: 0 }
  }
}

function saveModelsCache(ids) {
  const data = { ids: Array.isArray(ids) ? ids : [], fetchedAt: Date.now() }
  localStorage.setItem(MODELS_KEY, JSON.stringify(data))
  return data
}

// Ensure models are available locally.
// If not cached yet, tries to fetch (requires API key). Otherwise returns cached immediately.
export async function ensureModels() {
  const cached = loadModelsCache()
  if (cached.ids.length > 0) return cached
  // no cached models; only fetch if API key is present
  const { apiKey } = loadSettings()
  if (!apiKey) return cached
  const ids = await listModels()
  return saveModelsCache(ids)
}

// Force-refresh models from the API (used by the Settings refresh button)
export async function refreshModels() {
  const ids = await listModels()
  return saveModelsCache(ids)
}

// Directly set/replace cached models (used after testing a one-off key)
export function setModelsCache(ids) {
  return saveModelsCache(ids)
}
