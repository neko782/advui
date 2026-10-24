import { vi } from 'vitest';

// Shared lock manager for simulated documents. Locks stay held until their
// callback settles, as they do in the browser (no wall-clock expiry).
export function createTestLockManager(): LockManager {
  const held = new Set<string>();
  return {
    request: vi.fn(async (name: string, options: LockOptions, callback: LockGrantedCallback<void>) => {
      if (held.has(name)) return callback(null);
      held.add(name);
      try {
        await callback({ name, mode: options.mode || 'exclusive' });
      } finally {
        held.delete(name);
      }
    }),
    query: vi.fn(async () => ({ held: [...held].map(name => ({ name, mode: 'exclusive' as const })), pending: [] })),
  } as unknown as LockManager;
}
