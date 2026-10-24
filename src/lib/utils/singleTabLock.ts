const APP_LOCK_NAME = 'advui.active-tab.v1';

/**
 * Hold an origin-wide exclusive lock until release or document teardown.
 * Web Locks arbitrate simultaneous opens and stay held in background tabs;
 * a heartbeat/expiry lock could admit a second writer when a tab is suspended.
 * A null result means another tab owns the app. Fail closed without Web Locks.
 */
export function acquireSingleTabLock(signal: AbortSignal): Promise<(() => void) | null> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Tab closed', 'AbortError'));
      return;
    }
    if (!navigator.locks?.request) {
      reject(new Error('This browser cannot enforce single-tab access. Use a browser with Web Locks support over HTTPS or localhost.'));
      return;
    }

    let release!: () => void;
    const held = new Promise<void>(done => { release = done; });
    const abort = () => {
      release();
      reject(new DOMException('Tab closed', 'AbortError'));
    };
    signal.addEventListener('abort', abort, { once: true });

    // Keep the request callback pending for the entire lifetime of the app.
    void navigator.locks.request(APP_LOCK_NAME, { mode: 'exclusive', ifAvailable: true }, async lock => {
      if (signal.aborted) return;
      if (!lock) {
        resolve(null);
        return;
      }
      resolve(release);
      await held;
    }).catch(reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
