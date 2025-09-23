// Chat store persisted in localStorage. One entry per chat.
// We keep selectedId in localStorage for quick access.

import { loadSettings } from './settingsStore.js'
import { enforceUniqueParents } from './branching.js'
import { getAllChats as storeGetAll, getChat as storeGetOne, putChat as storePut } from './idb.js'

export const SELECTED_KEY = 'openai.chats.selected.v1'

function safeParse(raw, fallback) { try { return JSON.parse(raw) } catch { return fallback } }

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
  const baseSettings = {
    model: (settings?.model || existing?.settings?.model || defaults?.defaultChat?.model || 'gpt-4o-mini'),
    streaming: (typeof settings?.streaming === 'boolean')
      ? settings.streaming
      : (typeof existing?.settings?.streaming === 'boolean'
        ? existing.settings.streaming
        : (typeof defaults?.defaultChat?.streaming === 'boolean' ? defaults.defaultChat.streaming : true))
  }
  const nextNodesCandidate = Array.isArray(nodes) ? nodes : (existing?.nodes || [])
  const nextRootId = (rootId != null)
    ? rootId
    : (existing?.rootId != null ? existing.rootId : (nextNodesCandidate[0]?.id || 1))
  // Enforce single-parent invariant before persisting
  const nextNodes = enforceUniqueParents(nextNodesCandidate, nextRootId)
  const updated = {
    ...(existing || { id }),
    id,
    nodes: nextNodes,
    rootId: nextRootId,
    settings: baseSettings,
    title: computeTitleFromNodes(nextNodes, nextRootId),
    updatedAt: Date.now(),
  }
  await storePut(updated)
  return updated
}

export async function createChat(initial = {}) {
  const id = `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
  const systemVariant = { id: 1, role: 'system', content: 'You are a helpful assistant.', time: Date.now(), typing: false, error: undefined, next: null }
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
  const defaults = loadSettings()
  const chat = {
    id,
    title: computeTitleFromNodes(baseNodes, rootId),
    updatedAt: Date.now(),
    settings: {
      model: initial?.settings?.model || initial?.model || (defaults?.defaultChat?.model) || 'gpt-4o-mini',
      streaming: (typeof initial?.settings?.streaming === 'boolean')
        ? initial.settings.streaming
        : (typeof defaults?.defaultChat?.streaming === 'boolean' ? defaults.defaultChat.streaming : true)
    },
    nodes: baseNodes,
    rootId,
  }
  await storePut(chat)
  setSelected(id)
  return { id, chat }
}
