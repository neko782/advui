import { describe, it, expect } from 'vitest'
import {
  clampActiveIndex,
  normalizeNodeActive,
  normalizeNodesActive,
  validateRootId,
  buildVisible,
  enforceUniqueParents,
  enforceUniqueParentsWithInfo,
  validateTree,
} from './branching.js'

describe('clampActiveIndex', () => {
  it('should return 0 for empty variants', () => {
    expect(clampActiveIndex({ id: 1, variants: [], active: 5 })).toBe(0)
  })

  it('should clamp active to max valid index', () => {
    const node = { id: 1, variants: [{ id: 1 }, { id: 2 }], active: 10 }
    expect(clampActiveIndex(node)).toBe(1) // max is length-1
  })

  it('should clamp negative to 0', () => {
    const node = { id: 1, variants: [{ id: 1 }], active: -5 }
    expect(clampActiveIndex(node)).toBe(0)
  })

  it('should return valid active unchanged', () => {
    const node = { id: 1, variants: [{ id: 1 }, { id: 2 }, { id: 3 }], active: 1 }
    expect(clampActiveIndex(node)).toBe(1)
  })
})

describe('normalizeNodeActive', () => {
  it('should return same node if active is valid', () => {
    const node = { id: 1, variants: [{ id: 1 }, { id: 2 }], active: 1 }
    expect(normalizeNodeActive(node)).toBe(node)
  })

  it('should return new node with clamped active', () => {
    const node = { id: 1, variants: [{ id: 1 }, { id: 2 }], active: 5 }
    const result = normalizeNodeActive(node)
    expect(result).not.toBe(node)
    expect(result.active).toBe(1)
  })
})

describe('normalizeNodesActive', () => {
  it('should return same array if all nodes valid', () => {
    const nodes = [
      { id: 1, variants: [{ id: 1 }], active: 0 },
      { id: 2, variants: [{ id: 2 }, { id: 3 }], active: 1 },
    ]
    expect(normalizeNodesActive(nodes)).toBe(nodes)
  })

  it('should return new array with fixed nodes', () => {
    const nodes = [
      { id: 1, variants: [{ id: 1 }], active: 0 },
      { id: 2, variants: [{ id: 2 }], active: 5 }, // invalid
    ]
    const result = normalizeNodesActive(nodes)
    expect(result).not.toBe(nodes)
    expect(result[1].active).toBe(0)
  })
})

describe('validateRootId', () => {
  it('should return null rootId for empty nodes', () => {
    const result = validateRootId([], 1)
    expect(result.rootId).toBe(null)
    expect(result.corrected).toBe(true)
  })

  it('should keep valid rootId with no incoming edges', () => {
    const nodes = [
      { id: 1, variants: [{ id: 1, next: 2 }], active: 0 },
      { id: 2, variants: [{ id: 2, next: null }], active: 0 },
    ]
    const result = validateRootId(nodes, 1)
    expect(result.rootId).toBe(1)
    expect(result.corrected).toBe(false)
  })

  it('should correct rootId that has incoming edges', () => {
    const nodes = [
      { id: 1, variants: [{ id: 1, next: 2 }], active: 0 },
      { id: 2, variants: [{ id: 2, next: null }], active: 0 },
    ]
    // Node 2 has incoming edge from node 1, so it shouldn't be root
    const result = validateRootId(nodes, 2)
    expect(result.rootId).toBe(1) // corrected to node 1
    expect(result.corrected).toBe(true)
  })

  it('should find a valid root when given non-existent rootId', () => {
    const nodes = [
      { id: 1, variants: [{ id: 1, next: null }], active: 0 },
    ]
    const result = validateRootId(nodes, 999)
    expect(result.rootId).toBe(1)
    expect(result.corrected).toBe(true)
  })
})

describe('buildVisible with clamped active', () => {
  it('should use clamped active index when out of bounds', () => {
    const nodes = [
      { id: 1, variants: [{ id: 1, role: 'system', content: 'sys', next: null }], active: 10 },
    ]
    const visible = buildVisible(nodes, 1)
    expect(visible.length).toBe(1)
    expect(visible[0].variantIndex).toBe(0) // clamped from 10 to 0
  })
})

describe('enforceUniqueParentsWithInfo', () => {
  it('should return mutated=false for valid tree', () => {
    const nodes = [
      { id: 1, variants: [{ id: 1, next: 2 }], active: 0 },
      { id: 2, variants: [{ id: 2, next: null }], active: 0 },
    ]
    const result = enforceUniqueParentsWithInfo(nodes, 1)
    expect(result.mutated).toBe(false)
    expect(result.clearedEdges).toHaveLength(0)
  })

  it('should report cleared edges for multiple parents', () => {
    const nodes = [
      { id: 1, variants: [{ id: 1, next: 3 }], active: 0 },
      { id: 2, variants: [{ id: 2, next: 3 }], active: 0 }, // also points to 3
      { id: 3, variants: [{ id: 3, next: null }], active: 0 },
    ]
    const result = enforceUniqueParentsWithInfo(nodes, 1)
    expect(result.mutated).toBe(true)
    expect(result.clearedEdges.length).toBeGreaterThan(0)
    expect(result.clearedEdges[0].toNodeId).toBe(3)
  })

  it('should prefer keeping edge on visible path', () => {
    const nodes = [
      { id: 1, variants: [{ id: 1, next: 3 }], active: 0 }, // on visible path
      { id: 2, variants: [{ id: 2, next: 3 }], active: 0 }, // not on path
      { id: 3, variants: [{ id: 3, next: null }], active: 0 },
    ]
    const result = enforceUniqueParentsWithInfo(nodes, 1)
    
    // Edge from node 2 should be cleared (not on visible path from root 1)
    const clearedFromNode2 = result.clearedEdges.filter(e => e.fromNodeId === 2)
    expect(clearedFromNode2.length).toBe(1)
    
    // Node 1's edge should be preserved
    const node1 = result.nodes.find(n => n.id === 1)
    expect(node1.variants[0].next).toBe(3)
  })
})

describe('validateTree', () => {
  it('should detect cycles', () => {
    const nodes = [
      { id: 1, variants: [{ id: 1, next: 2 }], active: 0 },
      { id: 2, variants: [{ id: 2, next: 1 }], active: 0 }, // cycle back to 1
    ]
    const result = validateTree(nodes, 1)
    expect(result.ok).toBe(false)
    expect(result.details.cycles.length).toBeGreaterThan(0)
  })

  it('should detect duplicate node IDs', () => {
    const nodes = [
      { id: 1, variants: [{ id: 1, next: null }], active: 0 },
      { id: 1, variants: [{ id: 2, next: null }], active: 0 }, // duplicate
    ]
    const result = validateTree(nodes, 1)
    expect(result.ok).toBe(false)
    expect(result.details.duplicateNodeIds).toContain(1)
  })

  it('should detect unreachable nodes', () => {
    const nodes = [
      { id: 1, variants: [{ id: 1, next: null }], active: 0 },
      { id: 2, variants: [{ id: 2, next: null }], active: 0 }, // not reachable from 1
    ]
    const result = validateTree(nodes, 1)
    expect(result.ok).toBe(false)
    expect(result.details.unreachableFromRoot.has(2)).toBe(true)
  })

  it('should pass for valid tree', () => {
    const nodes = [
      { id: 1, variants: [{ id: 1, next: 2 }], active: 0 },
      { id: 2, variants: [{ id: 2, next: null }], active: 0 },
    ]
    const result = validateTree(nodes, 1)
    expect(result.ok).toBe(true)
  })
})
