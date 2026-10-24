import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import SingleTabApp from './SingleTabApp.svelte';
import { createTestLockManager } from './lib/utils/__fixtures__/webLocks';
import { probeStorage } from './lib/storage';

vi.mock('./lib/storage', async importOriginal => {
  const actual = await importOriginal<typeof import('./lib/storage')>();
  return { ...actual, probeStorage: vi.fn(actual.probeStorage) };
});

const components = new Set<ReturnType<typeof mount>>();
afterEach(async () => {
  for (const component of components) await unmount(component);
  components.clear();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

function openTab() {
  const target = document.createElement('div');
  document.body.append(target);
  const component = mount(SingleTabApp, { target });
  components.add(component);
  flushSync();
  return { component, target };
}

it('keeps extra tabs out of storage and allows a fresh startup after the owner closes', async () => {
  const locks = createTestLockManager();
  vi.stubGlobal('navigator', { locks });
  const first = openTab();
  await vi.waitFor(() => { flushSync(); expect(first.target.querySelector('.chat-pane')).toBeTruthy(); });
  expect(probeStorage).toHaveBeenCalledTimes(1);

  const second = openTab();
  await vi.waitFor(() => { flushSync(); expect(second.target.textContent).toContain('already open'); });
  expect(second.target.querySelector('.app-shell')).toBeNull();
  const retry = second.target.querySelector('button')!;
  retry.click();
  await vi.waitFor(() => { flushSync(); expect(second.target.textContent).toContain('already open'); });
  expect(probeStorage).toHaveBeenCalledTimes(1);

  await unmount(first.component);
  components.delete(first.component);
  await vi.waitFor(async () => expect((await locks.query()).held).toHaveLength(0));
  second.target.querySelector('button')!.click();
  await vi.waitFor(() => { flushSync(); expect(second.target.querySelector('.chat-pane')).toBeTruthy(); });
  expect(probeStorage).toHaveBeenCalledTimes(2);
});

it('shows an error without mounting the app when locking is unavailable', async () => {
  vi.stubGlobal('navigator', {});
  const tab = openTab();
  await vi.waitFor(() => { flushSync(); expect(tab.target.textContent).toContain('Web Locks'); });
  expect(tab.target.querySelector('.app-shell')).toBeNull();
  expect(probeStorage).not.toHaveBeenCalled();
});

it('reloads a cached document so restored chat state cannot bypass ownership', () => {
  vi.stubGlobal('navigator', { locks: createTestLockManager() });
  const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {});
  openTab();
  // happy-dom does not implement PageTransitionEvent.persisted yet.
  window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: false }));
  expect(reload).not.toHaveBeenCalled();
  window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
  expect(reload).toHaveBeenCalledOnce();
});
