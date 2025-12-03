// localStorage storage backend for chats (fallback)
import { safeRead, safeWrite } from './utils/localStorageHelper.js';
import { deepClone } from './utils/immutable.js';
import { assertValidChat } from './utils/chatSchema.js';
import { validateImageReferences } from './chat/services/imageCleanup.js';
import type { Chat, StorageChange, StorageListener, LocalStorageStore } from './types/index.js';

const LS_KEY = 'advui.chats.store.v1';
const INITIAL_STORE: LocalStorageStore = { version: 0, byId: {} };
const changeListeners = new Set<StorageListener>();

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

function sanitizeStore(value: unknown): LocalStorageStore {
  if (!value) return { ...INITIAL_STORE };
  let data = value;
  if (typeof value === 'string') {
    try {
      data = JSON.parse(value);
    } catch (err) {
      console.error('Failed to parse chat storage payload:', err);
      return { ...INITIAL_STORE };
    }
  }
  const dataObj = data as Record<string, unknown>;
  const version = Number(dataObj?.version) || 0;
  const byId = (dataObj && typeof dataObj === 'object' && dataObj.byId && typeof dataObj.byId === 'object')
    ? dataObj.byId as Record<string, Chat>
    : {};
  return { version, byId };
}

function readStore(): LocalStorageStore {
  return sanitizeStore(safeRead(LS_KEY, { ...INITIAL_STORE }, sanitizeStore));
}

function writeStore(store: LocalStorageStore): LocalStorageStore {
  const payload = {
    version: Number(store?.version) || 0,
    byId: store?.byId || {},
  };
  const ok = safeWrite(LS_KEY, payload);
  if (!ok) {
    throw new Error('Failed to persist chats to storage.');
  }
  return payload;
}

function emitChange(change: StorageChange): void {
  for (const listener of changeListeners) {
    try {
      listener(change);
    } catch (err) {
      console.error('Chat storage listener error:', err);
    }
  }
}

function handleExternalStorageEvent(event: StorageEvent): void {
  if (event?.key !== LS_KEY) return;
  const nextStore = sanitizeStore(event.newValue);
  emitChange({
    type: 'sync',
    version: nextStore.version,
    store: {
      version: nextStore.version,
      byId: { ...nextStore.byId },
    },
  });
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', handleExternalStorageEvent);
}

function asyncOperation<T>(label: string, fn: () => T): Promise<T> {
  return Promise.resolve().then(() => {
    try {
      return fn();
    } catch (err) {
      console.error(`Chat storage ${label} failed:`, err);
      throw err;
    }
  });
}

function cloneChat(chat: Chat | null): Chat | null {
  return chat ? deepClone(chat) : null;
}

function writeOne(chat: Chat): Promise<Chat> {
  const chatId = chat?.id;
  if (!chatId) {
    return Promise.reject(new Error('Chat ID is required'));
  }
  return queueWrite(chatId, () => writeOneInternal(chat));
}

function writeOneInternal(chat: Chat): Promise<Chat> {
  return asyncOperation('write', () => {
    const candidate = cloneChat(chat)!;
    assertValidChat(candidate);

    const store = readStore();
    const byId = { ...store.byId };
    const existing = byId[candidate.id];

    // Since writes are queued, we don't need to check versions - just increment
    const nextStoreVersion = (Number(store.version) || 0) + 1;
    const nextChatVersion = (Number(existing?._version) || 0) + 1;
    const persistedAt = Date.now();

    const toPersist: Chat = {
      ...candidate,
      _version: nextChatVersion,
      _expectedVersion: undefined,
      _persistedAt: persistedAt,
    };
    delete toPersist._expectedVersion;

    byId[candidate.id] = toPersist;
    writeStore({ version: nextStoreVersion, byId });

    const snapshot = cloneChat(toPersist)!;
    emitChange({
      type: 'put',
      version: nextStoreVersion,
      chat: snapshot,
    });
    return snapshot;
  });
}

function readAll(): Promise<Chat[]> {
  return asyncOperation('readAll', () => {
    const store = readStore();
    return Object.values(store.byId || {}).map((chat) => cloneChat(chat)!);
  });
}

function readOne(id: string): Promise<Chat | null> {
  return asyncOperation('readOne', () => {
    if (!id) return null;
    const store = readStore();
    const chat = store.byId?.[id];
    return cloneChat(chat || null);
  });
}

function deleteOne(id: string, expectedVersion?: number): Promise<Chat | null> {
  return asyncOperation('delete', () => {
    if (!id) return null;
    const store = readStore();
    if (!store.byId?.[id]) return null;
    const existing = store.byId[id]!;
    if (expectedVersion != null && existing._version !== expectedVersion) {
      throw new Error(`Concurrent deletion conflict for chat "${id}".`);
    }
    const byId = { ...store.byId };
    delete byId[id];
    const nextStoreVersion = (Number(store.version) || 0) + 1;
    writeStore({ version: nextStoreVersion, byId });
    emitChange({
      type: 'delete',
      version: nextStoreVersion,
      chatId: id,
    });
    return cloneChat(existing);
  });
}

export async function getAllChats(): Promise<Chat[]> {
  return readAll();
}

export async function getChat(id: string): Promise<Chat | null> {
  return readOne(id);
}

export async function putChat(chat: Chat): Promise<Chat> {
  const validation = await validateImageReferences(chat);
  if (!validation.valid) {
    console.warn(`Chat "${chat?.id}" references missing images:`, validation.orphaned);
  }
  return writeOne(chat);
}

export async function deleteChat(id: string, expectedVersion?: number): Promise<Chat | null> {
  return deleteOne(id, expectedVersion);
}

export function subscribeChatStorage(listener: StorageListener): () => void {
  if (typeof listener !== 'function') return () => {};
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

export function isIndexedDBAvailable(): boolean {
  return false;
}

