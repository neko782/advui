// IndexedDB storage backend for chats
import { deepClone } from './utils/immutable.js';
import { assertValidChat } from './utils/chatSchema.js';
import { validateImageReferences } from './chat/services/imageCleanup.js';
import type { Chat, StorageChange, StorageListener } from './types/index.js';

const DB_NAME = 'advui_chats';
const DB_VERSION = 1;
const STORE_NAME = 'chats';
const INDEX_UPDATED_AT = 'idx_updatedAt';

let dbInstance: IDBDatabase | null = null;
const changeListeners = new Set<StorageListener>();
let broadcastChannel: BroadcastChannel | null = null;

// Write queue to serialize writes per chat ID and prevent concurrent modification errors
const writeQueues = new Map<string, Promise<Chat>>();

/**
 * Queue a write operation for a specific chat ID
 * Ensures writes are serialized per chat to prevent version conflicts
 */
function queueWrite(chatId: string, writeFn: () => Promise<Chat>): Promise<Chat> {
  const existing = writeQueues.get(chatId) || Promise.resolve({} as Chat);
  const next = existing.then(
    () => writeFn(),
    () => writeFn() // Also retry after failures
  );
  writeQueues.set(chatId, next);
  // Clean up queue entry after completion
  next.finally(() => {
    if (writeQueues.get(chatId) === next) {
      writeQueues.delete(chatId);
    }
  });
  return next;
}

/**
 * Initialize BroadcastChannel for cross-tab synchronization
 */
function initBroadcastChannel(): BroadcastChannel | null {
  if (broadcastChannel) return broadcastChannel;

  // Check if BroadcastChannel is available
  if (typeof BroadcastChannel === 'undefined') {
    console.warn('BroadcastChannel not available, cross-tab sync disabled');
    return null;
  }

  try {
    broadcastChannel = new BroadcastChannel('advui_chats_sync');

    broadcastChannel.onmessage = (event: MessageEvent) => {
      const { type, data } = (event.data || {}) as { type?: string; data?: { chat?: Chat; chatId?: string } };

      if (type === 'chat_update' && data?.chat) {
        emitChange({
          type: 'put',
          chat: data.chat,
          fromOtherTab: true,
        });
      } else if (type === 'chat_delete' && data?.chatId) {
        emitChange({
          type: 'delete',
          chatId: data.chatId,
          fromOtherTab: true,
        });
      }
    };

    return broadcastChannel;
  } catch (err) {
    console.error('Failed to initialize BroadcastChannel:', err);
    return null;
  }
}

/**
 * Broadcast a change to other tabs
 */
function broadcastChange(type: string, data: { chat?: Chat; chatId?: string }): void {
  const channel = initBroadcastChannel();
  if (!channel) return;

  try {
    channel.postMessage({ type, data });
  } catch (err) {
    console.error('Failed to broadcast change:', err);
  }
}

/**
 * Open IndexedDB connection and create object stores if needed
 */
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (dbInstance) {
      resolve(dbInstance);
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error('IndexedDB open failed:', request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      dbInstance = request.result;

      // Handle unexpected database close
      dbInstance.onversionchange = () => {
        dbInstance?.close();
        dbInstance = null;
      };

      resolve(dbInstance);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // Create chats object store if it doesn't exist
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });

        // Create index on updatedAt for efficient sorting
        store.createIndex(INDEX_UPDATED_AT, 'updatedAt', { unique: false });
      }
    };
  });
}

/**
 * Execute an async operation with error handling
 */
function asyncOperation<T>(label: string, fn: () => Promise<T>): Promise<T> {
  return Promise.resolve().then(async () => {
    try {
      return await fn();
    } catch (err) {
      console.error(`IndexedDB ${label} failed:`, err);
      throw err;
    }
  });
}

/**
 * Deep clone a chat object
 */
function cloneChat(chat: Chat | null): Chat | null {
  return chat ? deepClone(chat) : null;
}

/**
 * Emit change event to all subscribers
 */
function emitChange(change: StorageChange): void {
  for (const listener of changeListeners) {
    try {
      listener(change);
    } catch (err) {
      console.error('Chat storage listener error:', err);
    }
  }
}

/**
 * Get all chats from IndexedDB
 */
function readAll(): Promise<Chat[]> {
  return asyncOperation('readAll', async () => {
    const db = await openDB();
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);

    return new Promise((resolve, reject) => {
      const request = store.getAll();

      request.onsuccess = () => {
        const chats = (request.result || []) as Chat[];
        resolve(chats.map(chat => cloneChat(chat)!));
      };

      request.onerror = () => reject(request.error);
    });
  });
}

/**
 * Get a single chat by ID
 */
function readOne(id: string): Promise<Chat | null> {
  return asyncOperation('readOne', async () => {
    if (!id) return null;

    const db = await openDB();
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);

    return new Promise((resolve, reject) => {
      const request = store.get(id);

      request.onsuccess = () => {
        const chat = request.result as Chat | undefined;
        resolve(cloneChat(chat || null));
      };

      request.onerror = () => reject(request.error);
    });
  });
}

/**
 * Write a chat to IndexedDB with versioning
 * Writes are queued per chat ID to prevent concurrent modification errors
 */
function writeOne(chat: Chat): Promise<Chat> {
  const chatId = chat?.id;
  if (!chatId) {
    return Promise.reject(new Error('Chat ID is required'));
  }

  return queueWrite(chatId, () => writeOneInternal(chat));
}

/**
 * Internal write implementation (called from queue)
 */
function writeOneInternal(chat: Chat): Promise<Chat> {
  return asyncOperation('write', async () => {
    const candidate = cloneChat(chat)!;
    assertValidChat(candidate);

    const db = await openDB();
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    return new Promise((resolve, reject) => {
      // First, read existing chat to get current version
      const readRequest = store.get(candidate.id);

      readRequest.onsuccess = () => {
        const existing = readRequest.result as Chat | undefined;

        // Check for concurrent modifications (cross-tab)
        const expectedVersion = (typeof candidate._expectedVersion === 'number')
          ? candidate._expectedVersion
          : null;
        const currentVersion = Number(existing?._version) || 0;
        if (expectedVersion != null && currentVersion !== expectedVersion) {
          reject(new Error(`Concurrent modification conflict for chat "${candidate.id}".`));
          return;
        }

        // Since writes are queued, we don't need to check versions - just increment
        const nextChatVersion = (Number(existing?._version) || 0) + 1;
        const persistedAt = Date.now();

        const toPersist: Chat = {
          ...candidate,
          _version: nextChatVersion,
          _expectedVersion: undefined,
          _persistedAt: persistedAt,
        };
        delete toPersist._expectedVersion;

        // Write the chat
        const writeRequest = store.put(toPersist);

        writeRequest.onsuccess = () => {
          const snapshot = cloneChat(toPersist)!;

          // Emit change event
          emitChange({
            type: 'put',
            chat: snapshot,
          });

          // Broadcast to other tabs
          broadcastChange('chat_update', { chat: snapshot });

          resolve(snapshot);
        };

        writeRequest.onerror = () => reject(writeRequest.error);
      };

      readRequest.onerror = () => reject(readRequest.error);
    });
  });
}

/**
 * Delete a chat from IndexedDB
 */
function deleteOne(id: string, expectedVersion?: number): Promise<Chat | null> {
  return asyncOperation('delete', async () => {
    if (!id) return null;

    const db = await openDB();
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    return new Promise((resolve, reject) => {
      // First, read existing chat to check version
      const readRequest = store.get(id);

      readRequest.onsuccess = () => {
        const existing = readRequest.result as Chat | undefined;

        if (!existing) {
          resolve(null);
          return;
        }

        // Check for concurrent modifications
        if (expectedVersion != null && existing._version !== expectedVersion) {
          reject(new Error(`Concurrent deletion conflict for chat "${id}".`));
          return;
        }

        // Delete the chat
        const deleteRequest = store.delete(id);

        deleteRequest.onsuccess = () => {
          // Emit change event
          emitChange({
            type: 'delete',
            chatId: id,
          });

          // Broadcast to other tabs
          broadcastChange('chat_delete', { chatId: id });

          resolve(cloneChat(existing));
        };

        deleteRequest.onerror = () => reject(deleteRequest.error);
      };

      readRequest.onerror = () => reject(readRequest.error);
    });
  });
}

/**
 * Get all chats (public API)
 */
export async function getAllChats(): Promise<Chat[]> {
  return readAll();
}

/**
 * Get a single chat by ID (public API)
 */
export async function getChat(id: string): Promise<Chat | null> {
  return readOne(id);
}

/**
 * Save a chat with image validation (public API)
 */
export async function putChat(chat: Chat): Promise<Chat> {
  const validation = await validateImageReferences(chat);
  if (!validation.valid) {
    console.warn(`Chat "${chat?.id}" references missing images:`, validation.orphaned);
  }
  return writeOne(chat);
}

/**
 * Delete a chat (public API)
 */
export async function deleteChat(id: string, expectedVersion?: number): Promise<Chat | null> {
  return deleteOne(id, expectedVersion);
}

/**
 * Subscribe to chat storage changes (public API)
 */
export function subscribeChatStorage(listener: StorageListener): () => void {
  if (typeof listener !== 'function') return () => {};
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

/**
 * Check if IndexedDB is available
 */
export function isIndexedDBAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

/**
 * Close the database connection (useful for cleanup/testing)
 */
export function closeDB(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
  if (broadcastChannel) {
    broadcastChannel.close();
    broadcastChannel = null;
  }
}

/**
 * Request persistent storage permission from the browser
 * This prevents the browser from evicting IndexedDB data under storage pressure
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) {
    console.warn('Persistent storage API not available');
    return false;
  }

  try {
    // Always request - browser will handle if already granted
    const granted = await navigator.storage.persist();
    console.log('Persistent storage:', granted ? 'granted' : 'denied');
    return granted;
  } catch (err) {
    console.error('Failed to request persistent storage:', err);
    return false;
  }
}

/**
 * Check if storage is currently persistent
 */
export async function isStoragePersistent(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persisted) {
    return false;
  }
  try {
    return await navigator.storage.persisted();
  } catch {
    return false;
  }
}

// Initialize BroadcastChannel on module load
if (typeof window !== 'undefined') {
  initBroadcastChannel();
  requestPersistentStorage();
}
