// Storage abstraction layer with IndexedDB backend (localStorage fallback)
import * as idbStorage from './storage.indexeddb.js'
import * as lsStorage from './storage.localStorage.js'

const BACKEND_KEY = 'storage.backend.v1'

let activeBackend = null
let backendInitialized = false

/**
 * Get the preferred storage backend
 */
function getStorageBackend() {
  if (backendInitialized && activeBackend) {
    return activeBackend
  }

  // Try IndexedDB first
  if (idbStorage.isIndexedDBAvailable()) {
    activeBackend = idbStorage
    try {
      localStorage.setItem(BACKEND_KEY, 'indexeddb')
    } catch {
      // Ignore localStorage errors
    }
  } else {
    // Fallback to localStorage
    console.warn('IndexedDB not available, falling back to localStorage')
    activeBackend = lsStorage
    try {
      localStorage.setItem(BACKEND_KEY, 'localstorage')
    } catch {
      // Ignore localStorage errors
    }
  }

  backendInitialized = true
  return activeBackend
}

/**
 * Get all chats
 */
export async function getAllChats() {
  const backend = getStorageBackend()
  return backend.getAllChats()
}

/**
 * Get a single chat by ID
 */
export async function getChat(id) {
  const backend = getStorageBackend()
  return backend.getChat(id)
}

/**
 * Save a chat
 */
export async function putChat(chat) {
  const backend = getStorageBackend()
  return backend.putChat(chat)
}

/**
 * Delete a chat
 */
export async function deleteChat(id, expectedVersion) {
  const backend = getStorageBackend()
  return backend.deleteChat(id, expectedVersion)
}

/**
 * Subscribe to storage changes
 */
export function subscribeChatStorage(listener) {
  const backend = getStorageBackend()
  return backend.subscribeChatStorage(listener)
}

/**
 * Get the current backend name (for debugging)
 */
export function getBackendName() {
  const backend = getStorageBackend()
  return backend === idbStorage ? 'indexeddb' : 'localstorage'
}
