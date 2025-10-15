// Chat store persisted in localStorage. One entry per chat.
// We keep selectedId in localStorage for quick access.

import { loadSettings } from './settingsStore.js'
import { enforceUniqueParents } from './branching.js'
import { getAllChats as storeGetAll, getChat as storeGetOne, putChat as storePut, deleteChat as storeDelete } from './storage.js'
import { toIntOrNull, toClampedNumber } from './utils/numbers.js'
import { DEFAULT_SYSTEM_PROMPT } from './chat/services/chatInit.js'

export const SELECTED_KEY = 'openai.chats.selected.v1'

function safeParse(raw, fallback) { try { return JSON.parse(raw) } catch { return fallback } }

const REASONING_VALUES = new Set(['none', 'minimal', 'low', 'medium', 'high'])
const TEXT_VERBOSITY_VALUES = new Set(['low', 'medium', 'high'])
const REASONING_SUMMARY_VALUES = new Set(['auto', 'concise', 'detailed'])
const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key)

function normalizeReasoning(val) {
  return REASONING_VALUES.has(val) ? val : 'none'
}

function normalizeVerbosity(val) {
  return TEXT_VERBOSITY_VALUES.has(val) ? val : 'medium'
}

function normalizeReasoningSummary(val) {
  return REASONING_SUMMARY_VALUES.has(val) ? val : 'auto'
}

function resolvePreset(settings, preferences = {}) {
  const list = Array.isArray(settings?.presets) ? settings.presets : []
  const byId = (id) => list.find(p => p && typeof p.id === 'string' && p.id === id)
  const fallbackConnectionId = typeof settings?.selectedConnectionId === 'string' ? settings.selectedConnectionId : null
  let chosen = null
  if (preferences?.presetId && typeof preferences.presetId === 'string') {
    chosen = byId(preferences.presetId)
  }
  if (!chosen && preferences?.preset && typeof preferences.preset === 'object') {
    const p = preferences.preset
    const id = typeof p.id === 'string' ? p.id : null
    chosen = id ? byId(id) : null
    if (!chosen) {
      chosen = {
        id,
        name: typeof p.name === 'string' ? p.name : '',
        model: typeof p.model === 'string' && p.model.trim() ? p.model.trim() : 'gpt-5',
        streaming: typeof p.streaming === 'boolean' ? p.streaming : true,
        maxOutputTokens: toIntOrNull(p.maxOutputTokens),
        topP: toClampedNumber(p.topP, 0, 1),
        temperature: toClampedNumber(p.temperature, 0, 2),
        reasoningEffort: normalizeReasoning(p.reasoningEffort),
        textVerbosity: normalizeVerbosity(p.textVerbosity),
        reasoningSummary: normalizeReasoningSummary(p.reasoningSummary),
        thinkingEnabled: !!p.thinkingEnabled,
        thinkingBudgetTokens: toIntOrNull(p.thinkingBudgetTokens),
        connectionId: typeof p.connectionId === 'string' ? p.connectionId : fallbackConnectionId,
        systemPrompt: typeof p.systemPrompt === 'string' ? p.systemPrompt : DEFAULT_SYSTEM_PROMPT,
      }
    }
  }
  if (!chosen && typeof settings?.selectedPresetId === 'string') {
    chosen = byId(settings.selectedPresetId)
  }
  if (!chosen) {
    chosen = list[0] || null
  }
  if (chosen) {
    return {
      id: typeof chosen.id === 'string' ? chosen.id : null,
      name: typeof chosen.name === 'string' ? chosen.name : '',
      model: typeof chosen.model === 'string' && chosen.model.trim() ? chosen.model.trim() : 'gpt-5',
      streaming: typeof chosen.streaming === 'boolean' ? chosen.streaming : true,
      maxOutputTokens: toIntOrNull(chosen.maxOutputTokens),
      topP: toClampedNumber(chosen.topP, 0, 1),
      temperature: toClampedNumber(chosen.temperature, 0, 2),
      reasoningEffort: normalizeReasoning(chosen.reasoningEffort),
      textVerbosity: normalizeVerbosity(chosen.textVerbosity),
      reasoningSummary: normalizeReasoningSummary(chosen.reasoningSummary),
      thinkingEnabled: !!chosen.thinkingEnabled,
      thinkingBudgetTokens: toIntOrNull(chosen.thinkingBudgetTokens),
      connectionId: typeof chosen.connectionId === 'string' ? chosen.connectionId : fallbackConnectionId,
      systemPrompt: typeof chosen.systemPrompt === 'string' ? chosen.systemPrompt : DEFAULT_SYSTEM_PROMPT,
    }
  }
  return {
    id: null,
    name: '',
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
    connectionId: fallbackConnectionId,
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
  }
}

export function loadAll() {
  // Back-compat shim for existing callers that expect { selectedId }
  try {
    const raw = localStorage.getItem(SELECTED_KEY)
    const sel = safeParse(raw, { selectedId: null })
    return { chats: [], selectedId: sel?.selectedId || null }
  } catch { return { chats: [], selectedId: null } }
}

export function setSelected(id) {
  try {
    const val = { selectedId: id || null }
    localStorage.setItem(SELECTED_KEY, JSON.stringify(val))
    return val
  } catch { return { selectedId: null } }
}

export async function getChats() {
  // Return all chats; sort done by callers if needed
  try { return await storeGetAll() } catch { return [] }
}

export async function getChat(id) {
  try { return await storeGetOne(id) } catch { return null }
}

export function computeTitleFromNodes(nodes, rootId) {
  try {
    const byId = new Map((nodes || []).map(n => [n.id, n]))
    const guard = new Set()
    let cur = rootId
    let title = ''
    let steps = 0
    while (cur != null && steps < 200) {
      steps++
      if (guard.has(cur)) break
      guard.add(cur)
      const n = byId.get(cur)
      if (!n) break
      const vi = Math.max(0, Math.min((n?.variants?.length || 1) - 1, Number(n?.active) || 0))
      const v = n?.variants?.[vi]
      if (!v) break
      if (!title && v?.role === 'user' && typeof v?.content === 'string' && v.content.trim()) {
        title = (v.content || '').trim()
      }
      if (v?.next == null) break
      cur = v.next
    }
    const base = title || 'New Chat'
    return base.length > 40 ? (base.slice(0, 40) + '…') : base
  } catch { return 'New Chat' }
}

function migrateMessagesToGraph(messages) {
  // Remove legacy branching/variant metadata; create linear next pointers.
  const now = Date.now()
  const arr = Array.isArray(messages) ? messages.slice() : []
  const cleaned = arr.map(m => ({ id: m.id, role: m.role, content: m.content, time: m.time || now, typing: !!m.typing, error: m.error }))
  const byId = new Map(cleaned.map(m => [m.id, { ...m, next: [] }]))
  // Link sequentially
  for (let i = 0; i < cleaned.length - 1; i++) {
    const a = byId.get(cleaned[i].id)
    const b = cleaned[i + 1]
    a.next.push(b.id)
  }
  return {
    messages: [...byId.values()],
    rootId: cleaned[0]?.id || 1,
    selected: {},
  }
}

export async function upsertChat(chat) {
  // Persist chat to localStorage
  try { await storePut(chat); return chat } catch { return chat }
}

export async function saveChatContent(id, { nodes, settings, rootId }) {
  if (!id) return null
  const existing = await storeGetOne(id)
  // Be resilient: if the record doesn't exist (e.g., backend switched from IDB<->LS), create it
  const defaults = loadSettings()
  const basePreset = resolvePreset(defaults, { presetId: settings?.presetId || existing?.presetId })
  const pickSetting = (key) => {
    if (hasOwn(settings, key)) return settings[key]
    if (hasOwn(existing?.settings, key)) return existing.settings[key]
    if (hasOwn(basePreset, key)) return basePreset[key]
    return undefined
  }
  const baseSettings = {
    model: (settings?.model || existing?.settings?.model || basePreset.model || 'gpt-5'),
    streaming: (typeof settings?.streaming === 'boolean')
      ? settings.streaming
      : (typeof existing?.settings?.streaming === 'boolean'
        ? existing.settings.streaming
        : (typeof basePreset.streaming === 'boolean' ? basePreset.streaming : true)),
    maxOutputTokens: toIntOrNull(pickSetting('maxOutputTokens')),
    topP: toClampedNumber(pickSetting('topP'), 0, 1),
    temperature: toClampedNumber(pickSetting('temperature'), 0, 2),
    reasoningEffort: normalizeReasoning(pickSetting('reasoningEffort')),
    textVerbosity: normalizeVerbosity(pickSetting('textVerbosity')),
    reasoningSummary: normalizeReasoningSummary(pickSetting('reasoningSummary')),
    thinkingEnabled: !!pickSetting('thinkingEnabled'),
    thinkingBudgetTokens: toIntOrNull(pickSetting('thinkingBudgetTokens')),
    connectionId: (() => {
      const raw = pickSetting('connectionId')
      if (typeof raw === 'string' && raw.trim()) return raw.trim()
      if (typeof basePreset?.connectionId === 'string' && basePreset.connectionId.trim()) return basePreset.connectionId.trim()
      return (typeof defaults?.selectedConnectionId === 'string' && defaults.selectedConnectionId.trim())
        ? defaults.selectedConnectionId.trim()
        : null
    })(),
  }
  const nextNodesCandidate = Array.isArray(nodes) ? nodes : (existing?.nodes || [])
  const hasNodes = nextNodesCandidate.length > 0
  let nextRootId
  if (rootId != null) {
    nextRootId = rootId
  } else if (!hasNodes) {
    nextRootId = null
  } else if (existing?.rootId != null && nextNodesCandidate.some(n => n?.id === existing.rootId)) {
    nextRootId = existing.rootId
  } else {
    nextRootId = nextNodesCandidate[0]?.id ?? null
  }
  // Enforce single-parent invariant before persisting (skip in debug mode)
  const dbg = !!defaults?.debug
  const nextNodes = dbg ? nextNodesCandidate : enforceUniqueParents(nextNodesCandidate, nextRootId)
  const presetId = (typeof settings?.presetId === 'string')
    ? settings.presetId
    : (typeof existing?.presetId === 'string' ? existing.presetId : (basePreset?.id || null))
  const updated = {
    ...(existing || { id }),
    id,
    nodes: nextNodes,
    rootId: nextRootId,
    settings: baseSettings,
    presetId,
    title: computeTitleFromNodes(nextNodes, nextRootId),
    updatedAt: Date.now(),
  }
  await storePut(updated)
  return updated
}

export async function deleteChat(id) {
  if (!id) return
  await storeDelete(id)
  const selected = loadAll().selectedId
  if (selected === id) setSelected(null)
}

export async function renameChat(id, title) {
  if (!id) return null
  const chat = await storeGetOne(id)
  if (!chat) return null
  const nextTitle = (typeof title === 'string' && title.trim()) ? title.trim() : 'New Chat'
  const updated = {
    ...chat,
    title: nextTitle,
    updatedAt: Date.now(),
  }
  await storePut(updated)
  return updated
}

export async function createChat(initial = {}) {
  const id = `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
  const defaults = loadSettings()
  const preferredPreset = resolvePreset(defaults, { presetId: initial?.presetId, preset: initial?.preset })
  const systemPrompt = typeof preferredPreset?.systemPrompt === 'string'
    ? preferredPreset.systemPrompt
    : DEFAULT_SYSTEM_PROMPT
  const systemVariant = { id: 1, role: 'system', content: systemPrompt, time: Date.now(), typing: false, error: undefined, next: null }
  let baseNodes = []
  let rootId = 1
  if (Array.isArray(initial?.nodes)) {
    baseNodes = initial.nodes.slice()
    rootId = initial?.rootId || (baseNodes[0]?.id || 1)
  } else if (Array.isArray(initial?.messages)) {
    // Legacy: create one node per message with single variant, linear chain
    const now = Date.now()
    const cleaned = initial.messages.map((m, i) => ({ id: m.id || (i + 1), role: m.role, content: m.content, time: m.time || now, typing: !!m.typing, error: m.error }))
    const idMap = new Map(cleaned.map((m, i) => [m.id, i + 1]))
    baseNodes = cleaned.map((m, i) => ({ id: i + 1, variants: [{ id: m.id, role: m.role, content: m.content, time: m.time || now, typing: !!m.typing, error: m.error, next: (i < cleaned.length - 1 ? (i + 2) : null) }], active: 0 }))
    rootId = 1
  } else {
    baseNodes = [{ id: 1, variants: [systemVariant], active: 0 }]
    rootId = 1
  }
  const fallbackConnectionId = (() => {
    if (typeof preferredPreset?.connectionId === 'string' && preferredPreset.connectionId.trim()) return preferredPreset.connectionId.trim()
    if (typeof defaults?.selectedConnectionId === 'string' && defaults.selectedConnectionId.trim()) return defaults.selectedConnectionId.trim()
    return null
  })()
  const chat = {
    id,
    title: computeTitleFromNodes(baseNodes, rootId),
    updatedAt: Date.now(),
    settings: {
      model: initial?.settings?.model || initial?.model || preferredPreset.model || 'gpt-5',
      streaming: (typeof initial?.settings?.streaming === 'boolean')
        ? initial.settings.streaming
        : (typeof preferredPreset.streaming === 'boolean' ? preferredPreset.streaming : true),
      maxOutputTokens: toIntOrNull(hasOwn(initial?.settings, 'maxOutputTokens') ? initial.settings.maxOutputTokens : preferredPreset.maxOutputTokens),
      topP: toClampedNumber(hasOwn(initial?.settings, 'topP') ? initial.settings.topP : preferredPreset.topP, 0, 1),
      temperature: toClampedNumber(hasOwn(initial?.settings, 'temperature') ? initial.settings.temperature : preferredPreset.temperature, 0, 2),
      reasoningEffort: normalizeReasoning(hasOwn(initial?.settings, 'reasoningEffort') ? initial.settings.reasoningEffort : preferredPreset.reasoningEffort),
      textVerbosity: normalizeVerbosity(hasOwn(initial?.settings, 'textVerbosity') ? initial.settings.textVerbosity : preferredPreset.textVerbosity),
      reasoningSummary: normalizeReasoningSummary(hasOwn(initial?.settings, 'reasoningSummary') ? initial.settings.reasoningSummary : preferredPreset.reasoningSummary),
      thinkingEnabled: (() => {
        if (hasOwn(initial?.settings, 'thinkingEnabled')) {
          return !!initial.settings.thinkingEnabled
        }
        return !!preferredPreset.thinkingEnabled
      })(),
      thinkingBudgetTokens: toIntOrNull(hasOwn(initial?.settings, 'thinkingBudgetTokens') ? initial.settings.thinkingBudgetTokens : preferredPreset.thinkingBudgetTokens),
      connectionId: (() => {
        if (hasOwn(initial?.settings, 'connectionId')) {
          const raw = initial.settings.connectionId
          return (typeof raw === 'string' && raw.trim()) ? raw.trim() : fallbackConnectionId
        }
        if (typeof preferredPreset?.connectionId === 'string' && preferredPreset.connectionId.trim()) {
          return preferredPreset.connectionId.trim()
        }
        return fallbackConnectionId
      })(),
    },
    nodes: baseNodes,
    rootId,
    presetId: (typeof initial?.presetId === 'string') ? initial.presetId : (preferredPreset?.id || null),
  }
  await storePut(chat)
  setSelected(id)
  return { id, chat }
}
