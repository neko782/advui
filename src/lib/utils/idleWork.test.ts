import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { scheduleIdleWork } from './idleWork';

let frames: Map<number, FrameRequestCallback>;
let idles: Map<number, IdleRequestCallback>;
let nextId: number;
let cleanup: (() => void) | undefined;

beforeEach(() => {
  nextId = 0;
  frames = new Map();
  idles = new Map();
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++nextId, callback); return nextId; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal('requestIdleCallback', (callback: IdleRequestCallback) => { idles.set(++nextId, callback); return nextId; });
  vi.stubGlobal('cancelIdleCallback', (id: number) => idles.delete(id));
});
afterEach(() => { cleanup?.(); cleanup = undefined; vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

function paint() {
  const callbacks = [...frames.values()];
  frames.clear();
  callbacks.forEach(callback => callback(0));
}
async function idle() {
  const callback = [...idles.values()][0]!;
  idles.clear();
  callback({ didTimeout: false, timeRemaining: () => 30 });
  await Promise.resolve();
  await Promise.resolve();
}

it('waits for the initial paint and runs only one import per idle callback', async () => {
  const first = vi.fn(async () => {});
  const second = vi.fn(async () => {});
  cleanup = scheduleIdleWork([first, second]);
  expect(first).not.toHaveBeenCalled();
  paint();
  expect(idles.size).toBe(0);
  paint();
  await idle();
  expect(first).toHaveBeenCalledOnce();
  expect(second).not.toHaveBeenCalled();
  await idle();
  expect(second).toHaveBeenCalledOnce();
});

it('cancels queued work and continues after a failed preload', async () => {
  const second = vi.fn(async () => {});
  cleanup = scheduleIdleWork([async () => { throw new Error('Offline'); }, second]);
  paint(); paint();
  await idle();
  expect(idles.size).toBe(1);
  cleanup();
  expect(idles.size).toBe(0);
  expect(second).not.toHaveBeenCalled();
});

it('pauses while hidden and resumes on visibility change', async () => {
  const task = vi.fn(async () => {});
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  cleanup = scheduleIdleWork([task]);
  paint(); paint();
  expect(idles.size).toBe(0);
  hidden.mockReturnValue(false);
  document.dispatchEvent(new Event('visibilitychange'));
  await idle();
  expect(task).toHaveBeenCalledOnce();
});

it('uses spaced timers when idle callbacks are unavailable', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.stubGlobal('requestIdleCallback', undefined);
  const task = vi.fn(async () => {});
  cleanup = scheduleIdleWork([task]);
  paint(); paint();
  await vi.advanceTimersByTimeAsync(149);
  expect(task).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(task).toHaveBeenCalledOnce();
});
