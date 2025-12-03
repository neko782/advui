// Storage abstraction layer with IndexedDB backend (localStorage fallback)
import * as idbStorage from './storage.indexeddb.js';
import * as lsStorage from './storage.localStorage.js';
import type { Chat, StorageListener, StorageBackend } from './types/index.js';

const BACKEND_KEY = 'storage.backend.v1';

let activeBackend: StorageBackend | null = null;
let backendInitialized = false;

/**
 * Get the preferred storage backend
 */
function getStorageBackend(): StorageBackend {
  if (backendInitialized && activeBackend) {
    return activeBackend;
  }

  // Try IndexedDB first
  if (idbStorage.isIndexedDBAvailable()) {
    activeBackend = idbStorage;
    try {
      localStorage.setItem(BACKEND_KEY, 'indexeddb');
    } catch {
      // Ignore localStorage errors
    }
  } else {
    // Fallback to localStorage
    console.warn('IndexedDB not available, falling back to localStorage');
    activeBackend = lsStorage;
    try {
      localStorage.setItem(BACKEND_KEY, 'localstorage');
    } catch {
      // Ignore localStorage errors
    }
  }

  backendInitialized = true;
  return activeBackend;
}

/**
 * Get all chats
 */
export async function getAllChats(): Promise<Chat[]> {
  const backend = getStorageBackend();
  return backend.getAllChats();
}

/**
 * Get a single chat by ID
 */
export async function getChat(id: string): Promise<Chat | null> {
  const backend = getStorageBackend();
  return backend.getChat(id);
}

/**
 * Save a chat
 */
export async function putChat(chat: Chat): Promise<Chat> {
  const backend = getStorageBackend();
  return backend.putChat(chat);
}

/**
 * Delete a chat
 */
export async function deleteChat(id: string, expectedVersion?: number): Promise<Chat | null> {
  const backend = getStorageBackend();
  return backend.deleteChat(id, expectedVersion);
}

/**
 * Subscribe to storage changes
 */
export function subscribeChatStorage(listener: StorageListener): () => void {
  const backend = getStorageBackend();
  return backend.subscribeChatStorage(listener);
}

/**
 * Get the current backend name (for debugging)
 */
export function getBackendName(): 'indexeddb' | 'localstorage' {
  const backend = getStorageBackend();
  return backend === idbStorage ? 'indexeddb' : 'localstorage';
}

