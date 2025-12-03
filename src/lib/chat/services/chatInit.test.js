import { describe, it, expect } from 'vitest'
import {
  recomputeNextIds,
  ensureUniqueIds,
  detectIdCollisions,
} from './chatInit.js'

describe('detectIdCollisions', () => {
  it('should return no collisions for empty nodes', () => {
    const result = detectIdCollisions([])
    expect(result.hasCollisions).toBe(false)
    expect(result.duplicateNodeIds).toHaveLength(0)
    expect(result.duplicateVariantIds).toHaveLength(0)
  })

  it('should return no collisions for unique IDs', () => {
    const nodes = [
      { id: 1, variants: [{ id: 1 }, { id: 2 }], active: 0 },
      { id: 2, variants: [{ id: 3 }, { id: 4 }], active: 0 },
    ]
    const result = detectIdCollisions(nodes)
    expect(result.hasCollisions).toBe(false)
  })

  it('should detect duplicate node IDs', () => {
    const nodes = [
      { id: 1, variants: [{ id: 1 }], active: 0 },
      { id: 1, variants: [{ id: 2 }], active: 0 }, // duplicate node id
    ]
    const result = detectIdCollisions(nodes)
    expect(result.hasCollisions).toBe(true)
    expect(result.duplicateNodeIds).toContain(1)
  })

  it('should detect duplicate variant IDs', () => {
    const nodes = [
      { id: 1, variants: [{ id: 1 }, { id: 2 }], active: 0 },
      { id: 2, variants: [{ id: 2 }, { id: 3 }], active: 0 }, // variant id 2 duplicated
    ]
    const result = detectIdCollisions(nodes)
    expect(result.hasCollisions).toBe(true)
    expect(result.duplicateVariantIds).toContain(2)
  })

  it('should detect both types of collisions', () => {
    const nodes = [
      { id: 1, variants: [{ id: 1 }], active: 0 },
      { id: 1, variants: [{ id: 1 }], active: 0 }, // both duplicated
    ]
    const result = detectIdCollisions(nodes)
    expect(result.hasCollisions).toBe(true)
    expect(result.duplicateNodeIds).toContain(1)
    expect(result.duplicateVariantIds).toContain(1)
  })
})

describe('ensureUniqueIds', () => {
  it('should return proposed IDs if no collisions', () => {
    const nodes = [
      { id: 1, variants: [{ id: 1 }], active: 0 },
    ]
    const result = ensureUniqueIds(nodes, 5, 5)
    expect(result.nextId).toBe(5)
    expect(result.nextNodeId).toBe(5)
  })

  it('should increment nextId if it collides with existing variant', () => {
    const nodes = [
      { id: 1, variants: [{ id: 1 }, { id: 2 }, { id: 3 }], active: 0 },
    ]
    // proposed nextId=2 collides with variant id 2
    const result = ensureUniqueIds(nodes, 2, 5)
    expect(result.nextId).toBe(4) // incremented past 2, 3
    expect(result.nextNodeId).toBe(5)
  })

  it('should increment nextNodeId if it collides with existing node', () => {
    const nodes = [
      { id: 1, variants: [{ id: 1 }], active: 0 },
      { id: 2, variants: [{ id: 2 }], active: 0 },
      { id: 3, variants: [{ id: 3 }], active: 0 },
    ]
    // proposed nextNodeId=2 collides with node id 2
    const result = ensureUniqueIds(nodes, 10, 2)
    expect(result.nextNodeId).toBe(4) // incremented past 2, 3
    expect(result.nextId).toBe(10)
  })

  it('should handle both collisions simultaneously', () => {
    const nodes = [
      { id: 1, variants: [{ id: 1 }, { id: 2 }], active: 0 },
      { id: 2, variants: [{ id: 3 }], active: 0 },
    ]
    const result = ensureUniqueIds(nodes, 1, 1)
    expect(result.nextId).toBe(4) // past 1, 2, 3
    expect(result.nextNodeId).toBe(3) // past 1, 2
  })
})

describe('recomputeNextIds', () => {
  it('should return 1,1 for empty nodes', () => {
    const result = recomputeNextIds([])
    expect(result.nextId).toBe(1)
    expect(result.nextNodeId).toBe(1)
  })

  it('should return max+1 for simple nodes', () => {
    const nodes = [
      { id: 1, variants: [{ id: 1 }], active: 0 },
      { id: 2, variants: [{ id: 2 }], active: 0 },
    ]
    const result = recomputeNextIds(nodes)
    expect(result.nextId).toBe(3) // max variant id is 2
    expect(result.nextNodeId).toBe(3) // max node id is 2
  })

  it('should handle nodes with multiple variants', () => {
    const nodes = [
      { id: 1, variants: [{ id: 1 }, { id: 5 }, { id: 3 }], active: 0 },
    ]
    const result = recomputeNextIds(nodes)
    expect(result.nextId).toBe(6) // max variant id is 5
    expect(result.nextNodeId).toBe(2) // max node id is 1
  })

  it('should return safe IDs even with collisions', () => {
    // This simulates a corrupted state where IDs might overlap
    const nodes = [
      { id: 1, variants: [{ id: 1 }], active: 0 },
      { id: 2, variants: [{ id: 2 }], active: 0 },
    ]
    const result = recomputeNextIds(nodes)
    // Should be safe even though we're computing max+1
    expect(result.nextId).toBeGreaterThan(2)
    expect(result.nextNodeId).toBeGreaterThan(2)
  })
})
