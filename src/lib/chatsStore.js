// LocalStorage-backed multi-chat store
// Shape:
// {
//   chats: Array<{ id: string, title: string, updatedAt: number, settings: { model: string, streaming: boolean }, messages: any[] }>,
//   selectedId: string | null
// }

export const CHATS_KEY = 'openai.chats.v1'
import { loadSettings } from './settingsStore.js'

function safeParse(raw, fallback) {
  try { return JSON.parse(raw) } catch { return fallback }
}

export function loadAll() {
  const fallback = { chats: [], selectedId: null }
  try {
    const raw = localStorage.getItem(CHATS_KEY)
    if (!raw) return fallback
    const data = safeParse(raw, fallback)
    if (!data || !Array.isArray(data.chats)) return fallback
    return { chats: data.chats, selectedId: data.selectedId || null }
  } catch {
    return fallback
  }
}

export function saveAll(data) {
  const out = {
    chats: Array.isArray(data?.chats) ? data.chats : [],
    selectedId: data?.selectedId || null,
  }
  localStorage.setItem(CHATS_KEY, JSON.stringify(out))
  return out
}

export function getChats() {
  return loadAll().chats || []
}

export function getChat(id) {
  if (!id) return null
  const all = loadAll()
  return all.chats.find(c => c.id === id) || null
}

export function setSelected(id) {
  const all = loadAll()
  const exists = all.chats.some(c => c.id === id)
  const next = { ...all, selectedId: exists ? id : (all.selectedId || null) }
  return saveAll(next)
}

export function computeTitle(messages) {
  try {
    const firstUser = (messages || []).find(m => m?.role === 'user' && typeof m?.content === 'string' && m.content.trim())
    const base = firstUser?.content?.trim() || 'New Chat'
    return base.length > 40 ? (base.slice(0, 40) + '…') : base
  } catch {
    return 'New Chat'
  }
}

export function upsertChat(chat) {
  const all = loadAll()
  const idx = all.chats.findIndex(c => c.id === chat.id)
  if (idx >= 0) {
    const copy = all.chats.slice()
    copy[idx] = chat
    return saveAll({ ...all, chats: copy })
  }
  return saveAll({ ...all, chats: [...all.chats, chat] })
}

export function saveChatContent(id, { messages, settings }) {
  const all = loadAll()
  const idx = all.chats.findIndex(c => c.id === id)
  if (idx < 0) return null
  const cur = all.chats[idx]
  const updated = {
    ...cur,
    messages: Array.isArray(messages) ? messages : (cur.messages || []),
    settings: {
      model: (settings?.model || cur?.settings?.model || 'gpt-4o-mini'),
      streaming: (typeof settings?.streaming === 'boolean'
        ? settings.streaming
        : (typeof cur?.settings?.streaming === 'boolean' ? cur.settings.streaming : true))
    },
    title: computeTitle(Array.isArray(messages) ? messages : cur.messages),
    updatedAt: Date.now(),
  }
  const next = all.chats.slice()
  next[idx] = updated
  saveAll({ ...all, chats: next })
  return updated
}

export function createChat(initial = {}) {
  const id = `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
  const messages = Array.isArray(initial.messages) ? initial.messages : [
    { id: 1, role: 'system', content: 'You are a helpful assistant.', time: Date.now() }
  ]
  const defaults = loadSettings()
  const chat = {
    id,
    title: computeTitle(messages),
    updatedAt: Date.now(),
    settings: {
      model: initial?.settings?.model || initial?.model || (defaults?.defaultChat?.model) || 'gpt-4o-mini',
      streaming: (typeof initial?.settings?.streaming === 'boolean')
        ? initial.settings.streaming
        : (typeof defaults?.defaultChat?.streaming === 'boolean' ? defaults.defaultChat.streaming : true)
    },
    messages,
  }
  const all = loadAll()
  const next = saveAll({ chats: [...all.chats, chat], selectedId: id })
  return { id, chat, all: next }
}
