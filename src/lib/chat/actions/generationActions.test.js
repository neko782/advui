import { describe, it, expect, vi } from 'vitest'
import {
  validateTypingVariantVisible,
  validateTypingVariantDetailed,
  createStreamingGuard,
} from './generationActions.js'

describe('validateTypingVariantVisible', () => {
  it('should return false for null typingVariantId', () => {
    const nodes = [{ id: 1, variants: [{ id: 1, typing: true, next: null }], active: 0 }]
    expect(validateTypingVariantVisible(nodes, 1, null)).toBe(false)
  })

  it('should return true for visible typing variant', () => {
    const nodes = [
      { id: 1, variants: [{ id: 1, role: 'user', typing: false, next: 2 }], active: 0 },
      { id: 2, variants: [{ id: 2, role: 'assistant', typing: true, next: null }], active: 0 },
    ]
    expect(validateTypingVariantVisible(nodes, 1, 2)).toBe(true)
  })

  it('should return false for non-typing variant', () => {
    const nodes = [
      { id: 1, variants: [{ id: 1, role: 'assistant', typing: false, next: null }], active: 0 },
    ]
    expect(validateTypingVariantVisible(nodes, 1, 1)).toBe(false)
  })

  it('should return false for variant on non-active branch', () => {
    const nodes = [
      { 
        id: 1, 
        variants: [
          { id: 1, role: 'user', typing: false, next: null },
          { id: 2, role: 'user', typing: true, next: null }, // inactive variant
        ], 
        active: 0 // only variant 1 is active
      },
    ]
    expect(validateTypingVariantVisible(nodes, 1, 2)).toBe(false)
  })
})

describe('validateTypingVariantDetailed', () => {
  it('should report not found for missing variant', () => {
    const nodes = [{ id: 1, variants: [{ id: 1, typing: false, next: null }], active: 0 }]
    const result = validateTypingVariantDetailed(nodes, 1, 999)
    expect(result.visible).toBe(false)
    expect(result.exists).toBe(false)
    expect(result.reason).toContain('not found')
  })

  it('should report exists but not typing', () => {
    const nodes = [
      { id: 1, variants: [{ id: 1, role: 'assistant', typing: false, next: null }], active: 0 },
    ]
    const result = validateTypingVariantDetailed(nodes, 1, 1)
    expect(result.visible).toBe(false)
    expect(result.exists).toBe(true)
    expect(result.isTyping).toBe(false)
    expect(result.reason).toContain('typing flag is false')
  })

  it('should report inactive variant', () => {
    const nodes = [
      { 
        id: 1, 
        variants: [
          { id: 1, role: 'user', typing: false, next: null },
          { id: 2, role: 'user', typing: true, next: null },
        ], 
        active: 0 
      },
    ]
    const result = validateTypingVariantDetailed(nodes, 1, 2)
    expect(result.visible).toBe(false)
    expect(result.exists).toBe(true)
    expect(result.isActive).toBe(false)
    expect(result.reason).toContain('not the active variant')
  })

  it('should report node not in path', () => {
    const nodes = [
      { id: 1, variants: [{ id: 1, role: 'user', typing: false, next: null }], active: 0 },
      { id: 2, variants: [{ id: 2, role: 'assistant', typing: true, next: null }], active: 0 }, // detached
    ]
    const result = validateTypingVariantDetailed(nodes, 1, 2)
    expect(result.visible).toBe(false)
    expect(result.exists).toBe(true)
    expect(result.isActive).toBe(true)
    expect(result.reason).toContain('not in visible path')
  })

  it('should report visible and typing for valid variant', () => {
    const nodes = [
      { id: 1, variants: [{ id: 1, role: 'user', typing: false, next: 2 }], active: 0 },
      { id: 2, variants: [{ id: 2, role: 'assistant', typing: true, next: null }], active: 0 },
    ]
    const result = validateTypingVariantDetailed(nodes, 1, 2)
    expect(result.visible).toBe(true)
    expect(result.exists).toBe(true)
    expect(result.isTyping).toBe(true)
    expect(result.isActive).toBe(true)
    expect(result.nodeId).toBe(2)
  })
})

describe('createStreamingGuard', () => {
  it('should execute updates when variant is visible', () => {
    const nodes = [
      { id: 1, variants: [{ id: 1, role: 'user', typing: false, next: 2 }], active: 0 },
      { id: 2, variants: [{ id: 2, role: 'assistant', typing: true, next: null }], active: 0 },
    ]
    
    const guard = createStreamingGuard(
      () => nodes,
      () => 1,
      2
    )

    let executed = false
    const result = guard(() => { executed = true })
    expect(result).toBe(true)
    expect(executed).toBe(true)
  })

  it('should block updates when variant becomes invisible', () => {
    let nodes = [
      { id: 1, variants: [{ id: 1, role: 'user', typing: false, next: 2 }], active: 0 },
      { id: 2, variants: [{ id: 2, role: 'assistant', typing: true, next: null }], active: 0 },
    ]
    
    const guard = createStreamingGuard(
      () => nodes,
      () => 1,
      2
    )

    // First update succeeds
    expect(guard(() => {})).toBe(true)

    // Simulate variant being deleted or moved off path
    nodes = [
      { id: 1, variants: [{ id: 1, role: 'user', typing: false, next: null }], active: 0 },
      // Node 2 is now detached
      { id: 2, variants: [{ id: 2, role: 'assistant', typing: true, next: null }], active: 0 },
    ]

    // Second update should fail
    expect(guard(() => {})).toBe(false)
  })

  it('should call onInvalidate when variant becomes invisible', () => {
    let nodes = [
      { id: 1, variants: [{ id: 1, role: 'user', typing: false, next: 2 }], active: 0 },
      { id: 2, variants: [{ id: 2, role: 'assistant', typing: true, next: null }], active: 0 },
    ]
    
    const onInvalidate = vi.fn()
    const guard = createStreamingGuard(
      () => nodes,
      () => 1,
      2,
      onInvalidate
    )

    // Detach node 2
    nodes = [
      { id: 1, variants: [{ id: 1, role: 'user', typing: false, next: null }], active: 0 },
      { id: 2, variants: [{ id: 2, role: 'assistant', typing: true, next: null }], active: 0 },
    ]

    guard(() => {})
    expect(onInvalidate).toHaveBeenCalledOnce()
    expect(onInvalidate).toHaveBeenCalledWith(expect.stringContaining('not in visible path'))
  })

  it('should stay invalidated after first failure', () => {
    let nodes = [
      { id: 1, variants: [{ id: 1, role: 'user', typing: false, next: 2 }], active: 0 },
      { id: 2, variants: [{ id: 2, role: 'assistant', typing: true, next: null }], active: 0 },
    ]
    
    const guard = createStreamingGuard(
      () => nodes,
      () => 1,
      2
    )

    // Invalidate by removing from path
    nodes = [
      { id: 1, variants: [{ id: 1, role: 'user', typing: false, next: null }], active: 0 },
    ]
    guard(() => {})

    // Even if we restore the path, guard stays invalidated
    nodes = [
      { id: 1, variants: [{ id: 1, role: 'user', typing: false, next: 2 }], active: 0 },
      { id: 2, variants: [{ id: 2, role: 'assistant', typing: true, next: null }], active: 0 },
    ]

    let executed = false
    guard(() => { executed = true })
    expect(executed).toBe(false)
  })
})
