// Typed storage errors shared by all storage backends.

/**
 * Optimistic concurrency conflict: the stored chat version did not match the
 * expected version (usually a concurrent write from another tab).
 * Conflicts are retried on the same backend and must NEVER trigger a
 * fallback to another backend.
 */
export class ConflictError extends Error {
  readonly chatId: string;

  constructor(chatId: string, operation: 'modification' | 'deletion') {
    super(`Concurrent ${operation} conflict for chat "${chatId}".`);
    this.name = 'ConflictError';
    this.chatId = chatId;
  }
}

export function isConcurrencyConflict(err: unknown): boolean {
  if (err instanceof ConflictError) return true;
  if (!!err && typeof err === 'object' && (err as { name?: unknown }).name === 'ConflictError') return true;
  // Legacy detection for errors that crossed serialization boundaries
  const message = err instanceof Error ? err.message : String(err || '');
  return message.toLowerCase().includes('concurrent') && message.toLowerCase().includes('conflict');
}
