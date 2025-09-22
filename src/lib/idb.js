// Lightweight IndexedDB helper for chats
// One object store: 'chats' keyed by chat.id

const DB_NAME = 'catsgirls.chats'
const DB_VERSION = 1
const STORE = 'chats'

function openDatabase() {
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' })
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    } catch (err) {
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

export async function getAllChats() {
  try {
    const db = await openDatabase()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const store = tx.objectStore(STORE)
      const req = store.getAll()
      req.onsuccess = () => resolve(req.result || [])
      req.onerror = () => reject(req.error)
    })
  } catch { return [] }
}

export async function getChat(id) {
  if (!id) return null
  try {
    const db = await openDatabase()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const store = tx.objectStore(STORE)
      const req = store.get(id)
      req.onsuccess = () => resolve(req.result || null)
      req.onerror = () => reject(req.error)
    })
  } catch { return null }
}

export async function putChat(chat) {
  if (!chat || !chat.id) throw new Error('Invalid chat')
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    const req = store.put(chat)
    req.onsuccess = () => resolve(chat)
    req.onerror = () => reject(req.error)
  })
}

export async function deleteChat(id) {
  if (!id) return
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    const req = store.delete(id)
    req.onsuccess = () => resolve(undefined)
    req.onerror = () => reject(req.error)
  })
}

