// Chat initialization and preset management
import { loadSettings } from '../../settingsStore.js'
import { normalizeReasoning, normalizeVerbosity, normalizeReasoningSummary, parseMaxTokens, parseTopP, parseTemperature, parseThinkingBudgetTokens } from '../../utils/validation.js'

export const DEFAULT_SYSTEM_PROMPT = 'You are a helpful assistant.'

export function makeSystemPrologue(idBase = 1, prompt = DEFAULT_SYSTEM_PROMPT) {
  return {
    id: idBase,
    role: 'system',
    content: typeof prompt === 'string' ? prompt : DEFAULT_SYSTEM_PROMPT,
    time: Date.now()
  }
}

export function normalizePreset(p) {
  if (!p || typeof p !== 'object') {
    return {
      id: null,
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
      connectionId: undefined,
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
    }
  }
  const model = (typeof p.model === 'string' && p.model.trim()) ? p.model.trim() : 'gpt-5'
  const streaming = (typeof p.streaming === 'boolean') ? p.streaming : true
  const id = (typeof p.id === 'string' && p.id.trim()) ? p.id.trim() : null
  const maxOutputTokens = parseMaxTokens(p.maxOutputTokens)
  const topP = parseTopP(p.topP)
  const temperature = parseTemperature(p.temperature)
  const reasoningEffort = normalizeReasoning(p.reasoningEffort)
  const textVerbosity = normalizeVerbosity(p.textVerbosity)
  const reasoningSummary = normalizeReasoningSummary(p.reasoningSummary)
  const thinkingEnabled = !!p.thinkingEnabled
  const thinkingBudgetTokens = parseThinkingBudgetTokens(p.thinkingBudgetTokens)
  const connectionId = (typeof p.connectionId === 'string' && p.connectionId.trim()) ? p.connectionId.trim() : undefined
  const systemPrompt = (typeof p.systemPrompt === 'string') ? p.systemPrompt : DEFAULT_SYSTEM_PROMPT
  return { id, model, streaming, maxOutputTokens, topP, temperature, reasoningEffort, textVerbosity, reasoningSummary, thinkingEnabled, thinkingBudgetTokens, connectionId, systemPrompt }
}

export function pickPresetFromSettings(state) {
  const list = Array.isArray(state?.presets) ? state.presets : []
  if (typeof state?.selectedPresetId === 'string') {
    const sel = list.find(p => p?.id === state.selectedPresetId)
    if (sel) return normalizePreset(sel)
  }
  if (list.length) return normalizePreset(list[0])
  return normalizePreset(null)
}

export function presetSignature(state) {
  const list = Array.isArray(state?.presets) ? state.presets : []
  return list.map(p => [
    p?.id || '',
    p?.name || '',
    p?.model || '',
    typeof p?.streaming === 'boolean' ? (p.streaming ? 1 : 0) : 1,
    p?.maxOutputTokens ?? '',
    p?.topP ?? '',
    p?.temperature ?? '',
    p?.reasoningEffort || '',
    p?.textVerbosity || '',
    p?.reasoningSummary || '',
    p?.thinkingEnabled ? '1' : '0',
    p?.thinkingBudgetTokens ?? '',
    p?.connectionId || '',
    p?.systemPrompt || '',
  ].join('|')).join(';')
}

export function computeInitialConnectionId(preset, settings) {
  const presetConn = typeof preset?.connectionId === 'string' && preset.connectionId.trim()
    ? preset.connectionId.trim()
    : null
  if (presetConn) return presetConn
  const settingsConn = typeof settings?.selectedConnectionId === 'string' && settings.selectedConnectionId.trim()
    ? settings.selectedConnectionId.trim()
    : null
  return settingsConn
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
    connectionId: computeInitialConnectionId(preset, settings),
  }
}

export function recomputeNextIds(nodes) {
  try {
    const maxMsgId = (nodes || []).reduce((mx, n) => {
      const vMax = (n?.variants || []).reduce((m2, v) => Math.max(m2, Number(v?.id) || 0), 0)
      return Math.max(mx, vMax)
    }, 0)
    const maxNodeId = (nodes || []).reduce((mx, n) => Math.max(mx, Number(n?.id) || 0), 0)
    return { nextId: maxMsgId + 1, nextNodeId: maxNodeId + 1 }
  } catch {
    return { nextId: 1, nextNodeId: 1 }
  }
}
