import { afterEach, expect, it, vi } from 'vitest';
import { acquireSingleTabLock } from './singleTabLock';
import { createTestLockManager } from './__fixtures__/webLocks';

afterEach(() => vi.unstubAllGlobals());

it('admits only one simultaneous tab, retaining ownership until it closes', async () => {
  const locks = createTestLockManager();
  vi.stubGlobal('navigator', { locks });
  const first = new AbortController();
  const second = new AbortController();
  const [owner, blocked] = await Promise.all([
    acquireSingleTabLock(first.signal), acquireSingleTabLock(second.signal),
  ]);
  expect(owner).toBeTypeOf('function');
  expect(blocked).toBeNull();
  expect(await acquireSingleTabLock(second.signal)).toBeNull();

  first.abort();
  await vi.waitFor(async () => expect((await locks.query()).held).toHaveLength(0));
  const nextOwner = await acquireSingleTabLock(second.signal);
  expect(nextOwner).toBeTypeOf('function');
  nextOwner!();
  await vi.waitFor(async () => expect((await locks.query()).held).toHaveLength(0));
});

it('does not start or retain a lock when the document closes during acquisition', async () => {
  let grant!: () => void;
  let completed = false;
  vi.stubGlobal('navigator', { locks: {
    request: async (_name: string, _options: LockOptions, callback: LockGrantedCallback<void>) => {
      await new Promise<void>(resolve => { grant = resolve; });
      await callback({ name: 'app', mode: 'exclusive' });
      completed = true;
    },
  } });
  const lifetime = new AbortController();
  const acquisition = acquireSingleTabLock(lifetime.signal);
  lifetime.abort();
  await expect(acquisition).rejects.toMatchObject({ name: 'AbortError' });
  grant();
  await vi.waitFor(() => expect(completed).toBe(true));
});

it('fails closed when Web Locks are unavailable or access is denied', async () => {
  vi.stubGlobal('navigator', {});
  await expect(acquireSingleTabLock(new AbortController().signal)).rejects.toThrow('Web Locks');
  vi.stubGlobal('navigator', { locks: { request: vi.fn().mockRejectedValue(new Error('Access denied')) } });
  await expect(acquireSingleTabLock(new AbortController().signal)).rejects.toThrow('Access denied');
});
