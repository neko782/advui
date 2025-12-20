// Error handling utilities

export function isAbortError(err: unknown): boolean {
  if (!err) return false;

  if (typeof err === 'object' && err !== null) {
    const errObj = err as { name?: unknown; message?: unknown };
    const name = errObj.name;
    if (name === 'AbortError') return true;

    const msg = String(errObj.message ?? '');
    if (msg === 'Request was aborted.' || msg === 'The user aborted a request.') return true;
    if (msg.toLowerCase().includes('aborted')) return true;
  }

  return false;
}

