import { normalizeReasoning, normalizeVerbosity, normalizeReasoningSummary, parseMaxTokens, parseTopP, parseTemperature, parseThinkingBudgetTokens } from './validation.js'

export const DEFAULT_SYSTEM_PROMPT = 'You are a helpful assistant.'

export const DEFAULT_PRESET_FIELDS = {
  model: 'gpt-5',
  streaming: true,
  maxOutputTokens: null,
  topP: null,
  temperature: null,
  reasoningEffort: 'none',
  textVerbosity: 'medium',
  reasoningSummary: 'auto',
  thinkingEnabled: false,
  thinkingBudgetTokens: null,
  connectionId: null,
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
}

export function generatePresetId() {
  return `preset_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function sanitizeName(name, index) {
  if (typeof name === 'string' && name.trim()) return name.trim()
  return `Preset ${index + 1}`
}

function resolveConnectionId(candidate, allowedConnectionIds = [], fallbackConnectionId = null) {
  const trimmed = typeof candidate === 'string' && candidate.trim() ? candidate.trim() : null
  if (!allowedConnectionIds || !allowedConnectionIds.length) {
    return trimmed ?? fallbackConnectionId ?? null
  }
  if (trimmed && allowedConnectionIds.includes(trimmed)) {
    return trimmed
  }
  return allowedConnectionIds.includes(fallbackConnectionId) ? fallbackConnectionId : (allowedConnectionIds[0] || null)
}

export function normalizePreset(raw, index = 0, {
  generateId = false,
  allowedConnectionIds = [],
  fallbackConnectionId = null,
  defaultSystemPrompt = DEFAULT_SYSTEM_PROMPT,
} = {}) {
  const base = raw && typeof raw === 'object' ? { ...raw } : {}
  const id = generateId
    ? ((typeof base.id === 'string' && base.id.trim()) ? base.id.trim() : generatePresetId())
    : ((typeof base.id === 'string' && base.id.trim()) ? base.id.trim() : null)
  const name = sanitizeName(base.name, index)
  const model = (typeof base.model === 'string' && base.model.trim()) ? base.model.trim() : DEFAULT_PRESET_FIELDS.model
  const streaming = typeof base.streaming === 'boolean' ? base.streaming : DEFAULT_PRESET_FIELDS.streaming
  const maxOutputTokens = parseMaxTokens(base.maxOutputTokens)
  const topP = parseTopP(base.topP)
  const temperature = parseTemperature(base.temperature)
  const reasoningEffort = normalizeReasoning(base.reasoningEffort)
  const textVerbosity = normalizeVerbosity(base.textVerbosity)
  const reasoningSummary = normalizeReasoningSummary(base.reasoningSummary)
  const thinkingEnabled = !!base.thinkingEnabled
  const thinkingBudgetTokens = parseThinkingBudgetTokens(base.thinkingBudgetTokens)
  const connectionId = resolveConnectionId(base.connectionId, allowedConnectionIds, fallbackConnectionId)
  const systemPrompt = typeof base.systemPrompt === 'string' ? base.systemPrompt : defaultSystemPrompt
  return {
    id,
    name,
    model,
    streaming,
    maxOutputTokens: maxOutputTokens ?? null,
    topP: topP ?? null,
    temperature: temperature ?? null,
    reasoningEffort,
    textVerbosity,
    reasoningSummary,
    thinkingEnabled,
    thinkingBudgetTokens,
    connectionId,
    systemPrompt,
  }
}

export function makeDefaultPreset(connectionId = null) {
  return {
    id: 'preset-default',
    name: 'Default',
    ...DEFAULT_PRESET_FIELDS,
    connectionId,
  }
}

export function ensurePresetList(list, { allowedConnectionIds = [], fallbackConnectionId = null } = {}) {
  const arr = Array.isArray(list) ? list : []
  const normalized = arr
    .map((item, index) => normalizePreset(item, index, {
      generateId: true,
      allowedConnectionIds,
      fallbackConnectionId,
    }))
    .filter(Boolean)

  if (!normalized.length) {
    return [makeDefaultPreset(fallbackConnectionId)]
  }

  const seen = new Set()
  return normalized.map((preset) => {
    let id = preset.id
    while (seen.has(id)) {
      id = generatePresetId()
    }
    seen.add(id)
    return { ...preset, id }
  })
}

export function deriveDefaultPreset(parsed, options = {}) {
  const fallbackConnectionId = options?.fallbackConnectionId || null
  const allowedConnectionIds = Array.isArray(options?.allowedConnectionIds) ? options.allowedConnectionIds : []
  const candidate = {
    id: 'preset-default',
    name: 'Default',
    model: (parsed?.defaultChat?.model) || parsed?.model || DEFAULT_PRESET_FIELDS.model,
    streaming: typeof parsed?.defaultChat?.streaming === 'boolean'
      ? parsed.defaultChat.streaming
      : DEFAULT_PRESET_FIELDS.streaming,
    maxOutputTokens: parsed?.defaultChat?.maxOutputTokens ?? null,
    topP: parsed?.defaultChat?.topP ?? null,
    temperature: parsed?.defaultChat?.temperature ?? null,
    reasoningEffort: parsed?.defaultChat?.reasoningEffort || DEFAULT_PRESET_FIELDS.reasoningEffort,
    textVerbosity: parsed?.defaultChat?.textVerbosity || DEFAULT_PRESET_FIELDS.textVerbosity,
    reasoningSummary: parsed?.defaultChat?.reasoningSummary || DEFAULT_PRESET_FIELDS.reasoningSummary,
    thinkingEnabled: !!parsed?.defaultChat?.thinkingEnabled,
    thinkingBudgetTokens: parsed?.defaultChat?.thinkingBudgetTokens ?? null,
    connectionId: parsed?.defaultChat?.connectionId
      || parsed?.connectionId
      || fallbackConnectionId,
    systemPrompt: typeof parsed?.defaultChat?.systemPrompt === 'string'
      ? parsed.defaultChat.systemPrompt
      : DEFAULT_SYSTEM_PROMPT,
  }
  return normalizePreset(candidate, 0, {
    generateId: true,
    allowedConnectionIds,
    fallbackConnectionId,
  })
}

export function resolvePreset(settings, preferences = {}) {
  const list = Array.isArray(settings?.presets) ? settings.presets : []
  const byId = new Map(list.map((preset) => [preset?.id, preset]))

  const allowedConnectionIds = Array.isArray(settings?.connections)
    ? settings.connections.map((c) => c?.id).filter((id) => typeof id === 'string')
    : []
  const fallbackConnectionId = typeof settings?.selectedConnectionId === 'string'
    ? settings.selectedConnectionId
    : null

  const pickById = (id) => (typeof id === 'string' ? byId.get(id) : null)

  let chosen = pickById(preferences?.presetId)
  if (!chosen && preferences?.preset && typeof preferences.preset === 'object') {
    chosen = pickById(preferences.preset.id) || preferences.preset
  }
  if (!chosen) {
    chosen = pickById(settings?.selectedPresetId)
  }
  if (!chosen) {
    chosen = list[0]
  }

  if (!chosen) {
    return makeDefaultPreset(fallbackConnectionId)
  }

  return normalizePreset(chosen, 0, {
    allowedConnectionIds,
    fallbackConnectionId,
  })
}

export function computeConnectionId({ preset, settings, fallbackConnectionId = null } = {}) {
  const presetConn = typeof preset?.connectionId === 'string' && preset.connectionId.trim()
    ? preset.connectionId.trim()
    : null
  if (presetConn) return presetConn
  const settingsConn = typeof settings?.selectedConnectionId === 'string' && settings.selectedConnectionId.trim()
    ? settings.selectedConnectionId.trim()
    : null
  if (settingsConn) return settingsConn
  return fallbackConnectionId
}

export function buildChatSettings(preset, settings) {
  return {
    model: preset.model,
    streaming: preset.streaming,
    presetId: preset.id,
    maxOutputTokens: preset.maxOutputTokens,
    topP: preset.topP,
    temperature: preset.temperature,
    reasoningEffort: preset.reasoningEffort,
    textVerbosity: preset.textVerbosity,
    reasoningSummary: preset.reasoningSummary,
    thinkingEnabled: !!preset.thinkingEnabled,
    thinkingBudgetTokens: parseThinkingBudgetTokens(preset.thinkingBudgetTokens),
    connectionId: computeConnectionId({ preset, settings }),
  }
}
