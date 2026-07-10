// Storage abstraction layer with IndexedDB backend (localStorage fallback)
import * as idbStorage from './storage.indexeddb.js';
import * as lsStorage from './storage.localStorage.js';
import { createKeyedPersistenceQueue } from './utils/persistenceQueue.js';
import { isConcurrencyConflict } from './storage.errors.js';
import type { Chat, ChatListItem, StorageListener, StorageBackend } from './types/index.js';

export { ConflictError, isConcurrencyConflict } from './storage.errors.js';

const BACKEND_KEY = 'storage.backend.v1';
const CHAT_STORE_QUEUE_KEY = 'chats.v1';

let activeBackend: StorageBackend | null = null;
let backendInitialized = false;

const chatStoreQueue = createKeyedPersistenceQueue();

function persistBackendChoice(name: 'indexeddb' | 'localstorage'): void {
  try {
    localStorage.setItem(BACKEND_KEY, name);
  } catch {
    // Ignore localStorage errors
  }
}

function fallbackToLocalStorage(err?: unknown): StorageBackend {
  if (activeBackend !== lsStorage) {
    console.warn('IndexedDB operation failed, falling back to localStorage', err);
  }
  activeBackend = lsStorage;
  backendInitialized = true;
  persistBackendChoice('localstorage');
  return activeBackend;
}

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
    persistBackendChoice('indexeddb');
  } else {
    // Fallback to localStorage
    console.warn('IndexedDB not available, falling back to localStorage');
    activeBackend = lsStorage;
    persistBackendChoice('localstorage');
  }

  backendInitialized = true;
  return activeBackend;
}

// Error names that indicate an IndexedDB infrastructure failure (DB open,
// availability, quota, or transaction problems). Only these may trigger a
// permanent fallback to localStorage. Validation errors and optimistic
// concurrency conflicts must NEVER cause a fallback (that would hide all
// IndexedDB-stored chats from the user).
const INFRASTRUCTURE_ERROR_NAMES = new Set([
  'InvalidStateError',
  'UnknownError',
  'QuotaExceededError',
  'TransactionInactiveError',
  'InvalidAccessError',
  'AbortError',
  'NotFoundError',
  'VersionError',
  'ConstraintError',
  'NotAllowedError',
  'SecurityError',
  'TimeoutError',
  'NS_ERROR_DOM_QUOTA_REACHED',
]);

function isInfrastructureError(err: unknown): boolean {
  if (err == null) return false;
  if (isConcurrencyConflict(err)) return false;
  if (typeof DOMException !== 'undefined' && err instanceof DOMException) return true;
  const name = (err as { name?: unknown })?.name;
  if (typeof name === 'string' && INFRASTRUCTURE_ERROR_NAMES.has(name)) return true;
  const message = err instanceof Error ? err.message : String(err);
  // openDB rejections (open failed / blocked) mention IndexedDB explicitly
  return message.toLowerCase().includes('indexeddb');
}

async function runWithBackendFallback<T>(
  run: (backend: StorageBackend) => Promise<T>
): Promise<T> {
  let backend = getStorageBackend();
  try {
    return await run(backend);
  } catch (err) {
    if (backend !== idbStorage || !isInfrastructureError(err)) throw err;
    backend = fallbackToLocalStorage(err);
    return run(backend);
  }
}

/**
 * Get all chats
 */
export async function getAllChats(): Promise<Chat[]> {
  return chatStoreQueue.run(CHAT_STORE_QUEUE_KEY, async () => {
    return runWithBackendFallback((backend) => backend.getAllChats());
  });
}

/**
 * Get lightweight chat list items
 */
export async function getChatListItems(): Promise<ChatListItem[]> {
  return chatStoreQueue.run(CHAT_STORE_QUEUE_KEY, async () => {
    return runWithBackendFallback((backend) => backend.getChatListItems());
  });
}

/**
 * Get a single chat by ID
 */
export async function getChat(id: string): Promise<Chat | null> {
  return chatStoreQueue.run(CHAT_STORE_QUEUE_KEY, async () => {
    return runWithBackendFallback((backend) => backend.getChat(id));
  });
}

/**
 * Save a chat
 */
export async function putChat(chat: Chat): Promise<Chat> {
  return chatStoreQueue.run(CHAT_STORE_QUEUE_KEY, async () => {
    return runWithBackendFallback((backend) => backend.putChat(chat));
  });
}

/**
 * Delete a chat
 */
export async function deleteChat(id: string, expectedVersion?: number): Promise<Chat | null> {
  return chatStoreQueue.run(CHAT_STORE_QUEUE_KEY, async () => {
    return runWithBackendFallback((backend) => backend.deleteChat(id, expectedVersion));
  });
}

// Errors explicitly marked as never eligible for backend fallback
// (e.g. exceptions thrown by a user-supplied updater function).
const nonFallbackErrors = new WeakSet<object>();

function markNonFallbackError(err: unknown): unknown {
  const e = err && typeof err === 'object' ? err : new Error(String(err));
  nonFallbackErrors.add(e);
  return e;
}

function isNonFallbackError(err: unknown): boolean {
  return !!err && typeof err === 'object' && nonFallbackErrors.has(err);
}

export type ChatUpdater = (current: Chat | null) => Chat | null | undefined | Promise<Chat | null | undefined>;

export interface AtomicChatOptions {
  retries?: number;
}

/**
 * Runs an atomic read-modify-write operation against the current backend,
 * retrying optimistic concurrency conflicts and falling back to localStorage
 * only on infrastructure failures. Serialized via the chat store queue.
 *
 * The single owner of the retry/fallback policy for all atomic operations.
 */
async function withAtomicRetry<T>(
  retries: number,
  operation: (backend: StorageBackend) => Promise<T>,
  operationName: string,
): Promise<T> {
  return chatStoreQueue.run(CHAT_STORE_QUEUE_KEY, async () => {
    let lastErr: unknown = null;

    for (let attempt = 0; attempt <= Math.max(0, retries); attempt += 1) {
      const backend = getStorageBackend();
      try {
        return await operation(backend);
      } catch (err) {
        lastErr = err;
        if (isConcurrencyConflict(err)) {
          if (attempt < Math.max(0, retries)) continue;
          throw err;
        }
        // Only infrastructure failures may trigger fallback; validation and
        // updater errors must propagate to the caller.
        if (backend === idbStorage && !isNonFallbackError(err) && isInfrastructureError(err)) {
          fallbackToLocalStorage(err);
          continue;
        }
        throw err;
      }
    }

    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr || `Unknown ${operationName} error`));
  });
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

  return withAtomicRetry(retries, async (backend) => {
    const current = await backend.getChat(id);

    let next: Chat | null | undefined;
    try {
      next = await updater(current);
    } catch (updaterErr) {
      // Updater exceptions are caller bugs, not storage failures: propagate.
      throw markNonFallbackError(updaterErr);
    }

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
  }, 'updateChatAtomic');
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

  return withAtomicRetry(retries, async (backend) => {
    const current = await backend.getChat(id);
    const toPersist: Chat = {
      ...chat,
      id,
      _expectedVersion: current?._version,
    };
    return await backend.putChat(toPersist);
  }, 'putChatAtomic');
}

/**
 * Atomic delete that uses the latest stored version and retries conflicts.
 */
export async function deleteChatAtomic(
  id: string,
  { retries = 2 }: AtomicChatOptions = {}
): Promise<Chat | null> {
  if (!id) return null;

  return withAtomicRetry(retries, async (backend) => {
    const current = await backend.getChat(id);
    if (!current) return null;
    return await backend.deleteChat(id, current?._version);
  }, 'deleteChatAtomic');
}

/**
 * Subscribe to storage changes
 */
export function subscribeChatStorage(listener: StorageListener): () => void {
  getStorageBackend();
  // Subscribe to both backends so subscribers keep receiving events after a
  // runtime fallback from IndexedDB to localStorage (only the active backend
  // actually emits events at any given time).
  const unsubscribers = [
    idbStorage.subscribeChatStorage(listener),
    lsStorage.subscribeChatStorage(listener),
  ];
  return () => {
    for (const unsubscribe of unsubscribers) {
      try {
        unsubscribe();
      } catch {
        // Ignore unsubscribe errors
      }
    }
  };
}

/**
 * Get the current backend name (for debugging)
 */
export function getBackendName(): 'indexeddb' | 'localstorage' {
  const backend = getStorageBackend();
  return backend === idbStorage ? 'indexeddb' : 'localstorage';
}
