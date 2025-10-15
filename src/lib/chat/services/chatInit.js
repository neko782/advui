// Chat initialization and preset management
import { loadSettings } from '../../settingsStore.js'
import { DEFAULT_SYSTEM_PROMPT, normalizePreset as normalizePresetHelper, buildChatSettings as buildChatSettingsHelper, computeConnectionId } from '../../utils/presetHelpers.js'

export { DEFAULT_SYSTEM_PROMPT }

export function makeSystemPrologue(idBase = 1, prompt = DEFAULT_SYSTEM_PROMPT) {
  return {
    id: idBase,
    role: 'system',
    content: typeof prompt === 'string' ? prompt : DEFAULT_SYSTEM_PROMPT,
    time: Date.now()
  }
}

export function normalizePreset(preset) {
  const normalized = normalizePresetHelper(preset, 0, {})
  return {
    id: normalized.id,
    model: normalized.model,
    streaming: normalized.streaming,
    maxOutputTokens: normalized.maxOutputTokens,
    topP: normalized.topP,
    temperature: normalized.temperature,
    reasoningEffort: normalized.reasoningEffort,
    textVerbosity: normalized.textVerbosity,
    reasoningSummary: normalized.reasoningSummary,
    thinkingEnabled: normalized.thinkingEnabled,
    thinkingBudgetTokens: normalized.thinkingBudgetTokens,
    connectionId: normalized.connectionId ?? undefined,
    systemPrompt: normalized.systemPrompt,
  }
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
  return computeConnectionId({
    preset,
    settings,
  })
}

export function buildChatSettings(preset, settings) {
  return buildChatSettingsHelper(preset, settings)
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
