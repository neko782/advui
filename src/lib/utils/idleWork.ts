/** Let the first UI paint, then run one task at a time between interactions. */
export function scheduleIdleWork(tasks: Array<() => Promise<unknown>>): () => void {
  let cancelled = false;
  let frame: number | undefined;
  let idle: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let index = 0;
  let running = false;

  function schedule() {
    if (cancelled || running || index >= tasks.length || document.hidden) return;
    if (window.requestIdleCallback) {
      idle = window.requestIdleCallback(() => { idle = undefined; void run(); }, { timeout: 2000 });
    } else {
      timer = setTimeout(() => { timer = undefined; void run(); }, 150);
    }
  }

  async function run() {
    if (cancelled || document.hidden) return;
    const task = tasks[index++];
    if (!task) return;
    running = true;
    try { await task(); } catch { /* Opening a feature can retry a failed preload. */ }
    running = false;
    schedule();
  }

  function onVisible() {
    if (idle === undefined && timer === undefined && frame === undefined) schedule();
  }

  document.addEventListener('visibilitychange', onVisible);
  frame = requestAnimationFrame(() => {
    frame = requestAnimationFrame(() => { frame = undefined; schedule(); });
  });

  return () => {
    cancelled = true;
    if (frame !== undefined) cancelAnimationFrame(frame);
    if (idle !== undefined) window.cancelIdleCallback(idle);
    if (timer !== undefined) clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisible);
  };
}
