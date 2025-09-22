// Lightweight persistence helper for chats
// Primary: IndexedDB (object store 'chats' keyed by chat.id)
// Fallback: localStorage when IDB is unavailable (Safari Private, file://, embedded, etc.)

const DB_NAME = 'catsgirls.chats'
const DB_VERSION = 1
const STORE = 'chats'
const LS_KEY = 'catsgirls.chats.store.v1'

let useLocal = false

function mergeByNewest(idbItems, lsItems) {
  try {
    const map = new Map()
    for (const it of Array.isArray(idbItems) ? idbItems : []) {
      if (!it?.id) continue
      map.set(it.id, it)
    }
    for (const it of Array.isArray(lsItems) ? lsItems : []) {
      if (!it?.id) continue
      const cur = map.get(it.id)
      if (!cur) { map.set(it.id, it); continue }
      const a = Number(cur?.updatedAt) || 0
      const b = Number(it?.updatedAt) || 0
      if (b > a) map.set(it.id, it)
    }
    return [...map.values()]
  } catch {
    return Array.isArray(idbItems) && idbItems.length ? idbItems : (lsItems || [])
  }
}

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
  // Strategy: attempt IDB read and also read LS; merge by newest updatedAt
  let ls = []
  try { ls = lsReadAll() } catch {}
  if (useLocal) return ls
  try {
    const db = await openDatabase()
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE, 'readonly')
        const store = tx.objectStore(STORE)
        const req = store.getAll()
        req.onsuccess = () => {
          const idb = req.result || []
          resolve(mergeByNewest(idb, ls))
        }
        req.onerror = () => {
          useLocal = true
          console.warn('[idb] getAll failed; using localStorage only:', req.error)
          resolve(ls)
        }
      } catch (err) {
        useLocal = true
        console.warn('[idb] getAll exception; using localStorage only:', err)
        resolve(ls)
      }
    })
  } catch {
    return ls
  }
}

export async function getChat(id) {
  if (!id) return null
  const fromLs = lsReadOne(id)
  if (useLocal) return fromLs
  try {
    const db = await openDatabase()
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE, 'readonly')
        const store = tx.objectStore(STORE)
        const req = store.get(id)
        req.onsuccess = () => {
          const a = req.result || null
          // Prefer the newer record if both exist
          if (!a) return resolve(fromLs)
          try {
            const at = Number(a?.updatedAt) || 0
            const bt = Number(fromLs?.updatedAt) || 0
            resolve(bt > at ? fromLs : a)
          } catch { resolve(a) }
        }
        req.onerror = () => {
          useLocal = true
          console.warn('[idb] get failed; using localStorage fallback:', req.error)
          resolve(fromLs)
        }
      } catch (err) {
        useLocal = true
        console.warn('[idb] get exception; using localStorage fallback:', err)
        resolve(fromLs)
      }
    })
  } catch {
    return fromLs
  }
}

export async function putChat(chat) {
  if (!chat || !chat.id) throw new Error('Invalid chat')
  // Always mirror to LS for robustness, even if IDB succeeds
  let mirrored
  try { mirrored = lsWriteOne(chat) } catch {}
  if (useLocal) return mirrored || chat
  try {
    const db = await openDatabase()
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE, 'readwrite')
        const store = tx.objectStore(STORE)
        const req = store.put(chat)
        tx.oncomplete = () => resolve(chat)
        tx.onerror = () => {
          useLocal = true
          console.warn('[idb] put failed; relying on localStorage copy:', tx.error)
          resolve(mirrored || lsWriteOne(chat) || chat)
        }
        req.onerror = () => {
          useLocal = true
          console.warn('[idb] put request failed; relying on localStorage copy:', req.error)
          resolve(mirrored || lsWriteOne(chat) || chat)
        }
      } catch (err) {
        useLocal = true
        console.warn('[idb] put exception; relying on localStorage copy:', err)
        resolve(mirrored || lsWriteOne(chat) || chat)
      }
    })
  } catch (err) {
    console.warn('[idb] Exception in put; relying on localStorage copy:', err)
    return mirrored || lsWriteOne(chat) || chat
  }
}

export async function deleteChat(id) {
  if (!id) return
  try { lsDeleteOne(id) } catch {}
  if (useLocal) return
  try {
    const db = await openDatabase()
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE, 'readwrite')
        const store = tx.objectStore(STORE)
        const req = store.delete(id)
        tx.oncomplete = () => resolve(undefined)
        tx.onerror = () => {
          useLocal = true
          console.warn('[idb] delete failed; relying on localStorage delete:', tx.error)
          resolve(undefined)
        }
        req.onerror = () => {
          useLocal = true
          console.warn('[idb] delete request failed; relying on localStorage delete:', req.error)
          resolve(undefined)
        }
      } catch (err) {
        useLocal = true
        console.warn('[idb] delete exception; relying on localStorage delete:', err)
        resolve(undefined)
      }
    })
  } catch (err) {
    console.warn('[idb] Exception in delete; relying on localStorage delete:', err)
    return
  }
}
