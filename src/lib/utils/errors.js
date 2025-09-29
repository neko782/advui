// Error handling utilities
import { APIUserAbortError } from 'openai'

export function isAbortError(err) {
  if (!err) return false
  if (typeof APIUserAbortError === 'function' && err instanceof APIUserAbortError) return true
  const name = err?.name
  if (name === 'AbortError') return true
  const msg = String(err?.message || '')
  if (msg === 'Request was aborted.' || msg === 'The user aborted a request.') return true
  if (msg.toLowerCase?.().includes('aborted')) return true
  return false
}