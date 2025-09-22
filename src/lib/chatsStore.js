// Chat store persisted in localStorage. One entry per chat.
// We keep selectedId in localStorage for quick access.

import { loadSettings } from './settingsStore.js'
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

export function computeTitle(messages) {
  try {
    const firstUser = (messages || []).find(m => m?.role === 'user' && typeof m?.content === 'string' && m.content.trim())
    const base = firstUser?.content?.trim() || 'New Chat'
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

export async function saveChatContent(id, { messages, settings, rootId, selected }) {
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
  const nextMessages = Array.isArray(messages) ? messages : (existing?.messages || [])
  const nextRootId = (rootId != null)
    ? rootId
    : (existing?.rootId != null ? existing.rootId : (nextMessages[0]?.id || 1))
  const nextSelected = (selected != null)
    ? selected
    : (existing?.selected || {})
  const updated = {
    ...(existing || { id }),
    id,
    messages: nextMessages,
    rootId: nextRootId,
    selected: nextSelected,
    settings: baseSettings,
    title: computeTitle(nextMessages),
    updatedAt: Date.now(),
  }
  await storePut(updated)
  return updated
}

export async function createChat(initial = {}) {
  const id = `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
  const system = { id: 1, role: 'system', content: 'You are a helpful assistant.', time: Date.now(), next: [] }
  let baseMessages = Array.isArray(initial.messages) ? initial.messages : [system]
  // Normalize messages to graph form
  let rootId = baseMessages[0]?.id || 1
  // If messages already have next/rootId provided, keep; else migrate.
  if (!initial.rootId || !baseMessages.every(m => Array.isArray(m.next))) {
    const mig = migrateMessagesToGraph(baseMessages)
    baseMessages = mig.messages
    rootId = mig.rootId
  }
  const defaults = loadSettings()
  const chat = {
    id,
    title: computeTitle(baseMessages),
    updatedAt: Date.now(),
    settings: {
      model: initial?.settings?.model || initial?.model || (defaults?.defaultChat?.model) || 'gpt-4o-mini',
      streaming: (typeof initial?.settings?.streaming === 'boolean')
        ? initial.settings.streaming
        : (typeof defaults?.defaultChat?.streaming === 'boolean' ? defaults.defaultChat.streaming : true)
    },
    messages: baseMessages,
    rootId,
    selected: {},
  }
  await storePut(chat)
  setSelected(id)
  return { id, chat }
}
