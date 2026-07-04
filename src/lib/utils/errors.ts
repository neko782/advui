// Error handling utilities

export function isAbortError(err: unknown): boolean {
  if (!err) return false;

  if (typeof DOMException !== 'undefined' && err instanceof DOMException) {
    return err.name === 'AbortError';
  }

  if (typeof err === 'object' && err !== null) {
    const errObj = err as { name?: unknown; message?: unknown };
    const name = errObj.name;
    if (name === 'AbortError') return true;

    // Only match exact known abort message forms; broad substring matching
    // misclassifies genuine server errors (e.g. "connection aborted by peer").
    const msg = String(errObj.message ?? '');
    if (msg === 'Request was aborted.' || msg === 'The user aborted a request.') return true;
  }

  return false;
}

