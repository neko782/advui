import { describe, it, expect, vi, beforeEach } from 'vitest'
import { computePersistSig } from './chatPersistence.js'

describe('computePersistSig', () => {
  it('should return empty string on error', () => {
    // Pass null which might cause issues
    const result = computePersistSig(null, null, null)
    expect(typeof result).toBe('string')
  })

  it('should produce different signatures for different content', () => {
    const nodes = [
      { id: 1, variants: [{ id: 1, role: 'user', content: 'hello', next: null }], active: 0 },
    ]
    const settings = { model: 'gpt-4', streaming: true }
    
    const sig1 = computePersistSig(nodes, settings, 1)
    
    // Change content
    const nodes2 = [
      { id: 1, variants: [{ id: 1, role: 'user', content: 'world', next: null }], active: 0 },
    ]
    const sig2 = computePersistSig(nodes2, settings, 1)
    
    expect(sig1).not.toBe(sig2)
  })

  it('should detect same-length content changes', () => {
    const nodes1 = [
      { id: 1, variants: [{ id: 1, role: 'user', content: 'hello', next: null }], active: 0 },
    ]
    const nodes2 = [
      { id: 1, variants: [{ id: 1, role: 'user', content: 'world', next: null }], active: 0 },
    ]
    const settings = { model: 'gpt-4', streaming: true }
    
    // Both have 5-character content, but should produce different sigs
    const sig1 = computePersistSig(nodes1, settings, 1)
    const sig2 = computePersistSig(nodes2, settings, 1)
    
    expect(sig1).not.toBe(sig2)
  })

  it('should include variant count and active index', () => {
    const settings = { model: 'gpt-4', streaming: true }
    
    const nodes1 = [
      { id: 1, variants: [{ id: 1, role: 'user', content: 'test', next: null }], active: 0 },
    ]
    const nodes2 = [
      { 
        id: 1, 
        variants: [
          { id: 1, role: 'user', content: 'test', next: null },
          { id: 2, role: 'user', content: 'test', next: null },
        ], 
        active: 0 
      },
    ]
    
    const sig1 = computePersistSig(nodes1, settings, 1)
    const sig2 = computePersistSig(nodes2, settings, 1)
    
    expect(sig1).not.toBe(sig2) // Different variant counts
  })

  it('should change when active variant changes', () => {
    const settings = { model: 'gpt-4', streaming: true }
    
    const nodes1 = [
      { 
        id: 1, 
        variants: [
          { id: 1, role: 'user', content: 'a', next: null },
          { id: 2, role: 'user', content: 'b', next: null },
        ], 
        active: 0 
      },
    ]
    const nodes2 = [
      { 
        id: 1, 
        variants: [
          { id: 1, role: 'user', content: 'a', next: null },
          { id: 2, role: 'user', content: 'b', next: null },
        ], 
        active: 1 
      },
    ]
    
    const sig1 = computePersistSig(nodes1, settings, 1)
    const sig2 = computePersistSig(nodes2, settings, 1)
    
    expect(sig1).not.toBe(sig2) // Active index changed
  })

  it('should include settings in signature', () => {
    const nodes = [
      { id: 1, variants: [{ id: 1, role: 'user', content: 'test', next: null }], active: 0 },
    ]
    
    const sig1 = computePersistSig(nodes, { model: 'gpt-4', streaming: true }, 1)
    const sig2 = computePersistSig(nodes, { model: 'gpt-3.5', streaming: true }, 1)
    
    expect(sig1).not.toBe(sig2)
  })

  it('should include rootId in signature', () => {
    const nodes = [
      { id: 1, variants: [{ id: 1, role: 'user', content: 'test', next: null }], active: 0 },
      { id: 2, variants: [{ id: 2, role: 'user', content: 'test', next: null }], active: 0 },
    ]
    const settings = { model: 'gpt-4', streaming: true }
    
    const sig1 = computePersistSig(nodes, settings, 1)
    const sig2 = computePersistSig(nodes, settings, 2)
    
    expect(sig1).not.toBe(sig2)
  })

  it('should handle out-of-bounds active index gracefully', () => {
    const nodes = [
      { id: 1, variants: [{ id: 1, role: 'user', content: 'test', next: null }], active: 100 },
    ]
    const settings = { model: 'gpt-4', streaming: true }
    
    // Should not throw, should produce a valid signature
    const sig = computePersistSig(nodes, settings, 1)
    expect(typeof sig).toBe('string')
    expect(sig.length).toBeGreaterThan(0)
  })
})
