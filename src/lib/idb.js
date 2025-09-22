// Lightweight persistence helper for chats
// Primary: IndexedDB (object store 'chats' keyed by chat.id)
// Fallback: localStorage when IDB is unavailable (Safari Private, file://, embedded, etc.)

const DB_NAME = 'catsgirls.chats'
const DB_VERSION = 1
const STORE = 'chats'
const LS_KEY = 'catsgirls.chats.store.v1'

let useLocal = false

function openDatabase() {
  return new Promise((resolve, reject) => {
    try {
      if (typeof indexedDB === 'undefined') {
        useLocal = true
        console.warn('[idb] indexedDB is undefined; using localStorage fallback')
        reject(new Error('indexedDB unavailable'))
        return
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' })
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => {
        useLocal = true
        console.warn('[idb] Failed to open DB; falling back to localStorage:', req.error)
        reject(req.error)
      }
    } catch (err) {
      useLocal = true
      console.warn('[idb] Exception while opening DB; falling back to localStorage:', err)
      reject(err)
    }
  })
}

async function withStore(mode, fn) {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode)
    const store = tx.objectStore(STORE)
    let done = false
    function finish(val) { if (!done) { done = true; resolve(val) } }
    function fail(err) { if (!done) { done = true; reject(err) } }
    tx.oncomplete = () => finish(undefined)
    tx.onerror = () => fail(tx.error)
    try {
      const ret = fn(store, tx)
      // If fn returns a promise, resolve on its completion and then let tx complete
      if (ret && typeof ret.then === 'function') {
        ret.then((val) => finish(val)).catch(fail)
      } else {
        // Wait for tx.oncomplete to resolve unless function resolved synchronously
      }
    } catch (err) {
      fail(err)
    }
  })
}

function lsReadAll() {
  try {
    const raw = localStorage.getItem(LS_KEY)
    const data = raw ? JSON.parse(raw) : { byId: {} }
    const byId = (data && typeof data === 'object' && data.byId && typeof data.byId === 'object') ? data.byId : {}
    return Object.values(byId)
  } catch { return [] }
}
function lsReadOne(id) {
  try {
    const raw = localStorage.getItem(LS_KEY)
    const data = raw ? JSON.parse(raw) : { byId: {} }
    return data?.byId?.[id] || null
  } catch { return null }
}
function lsWriteOne(chat) {
  try {
    const raw = localStorage.getItem(LS_KEY)
    const data = raw ? JSON.parse(raw) : { byId: {} }
    const byId = (data && typeof data === 'object' && data.byId && typeof data.byId === 'object') ? data.byId : {}
    byId[chat.id] = chat
    localStorage.setItem(LS_KEY, JSON.stringify({ byId }))
    return chat
  } catch (err) {
    console.warn('[idb] localStorage write failed:', err)
    return chat
  }
}
function lsDeleteOne(id) {
  try {
    const raw = localStorage.getItem(LS_KEY)
    const data = raw ? JSON.parse(raw) : { byId: {} }
    if (data?.byId && typeof data.byId === 'object') {
      delete data.byId[id]
      localStorage.setItem(LS_KEY, JSON.stringify({ byId: data.byId }))
    }
  } catch (err) {
    console.warn('[idb] localStorage delete failed:', err)
  }
}

export async function getAllChats() {
  if (useLocal) return lsReadAll()
  try {
    const db = await openDatabase()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const store = tx.objectStore(STORE)
      const req = store.getAll()
      req.onsuccess = () => resolve(req.result || [])
      req.onerror = () => {
        useLocal = true
        console.warn('[idb] getAll failed; using localStorage fallback:', req.error)
        resolve(lsReadAll())
      }
    })
  } catch {
    return lsReadAll()
  }
}

export async function getChat(id) {
  if (!id) return null
  if (useLocal) return lsReadOne(id)
  try {
    const db = await openDatabase()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const store = tx.objectStore(STORE)
      const req = store.get(id)
      req.onsuccess = () => resolve(req.result || null)
      req.onerror = () => {
        useLocal = true
        console.warn('[idb] get failed; using localStorage fallback:', req.error)
        resolve(lsReadOne(id))
      }
    })
  } catch {
    return lsReadOne(id)
  }
}

export async function putChat(chat) {
  if (!chat || !chat.id) throw new Error('Invalid chat')
  if (useLocal) return lsWriteOne(chat)
  try {
    const db = await openDatabase()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      const store = tx.objectStore(STORE)
      const req = store.put(chat)
      // Ensure we only resolve after the transaction completes
      tx.oncomplete = () => resolve(chat)
      tx.onerror = () => {
        useLocal = true
        console.warn('[idb] put failed; writing to localStorage:', tx.error)
        resolve(lsWriteOne(chat))
      }
      req.onerror = () => {
        // Also handle request-level error for completeness
        useLocal = true
        console.warn('[idb] put request failed; writing to localStorage:', req.error)
        resolve(lsWriteOne(chat))
      }
    })
  } catch (err) {
    console.warn('[idb] Exception in put; writing to localStorage:', err)
    return lsWriteOne(chat)
  }
}

export async function deleteChat(id) {
  if (!id) return
  if (useLocal) return lsDeleteOne(id)
  try {
    const db = await openDatabase()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      const store = tx.objectStore(STORE)
      const req = store.delete(id)
      tx.oncomplete = () => resolve(undefined)
      tx.onerror = () => {
        useLocal = true
        console.warn('[idb] delete failed; applying localStorage fallback:', tx.error)
        resolve(lsDeleteOne(id))
      }
      req.onerror = () => {
        useLocal = true
        console.warn('[idb] delete request failed; applying localStorage fallback:', req.error)
        resolve(lsDeleteOne(id))
      }
    })
  } catch (err) {
    console.warn('[idb] Exception in delete; applying localStorage fallback:', err)
    return lsDeleteOne(id)
  }
}
