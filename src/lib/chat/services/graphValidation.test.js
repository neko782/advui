import { describe, it, expect } from 'vitest'
import { sanitizeGraphIfNeeded } from './graphValidation.js'

describe('sanitizeGraphIfNeeded', () => {
  it('should return nodes as-is in debug mode', () => {
    const nodes = [
      { id: 1, variants: [{ id: 1, next: 3 }] },
      { id: 2, variants: [{ id: 2, next: 3 }] },
      { id: 3, variants: [{ id: 3, next: null }] }
    ]
    const result = sanitizeGraphIfNeeded(nodes, 1, true)
    expect(result.nodes).toBe(nodes)
    expect(result.notice).toBe('')
  })

  it('should return valid graphs unchanged', () => {
    const nodes = [
      { id: 1, variants: [{ id: 1, next: 2 }] },
      { id: 2, variants: [{ id: 2, next: null }] }
    ]
    const result = sanitizeGraphIfNeeded(nodes, 1, false)
    expect(result.nodes).toEqual(nodes)
    expect(result.notice).toBe('')
  })

  it('should fix multiple parents and return notice', () => {
    const nodes = [
      { id: 1, variants: [{ id: 1, next: 3 }] },
      { id: 2, variants: [{ id: 2, next: 3 }] },
      { id: 3, variants: [{ id: 3, next: null }] }
    ]
    const result = sanitizeGraphIfNeeded(nodes, 1, false)
    expect(result.notice).toContain('Auto-fixed')
    expect(result.notice).toContain('multiple parents')
    expect(result.nodes).not.toBe(nodes)
  })
})