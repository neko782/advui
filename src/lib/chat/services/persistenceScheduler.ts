import type { Chat, PersistenceScheduler } from '../../types/index.js';

/**
 * Global persistence throttle - limits how often persistence can occur across all chats
 * This prevents storage write storms when multiple chats are active
 */
const GLOBAL_THROTTLE_MS = 50;
let globalPersistTimer: ReturnType<typeof setTimeout> | null = null;
let pendingPersists: Map<string, () => Promise<void>> = new Map();

/**
 * Queue a persist operation with global throttling
 * Only the latest persist for each chatId is kept
 */
export function queueGlobalPersist(chatId: string, persistFn: () => Promise<void>): void {
  pendingPersists.set(chatId, persistFn);

  if (globalPersistTimer) return;

  globalPersistTimer = setTimeout(async () => {
    globalPersistTimer = null;
    const batch = pendingPersists;
    pendingPersists = new Map();

    // Execute all pending persists in parallel
    const tasks = Array.from(batch.values()).map(fn => {
      try { return fn(); } catch { return Promise.resolve(); }
    });
    await Promise.allSettled(tasks);
  }, GLOBAL_THROTTLE_MS);
}

/**
 * Flush any pending global persists immediately.
 * Useful on teardown to avoid losing the last throttled write.
 */
export async function flushGlobalPersists(): Promise<void> {
  if (globalPersistTimer) {
    clearTimeout(globalPersistTimer);
    globalPersistTimer = null;
  }

  const batch = pendingPersists;
  if (!batch.size) return;
  pendingPersists = new Map();

  const tasks = Array.from(batch.values()).map(fn => {
    try { return fn(); } catch { return Promise.resolve(); }
  });
  await Promise.allSettled(tasks);
}

/**
 * Creates a persistence scheduler for handling refresh callbacks
 * Uses throttle behavior - first call wins, subsequent calls are ignored while pending
 */
export function createPersistenceScheduler(): PersistenceScheduler {
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;

  function scheduleRefresh(
    callback: ((updated?: Chat) => void) | undefined,
    updated?: Chat | null
  ): void {
    if (!callback || typeof callback !== 'function') return;

    // If a refresh is already pending, ignore this call (first wins)
    if (refreshTimer) {
      return;
    }

    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      try {
        callback(updated ?? undefined);
      } catch {
        // Ignore callback errors
      }
    }, 0);
  }

  function cancel(): void {
    if (refreshTimer) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }
  }

  return {
    scheduleRefresh,
    cancel,
  };
}
