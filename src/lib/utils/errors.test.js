import { describe, it, expect } from 'vitest'
import { isAbortError } from './errors.js'

describe('isAbortError', () => {
  it('should return false for non-errors', () => {
    expect(isAbortError(null)).toBe(false)
    expect(isAbortError(undefined)).toBe(false)
    expect(isAbortError({ foo: 'bar' })).toBe(false)
  })

  it('should detect AbortError by name', () => {
    const error = new Error('Something happened')
    error.name = 'AbortError'
    expect(isAbortError(error)).toBe(true)
  })

  it('should detect DOMException aborts', () => {
    expect(isAbortError(new DOMException('The operation was aborted.', 'AbortError'))).toBe(true)
    expect(isAbortError(new DOMException('Not allowed', 'NotAllowedError'))).toBe(false)
  })

  it('should detect exact known abort message forms', () => {
    expect(isAbortError(new Error('Request was aborted.'))).toBe(true)
    expect(isAbortError(new Error('The user aborted a request.'))).toBe(true)
  })

  it('should not misclassify server errors mentioning "aborted"', () => {
    expect(isAbortError(new Error('Connection ABORTED'))).toBe(false)
    expect(isAbortError(new Error('connection aborted by peer'))).toBe(false)
  })

  it('should return false for non-abort errors', () => {
    expect(isAbortError(new Error('Network error'))).toBe(false)
    expect(isAbortError(new Error('Timeout'))).toBe(false)
  })
})