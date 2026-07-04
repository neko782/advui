export interface KeyedPersistenceQueue {
  run<T>(key: string, fn: () => Promise<T>): Promise<T>;
}

/**
 * Minimal keyed async queue (promise chaining).
 * Use this to serialize persistence operations and avoid read/modify/write races.
 */
export function createKeyedPersistenceQueue(): KeyedPersistenceQueue {
  const queues = new Map<string, Promise<unknown>>();

  function run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const normalizedKey = typeof key === 'string' && key ? key : '__default__';
    const prev = queues.get(normalizedKey) ?? Promise.resolve();
    const next = prev.then(fn, fn) as Promise<T>;
    queues.set(normalizedKey, next as unknown as Promise<unknown>);
    // Catch first so this discarded derived promise never rejects unhandled;
    // the original `next` promise returned to the caller is unchanged.
    next.catch(() => {}).finally(() => {
      if (queues.get(normalizedKey) === (next as unknown as Promise<unknown>)) {
        queues.delete(normalizedKey);
      }
    });
    return next;
  }

  return { run };
}

