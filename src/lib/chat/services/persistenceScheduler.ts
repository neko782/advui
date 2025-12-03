import type { Chat, PersistenceScheduler } from '../../types/index.js';

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
