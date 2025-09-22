// LocalStorage-backed persistence helper for chats
// Single key storing a map of chats by id

const LS_KEY = 'catsgirls.chats.store.v1'

function readAll() {
  try {
    const raw = localStorage.getItem(LS_KEY)
    const data = raw ? JSON.parse(raw) : { byId: {} }
    const byId = (data && typeof data === 'object' && data.byId && typeof data.byId === 'object') ? data.byId : {}
    return Object.values(byId)
  } catch { return [] }
}

function readOne(id) {
  try {
    const raw = localStorage.getItem(LS_KEY)
    const data = raw ? JSON.parse(raw) : { byId: {} }
    return data?.byId?.[id] || null
  } catch { return null }
}

function writeOne(chat) {
  try {
    const raw = localStorage.getItem(LS_KEY)
    const data = raw ? JSON.parse(raw) : { byId: {} }
    const byId = (data && typeof data === 'object' && data.byId && typeof data.byId === 'object') ? data.byId : {}
    byId[chat.id] = chat
    localStorage.setItem(LS_KEY, JSON.stringify({ byId }))
    return chat
  } catch { return chat }
}

function deleteOne(id) {
  try {
    const raw = localStorage.getItem(LS_KEY)
    const data = raw ? JSON.parse(raw) : { byId: {} }
    if (data?.byId && typeof data.byId === 'object') {
      delete data.byId[id]
      localStorage.setItem(LS_KEY, JSON.stringify({ byId: data.byId }))
    }
  } catch {}
}

export async function getAllChats() {
  return readAll()
}

export async function getChat(id) {
  if (!id) return null
  return readOne(id)
}

export async function putChat(chat) {
  if (!chat || !chat.id) throw new Error('Invalid chat')
  return writeOne(chat)
}

export async function deleteChat(id) {
  if (!id) return
  deleteOne(id)
}
