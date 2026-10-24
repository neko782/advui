// Chat storage facade. IndexedDB is the only backend: there is deliberately
// no runtime fallback, because silently switching backends hides existing
// chats and splits a user's history between two stores. When IndexedDB is
// unusable every operation rejects with StorageUnavailableError so callers
// can tell "storage is broken" apart from "there are no chats".
import * as idbStorage from './storage.indexeddb.js';
import { createKeyedPersistenceQueue } from './utils/persistenceQueue.js';
import { isConcurrencyConflict, StorageUnavailableError, isStorageUnavailable } from './storage.errors.js';
import type { Chat, ChatListItem, StorageListener } from './types/index.js';

export { ConflictError, isConcurrencyConflict, StorageUnavailableError, isStorageUnavailable } from './storage.errors.js';

const CHAT_STORE_QUEUE_KEY = 'chats.v1';

const chatStoreQueue = createKeyedPersistenceQueue();

// Error names IndexedDB uses for infrastructure failures (DB open, quota,
// transaction problems). These are surfaced as StorageUnavailableError.
// Validation errors and optimistic concurrency conflicts are not storage
// outages and propagate unchanged.
const INFRASTRUCTURE_ERROR_NAMES = new Set([
  'InvalidStateError',
  'UnknownError',
  'QuotaExceededError',
  'TransactionInactiveError',
  'InvalidAccessError',
  'AbortError',
  'NotFoundError',
  'VersionError',
  'NotAllowedError',
  'SecurityError',
  'TimeoutError',
  'NS_ERROR_DOM_QUOTA_REACHED',
]);

function isInfrastructureError(err: unknown): boolean {
  if (err == null) return false;
  if (isConcurrencyConflict(err)) return false;
  if (isStorageUnavailable(err)) return true;
  const name = (err as { name?: unknown })?.name;
  if (typeof name === 'string' && INFRASTRUCTURE_ERROR_NAMES.has(name)) return true;
  const message = err instanceof Error ? err.message : String(err);
  // openDB rejections (open failed / blocked) mention IndexedDB explicitly
  return message.toLowerCase().includes('indexeddb');
}

function toStorageError(err: unknown): unknown {
  if (isStorageUnavailable(err) || !isInfrastructureError(err)) return err;
  return new StorageUnavailableError(describeError(err), err);
}

function describeError(err: unknown): string {
  const name = (err as { name?: unknown })?.name;
  if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED') {
    return 'Browser storage is full. Free up space or delete old chats, then retry.';
  }
  if (name === 'SecurityError' || name === 'NotAllowedError') {
    return 'The browser blocked access to IndexedDB (private browsing or site data settings may be disabling it).';
  }
  const message = err instanceof Error ? err.message : String(err || '');
  return message ? `IndexedDB failed: ${message}` : 'IndexedDB failed.';
}

function assertAvailable(): void {
  if (!idbStorage.isIndexedDBAvailable()) {
    throw new StorageUnavailableError('This browser does not provide IndexedDB, which is required to store chats.');
  }
}

async function run<T>(operation: () => Promise<T>): Promise<T> {
  return chatStoreQueue.run(CHAT_STORE_QUEUE_KEY, async () => {
    assertAvailable();
    try {
      return await operation();
    } catch (err) {
      throw toStorageError(err);
    }
  });
}

/**
 * Opens the chat database. Resolves when storage is usable and rejects with
 * StorageUnavailableError otherwise. Used at startup to decide whether the
 * app can run at all.
 */
export async function probeStorage(): Promise<void> {
  await run(() => idbStorage.openDatabase().then(() => undefined));
}

/**
 * Get all chats
 */
export async function getAllChats(): Promise<Chat[]> {
  return run(() => idbStorage.getAllChats());
}

/**
 * Get lightweight chat list items
 */
export async function getChatListItems(): Promise<ChatListItem[]> {
  return run(() => idbStorage.getChatListItems());
}

/**
 * Get a single chat by ID. Resolves null only when the chat does not exist;
 * storage failures reject.
 */
export async function getChat(id: string): Promise<Chat | null> {
  return run(() => idbStorage.getChat(id));
}

/**
 * Save a chat
 */
export async function putChat(chat: Chat): Promise<Chat> {
  return run(() => idbStorage.putChat(chat));
}

/**
 * Delete a chat
 */
export async function deleteChat(id: string, expectedVersion?: number): Promise<Chat | null> {
  return run(() => idbStorage.deleteChat(id, expectedVersion));
}

export type ChatUpdater = (current: Chat | null) => Chat | null | undefined | Promise<Chat | null | undefined>;

export interface AtomicChatOptions {
  retries?: number;
}

// Updater exceptions are caller bugs, not storage failures: they must reach
// the caller unchanged instead of being reported as an outage.
class UpdaterError extends Error {
  readonly original: unknown;
  constructor(original: unknown) {
    super('updater failed');
    this.original = original;
  }
}

/**
 * Runs an atomic read-modify-write operation, retrying optimistic
 * concurrency conflicts (usually a write from another tab). Serialized via
 * the chat store queue.
 */
async function withAtomicRetry<T>(
  retries: number,
  operation: () => Promise<T>,
  operationName: string,
): Promise<T> {
  return chatStoreQueue.run(CHAT_STORE_QUEUE_KEY, async () => {
    assertAvailable();
    let lastErr: unknown = null;

    for (let attempt = 0; attempt <= Math.max(0, retries); attempt += 1) {
      try {
        return await operation();
      } catch (err) {
        if (err instanceof UpdaterError) throw err.original;
        lastErr = err;
        if (isConcurrencyConflict(err) && attempt < Math.max(0, retries)) continue;
        throw toStorageError(err);
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

  return withAtomicRetry(retries, async () => {
    const current = await idbStorage.getChat(id);

    let next: Chat | null | undefined;
    try {
      next = await updater(current);
    } catch (updaterErr) {
      throw new UpdaterError(updaterErr);
    }

    if (next === undefined) {
      return current;
    }
    if (next == null) {
      if (!current) return null;
      return await idbStorage.deleteChat(id, current?._version);
    }

    const toPersist: Chat = {
      ...next,
      id,
      _expectedVersion: current?._version,
    };

    return await idbStorage.putChat(toPersist);
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

  return withAtomicRetry(retries, async () => {
    const current = await idbStorage.getChat(id);
    const toPersist: Chat = {
      ...chat,
      id,
      _expectedVersion: current?._version,
    };
    return await idbStorage.putChat(toPersist);
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

  return withAtomicRetry(retries, async () => {
    const current = await idbStorage.getChat(id);
    if (!current) return null;
    return await idbStorage.deleteChat(id, current?._version);
  }, 'deleteChatAtomic');
}

/**
 * Subscribe to storage changes
 */
export function subscribeChatStorage(listener: StorageListener): () => void {
  return idbStorage.subscribeChatStorage(listener);
}
