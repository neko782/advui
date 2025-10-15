// Chat store persisted in localStorage. One entry per chat.
// We keep selectedId in localStorage for quick access.

import { loadSettings } from './settingsStore.js'
import { enforceUniqueParents } from './branching.js'
import { getAllChats as storeGetAll, getChat as storeGetOne, putChat as storePut, deleteChat as storeDelete } from './storage.js'
import { toIntOrNull, toClampedNumber } from './utils/numbers.js'
import { safeRead, safeWrite } from './utils/localStorageHelper.js'
import { resolvePreset, DEFAULT_SYSTEM_PROMPT, computeConnectionId } from './utils/presetHelpers.js'
import { normalizeReasoning, normalizeVerbosity, normalizeReasoningSummary } from './utils/validation.js'

export const SELECTED_KEY = 'openai.chats.selected.v1'

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key)

export function loadAll() {
  // Back-compat shim for existing callers that expect { selectedId }
  const selection = safeRead(SELECTED_KEY, { selectedId: null }, (value) => {
    if (value && typeof value === 'object' && 'selectedId' in value) return value
    return { selectedId: null }
  })
  return { chats: [], selectedId: selection?.selectedId ?? null }
}

export function setSelected(id) {
  const val = { selectedId: id || null }
  const ok = safeWrite(SELECTED_KEY, val)
  if (!ok) {
    console.error('Failed to persist selected chat id.')
  }
  return val
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
  try {
    const persisted = await storePut(chat)
    return persisted || chat
  } catch (err) {
    console.error('Failed to upsert chat:', err)
    return chat
  }
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
  const rawConnectionOverride = pickSetting('connectionId')
  const candidatePreset = {
    ...basePreset,
    connectionId: (() => {
      if (typeof rawConnectionOverride === 'string' && rawConnectionOverride.trim()) return rawConnectionOverride.trim()
      return basePreset?.connectionId || null
    })(),
  }
  const resolvedConnectionId = computeConnectionId({
    preset: candidatePreset,
    settings: defaults,
  })
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
    connectionId: resolvedConnectionId,
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
  const persisted = await storePut(updated)
  return persisted || updated
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
  const persisted = await storePut(updated)
  return persisted || updated
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
  const connectionOverride = (() => {
    if (hasOwn(initial?.settings, 'connectionId')) return initial.settings.connectionId
    if (hasOwn(initial, 'connectionId')) return initial.connectionId
    return undefined
  })()
  const candidatePreset = {
    ...preferredPreset,
    connectionId: (() => {
      if (typeof connectionOverride === 'string' && connectionOverride.trim()) return connectionOverride.trim()
      return preferredPreset?.connectionId || null
    })(),
  }
  const resolvedConnectionId = computeConnectionId({
    preset: candidatePreset,
    settings: defaults,
  })
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
      connectionId: resolvedConnectionId,
    },
    nodes: baseNodes,
    rootId,
    presetId: (typeof initial?.presetId === 'string') ? initial.presetId : (preferredPreset?.id || null),
  }
  const persisted = await storePut(chat)
  setSelected(id)
  return { id, chat: persisted || chat }
}
