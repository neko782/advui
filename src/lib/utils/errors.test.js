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

  it('should detect abort by message content', () => {
    expect(isAbortError(new Error('Request was aborted.'))).toBe(true)
    expect(isAbortError(new Error('The user aborted a request.'))).toBe(true)
    expect(isAbortError(new Error('Connection ABORTED'))).toBe(true)
  })

  it('should return false for non-abort errors', () => {
    expect(isAbortError(new Error('Network error'))).toBe(false)
    expect(isAbortError(new Error('Timeout'))).toBe(false)
  })
})