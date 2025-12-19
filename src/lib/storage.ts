// Storage abstraction layer with IndexedDB backend (localStorage fallback)
import * as idbStorage from './storage.indexeddb.js';
import * as lsStorage from './storage.localStorage.js';
import { createKeyedPersistenceQueue } from './utils/persistenceQueue.js';
import type { Chat, StorageListener, StorageBackend } from './types/index.js';

const BACKEND_KEY = 'storage.backend.v1';
const CHAT_STORE_QUEUE_KEY = 'chats.v1';

let activeBackend: StorageBackend | null = null;
let backendInitialized = false;

const chatStoreQueue = createKeyedPersistenceQueue();

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
  return chatStoreQueue.run(CHAT_STORE_QUEUE_KEY, async () => {
    const backend = getStorageBackend();
    return backend.getAllChats();
  });
}

/**
 * Get a single chat by ID
 */
export async function getChat(id: string): Promise<Chat | null> {
  return chatStoreQueue.run(CHAT_STORE_QUEUE_KEY, async () => {
    const backend = getStorageBackend();
    return backend.getChat(id);
  });
}

/**
 * Save a chat
 */
export async function putChat(chat: Chat): Promise<Chat> {
  return chatStoreQueue.run(CHAT_STORE_QUEUE_KEY, async () => {
    const backend = getStorageBackend();
    return backend.putChat(chat);
  });
}

/**
 * Delete a chat
 */
export async function deleteChat(id: string, expectedVersion?: number): Promise<Chat | null> {
  return chatStoreQueue.run(CHAT_STORE_QUEUE_KEY, async () => {
    const backend = getStorageBackend();
    return backend.deleteChat(id, expectedVersion);
  });
}

function isConcurrencyConflict(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err || '');
  return message.toLowerCase().includes('concurrent') && message.toLowerCase().includes('conflict');
}

export type ChatUpdater = (current: Chat | null) => Chat | null | undefined | Promise<Chat | null | undefined>;

export interface AtomicChatOptions {
  retries?: number;
}

/**
 * Atomic read-modify-write update for a chat.
 * - Serializes *all* chat persistence ops via a queue.
 * - Automatically sets `_expectedVersion` from the latest stored value.
 * - Retries on optimistic concurrency conflicts (cross-tab).
 */
export async function updateChatAtomic(
  id: string,
  updater: ChatUpdater,
  { retries = 2 }: AtomicChatOptions = {}
): Promise<Chat | null> {
  if (!id) return null;
  if (typeof updater !== 'function') throw new Error('updateChatAtomic: updater must be a function');

  return chatStoreQueue.run(CHAT_STORE_QUEUE_KEY, async () => {
    const backend = getStorageBackend();
    let lastErr: unknown = null;

    for (let attempt = 0; attempt <= Math.max(0, retries); attempt += 1) {
      try {
        const current = await backend.getChat(id);
        const next = await updater(current);

        if (next === undefined) {
          return current;
        }
        if (next == null) {
          if (!current) return null;
          return await backend.deleteChat(id, current?._version);
        }

        const toPersist: Chat = {
          ...next,
          id,
          _expectedVersion: current?._version,
        };

        return await backend.putChat(toPersist);
      } catch (err) {
        lastErr = err;
        if (attempt < Math.max(0, retries) && isConcurrencyConflict(err)) continue;
        throw err;
      }
    }

    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr || 'Unknown updateChatAtomic error'));
  });
}

/**
 * Atomic "put" that always targets the latest stored version (no stale `_expectedVersion`).
 */
export async function putChatAtomic(
  chat: Chat,
  { retries = 2 }: AtomicChatOptions = {}
): Promise<Chat> {
  const id = chat?.id;
  if (!id) throw new Error('putChatAtomic: chat.id is required');

  return chatStoreQueue.run(CHAT_STORE_QUEUE_KEY, async () => {
    const backend = getStorageBackend();
    let lastErr: unknown = null;

    for (let attempt = 0; attempt <= Math.max(0, retries); attempt += 1) {
      try {
        const current = await backend.getChat(id);
        const toPersist: Chat = {
          ...chat,
          id,
          _expectedVersion: current?._version,
        };
        return await backend.putChat(toPersist);
      } catch (err) {
        lastErr = err;
        if (attempt < Math.max(0, retries) && isConcurrencyConflict(err)) continue;
        throw err;
      }
    }

    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr || 'Unknown putChatAtomic error'));
  });
}

/**
 * Atomic delete that uses the latest stored version and retries conflicts.
 */
export async function deleteChatAtomic(
  id: string,
  { retries = 2 }: AtomicChatOptions = {}
): Promise<Chat | null> {
  if (!id) return null;

  return chatStoreQueue.run(CHAT_STORE_QUEUE_KEY, async () => {
    const backend = getStorageBackend();
    let lastErr: unknown = null;

    for (let attempt = 0; attempt <= Math.max(0, retries); attempt += 1) {
      try {
        const current = await backend.getChat(id);
        if (!current) return null;
        return await backend.deleteChat(id, current?._version);
      } catch (err) {
        lastErr = err;
        if (attempt < Math.max(0, retries) && isConcurrencyConflict(err)) continue;
        throw err;
      }
    }

    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr || 'Unknown deleteChatAtomic error'));
  });
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
