import { describe, it, expect } from 'vitest'
import {
  indexNodesById,
  buildVisible,
  buildVisibleUpTo,
  findParentId,
  validateTree,
  enforceUniqueParents
} from './branching.js'

describe('indexNodesById', () => {
  it('should create a map of nodes by id', () => {
    const nodes = [
      { id: 1, data: 'a' },
      { id: 2, data: 'b' },
      { id: 3, data: 'c' }
    ]
    const map = indexNodesById(nodes)
    expect(map.size).toBe(3)
    expect(map.get(1)).toEqual({ id: 1, data: 'a' })
    expect(map.get(2)).toEqual({ id: 2, data: 'b' })
  })

  it('should handle empty array', () => {
    const map = indexNodesById([])
    expect(map.size).toBe(0)
  })

  it('should handle null/undefined', () => {
    expect(indexNodesById(null).size).toBe(0)
    expect(indexNodesById(undefined).size).toBe(0)
  })

  it('should handle duplicate ids by keeping the last one', () => {
    const nodes = [
      { id: 1, data: 'a' },
      { id: 1, data: 'b' }
    ]
    const map = indexNodesById(nodes)
    expect(map.size).toBe(1)
    expect(map.get(1).data).toBe('b')
  })
})

describe('buildVisible', () => {
  it('should build visible path from root', () => {
    const nodes = [
      { id: 1, variants: [{ id: 101, role: 'user', content: 'Hi', next: 2 }] },
      { id: 2, variants: [{ id: 102, role: 'assistant', content: 'Hello', next: null }] }
    ]
    const visible = buildVisible(nodes, 1)
    expect(visible).toHaveLength(2)
    expect(visible[0].m.content).toBe('Hi')
    expect(visible[1].m.content).toBe('Hello')
  })

  it('should use active variant index', () => {
    const nodes = [
      {
        id: 1,
        active: 1,
        variants: [
          { id: 101, content: 'First', next: null },
          { id: 102, content: 'Second', next: null }
        ]
      }
    ]
    const visible = buildVisible(nodes, 1)
    expect(visible).toHaveLength(1)
    expect(visible[0].m.content).toBe('Second')
  })

  it('should default to variant 0 when active not specified', () => {
    const nodes = [
      {
        id: 1,
        variants: [
          { id: 101, content: 'First', next: null },
          { id: 102, content: 'Second', next: null }
        ]
      }
    ]
    const visible = buildVisible(nodes, 1)
    expect(visible[0].m.content).toBe('First')
  })

  it('should stop at null next', () => {
    const nodes = [
      { id: 1, variants: [{ id: 101, content: 'A', next: 2 }] },
      { id: 2, variants: [{ id: 102, content: 'B', next: null }] },
      { id: 3, variants: [{ id: 103, content: 'C', next: null }] }
    ]
    const visible = buildVisible(nodes, 1)
    expect(visible).toHaveLength(2)
  })

  it('should detect cycles and stop', () => {
    const nodes = [
      { id: 1, variants: [{ id: 101, content: 'A', next: 2 }] },
      { id: 2, variants: [{ id: 102, content: 'B', next: 1 }] }
    ]
    const visible = buildVisible(nodes, 1)
    expect(visible).toHaveLength(2) // stops when revisiting node 1
  })

  it('should handle missing node gracefully', () => {
    const nodes = [
      { id: 1, variants: [{ id: 101, content: 'A', next: 999 }] }
    ]
    const visible = buildVisible(nodes, 1)
    expect(visible).toHaveLength(1)
  })

  it('should include path metadata', () => {
    const nodes = [
      { id: 1, variants: [{ id: 101, content: 'A', next: 2 }] },
      { id: 2, variants: [{ id: 102, content: 'B', next: null }] }
    ]
    const visible = buildVisible(nodes, 1)
    expect(visible[0]).toMatchObject({
      i: 0,
      nodeId: 1,
      variantIndex: 0,
      variantsLength: 1
    })
    expect(visible[1]).toMatchObject({
      i: 1,
      nodeId: 2,
      variantIndex: 0,
      variantsLength: 1
    })
  })

  it('should handle node without variants', () => {
    const nodes = [
      { id: 1, variants: [] }
    ]
    const visible = buildVisible(nodes, 1)
    expect(visible).toHaveLength(0)
  })

  it('should clamp active index to valid range', () => {
    const nodes = [
      {
        id: 1,
        active: 999,
        variants: [
          { id: 101, content: 'Only', next: null }
        ]
      }
    ]
    const visible = buildVisible(nodes, 1)
    expect(visible[0].m.content).toBe('Only')
  })
})

describe('buildVisibleUpTo', () => {
  it('should return messages up to index', () => {
    const nodes = [
      { id: 1, variants: [{ id: 101, content: 'A', next: 2 }] },
      { id: 2, variants: [{ id: 102, content: 'B', next: 3 }] },
      { id: 3, variants: [{ id: 103, content: 'C', next: null }] }
    ]
    const messages = buildVisibleUpTo(nodes, 1, 2)
    expect(messages).toHaveLength(2)
    expect(messages[0].content).toBe('A')
    expect(messages[1].content).toBe('B')
  })

  it('should handle index larger than path length', () => {
    const nodes = [
      { id: 1, variants: [{ id: 101, content: 'A', next: null }] }
    ]
    const messages = buildVisibleUpTo(nodes, 1, 999)
    expect(messages).toHaveLength(1)
  })

  it('should handle index 0', () => {
    const nodes = [
      { id: 1, variants: [{ id: 101, content: 'A', next: null }] }
    ]
    const messages = buildVisibleUpTo(nodes, 1, 0)
    expect(messages).toHaveLength(0)
  })

  it('should return only message objects, not metadata', () => {
    const nodes = [
      { id: 1, variants: [{ id: 101, content: 'A', next: null }] }
    ]
    const messages = buildVisibleUpTo(nodes, 1, 1)
    expect(messages[0]).toEqual({ id: 101, content: 'A', next: null })
  })
})

describe('findParentId', () => {
  it('should find parent node id', () => {
    const nodes = [
      { id: 1, variants: [{ id: 101, next: 2 }] },
      { id: 2, variants: [{ id: 102, next: null }] }
    ]
    expect(findParentId(nodes, 2)).toBe(1)
  })

  it('should return null if no parent found', () => {
    const nodes = [
      { id: 1, variants: [{ id: 101, next: null }] }
    ]
    expect(findParentId(nodes, 2)).toBe(null)
  })

  it('should find parent among multiple variants', () => {
    const nodes = [
      {
        id: 1,
        variants: [
          { id: 101, next: null },
          { id: 102, next: 3 }
        ]
      },
      { id: 3, variants: [{ id: 103, next: null }] }
    ]
    expect(findParentId(nodes, 3)).toBe(1)
  })

  it('should handle empty nodes', () => {
    expect(findParentId([], 1)).toBe(null)
    expect(findParentId(null, 1)).toBe(null)
  })
})

describe('validateTree', () => {
  it('should return ok for valid tree', () => {
    const nodes = [
      { id: 1, variants: [{ id: 101, next: 2 }] },
      { id: 2, variants: [{ id: 102, next: null }] }
    ]
    const result = validateTree(nodes, 1)
    expect(result.ok).toBe(true)
    expect(result.problems).toHaveLength(0)
  })

  it('should detect duplicate node ids', () => {
    const nodes = [
      { id: 1, variants: [{ id: 101, next: null }] },
      { id: 1, variants: [{ id: 102, next: null }] }
    ]
    const result = validateTree(nodes, 1)
    expect(result.ok).toBe(false)
    expect(result.problems.some(p => p.includes('Duplicate'))).toBe(true)
    expect(result.details.duplicateNodeIds).toContain(1)
  })

  it('should detect missing target nodes', () => {
    const nodes = [
      { id: 1, variants: [{ id: 101, next: 999 }] }
    ]
    const result = validateTree(nodes, 1)
    expect(result.ok).toBe(false)
    expect(result.problems.some(p => p.includes('missing'))).toBe(true)
    expect(result.details.missingTargets.has(999)).toBe(true)
  })

  it('should detect multiple parents (merge)', () => {
    const nodes = [
      { id: 1, variants: [{ id: 101, next: 3 }] },
      { id: 2, variants: [{ id: 102, next: 3 }] },
      { id: 3, variants: [{ id: 103, next: null }] }
    ]
    const result = validateTree(nodes, 1)
    expect(result.ok).toBe(false)
    expect(result.problems.some(p => p.includes('Merge'))).toBe(true)
    expect(result.details.multipleParents.has(3)).toBe(true)
  })

  it('should detect cycles', () => {
    const nodes = [
      { id: 1, variants: [{ id: 101, next: 2 }] },
      { id: 2, variants: [{ id: 102, next: 1 }] }
    ]
    const result = validateTree(nodes, 1)
    expect(result.ok).toBe(false)
    expect(result.problems.some(p => p.includes('Cycle'))).toBe(true)
    expect(result.details.cycles.length).toBeGreaterThan(0)
  })

  it('should detect root not found', () => {
    const nodes = [
      { id: 1, variants: [{ id: 101, next: null }] }
    ]
    const result = validateTree(nodes, 999)
    expect(result.ok).toBe(false)
    expect(result.problems.some(p => p.includes('Root id'))).toBe(true)
  })

  it('should detect root with parent', () => {
    const nodes = [
      { id: 1, variants: [{ id: 101, next: 2 }] },
      { id: 2, variants: [{ id: 102, next: null }] }
    ]
    const result = validateTree(nodes, 2)
    expect(result.ok).toBe(false)
    expect(result.problems.some(p => p.includes('Root node has'))).toBe(true)
  })

  it('should detect multiple roots', () => {
    const nodes = [
      { id: 1, variants: [{ id: 101, next: null }] },
      { id: 2, variants: [{ id: 102, next: null }] }
    ]
    const result = validateTree(nodes, 1)
    expect(result.ok).toBe(false)
    expect(result.problems.some(p => p.includes('Multiple roots'))).toBe(true)
  })

  it('should detect unreachable nodes', () => {
    const nodes = [
      { id: 1, variants: [{ id: 101, next: null }] },
      { id: 2, variants: [{ id: 102, next: null }] }
    ]
    const result = validateTree(nodes, 1)
    expect(result.ok).toBe(false)
    expect(result.details.unreachableFromRoot.has(2)).toBe(true)
  })

  it('should handle empty nodes', () => {
    const result = validateTree([], null)
    expect(result.ok).toBe(true)
  })
})

describe('enforceUniqueParents', () => {
  it('should preserve valid tree', () => {
    const nodes = [
      { id: 1, variants: [{ id: 101, next: 2 }] },
      { id: 2, variants: [{ id: 102, next: null }] }
    ]
    const result = enforceUniqueParents(nodes, 1)
    expect(result).toHaveLength(2)
    expect(result[0].variants[0].next).toBe(2)
  })

  it('should fix multiple parents by nulling extra edges', () => {
    const nodes = [
      { id: 1, variants: [{ id: 101, next: 3 }] },
      { id: 2, variants: [{ id: 102, next: 3 }] },
      { id: 3, variants: [{ id: 103, next: null }] }
    ]
    const result = enforceUniqueParents(nodes, 1)
    const edges = result.flatMap(n =>
      n.variants.filter(v => v.next === 3)
    )
    expect(edges).toHaveLength(1)
  })

  it('should prefer keeping edge on visible path', () => {
    const nodes = [
      { id: 1, active: 0, variants: [{ id: 101, next: 3 }] },
      { id: 2, variants: [{ id: 102, next: 3 }] },
      { id: 3, variants: [{ id: 103, next: null }] }
    ]
    const result = enforceUniqueParents(nodes, 1)
    const node1 = result.find(n => n.id === 1)
    const node2 = result.find(n => n.id === 2)
    expect(node1.variants[0].next).toBe(3)
    expect(node2.variants[0].next).toBe(null)
  })

  it('should keep first edge if none on visible path', () => {
    const nodes = [
      { id: 1, variants: [{ id: 101, next: null }] },
      { id: 2, variants: [{ id: 102, next: 4 }] },
      { id: 3, variants: [{ id: 103, next: 4 }] },
      { id: 4, variants: [{ id: 104, next: null }] }
    ]
    const result = enforceUniqueParents(nodes, 1)
    const node2 = result.find(n => n.id === 2)
    const node3 = result.find(n => n.id === 3)
    expect(node2.variants[0].next).toBe(4)
    expect(node3.variants[0].next).toBe(null)
  })

  it('should not mutate original nodes', () => {
    const nodes = [
      { id: 1, variants: [{ id: 101, next: 3 }] },
      { id: 2, variants: [{ id: 102, next: 3 }] },
      { id: 3, variants: [{ id: 103, next: null }] }
    ]
    enforceUniqueParents(nodes, 1)
    expect(nodes[1].variants[0].next).toBe(3) // original unchanged
  })

  it('should handle empty nodes', () => {
    expect(enforceUniqueParents([], 1)).toEqual([])
    expect(enforceUniqueParents(null, 1)).toEqual([])
  })

  it('should handle nodes without variants', () => {
    const nodes = [{ id: 1 }]
    const result = enforceUniqueParents(nodes, 1)
    expect(result).toHaveLength(1)
  })

  it('should handle multiple variants in same node pointing to same target', () => {
    const nodes = [
      {
        id: 1,
        variants: [
          { id: 101, next: 2 },
          { id: 102, next: 2 }
        ]
      },
      { id: 2, variants: [{ id: 103, next: null }] }
    ]
    const result = enforceUniqueParents(nodes, 1)
    const node1 = result.find(n => n.id === 1)
    const pointingTo2 = node1.variants.filter(v => v.next === 2)
    expect(pointingTo2).toHaveLength(1)
  })
})