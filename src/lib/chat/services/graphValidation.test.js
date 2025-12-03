import { describe, it, expect } from 'vitest'
import {
  sanitizeGraphIfNeeded,
  sanitizeGraphComprehensive,
} from './graphValidation.js'

describe('sanitizeGraphIfNeeded', () => {
  it('should return unchanged nodes in debug mode', () => {
    const nodes = [
      { id: 1, variants: [{ id: 1, next: 2 }], active: 0 },
      { id: 2, variants: [{ id: 2, next: 2 }], active: 0 }, // cycle to self
    ]
    const result = sanitizeGraphIfNeeded(nodes, 1, true)
    expect(result.nodes).toBe(nodes)
    expect(result.notice).toBe('')
  })

  it('should fix multiple parents', () => {
    const nodes = [
      { id: 1, variants: [{ id: 1, next: 3 }], active: 0 },
      { id: 2, variants: [{ id: 2, next: 3 }], active: 0 }, // also points to 3
      { id: 3, variants: [{ id: 3, next: null }], active: 0 },
    ]
    const result = sanitizeGraphIfNeeded(nodes, 1, false)
    expect(result.notice).toContain('multiple parents')
    
    // One of the edges to node 3 should be cleared
    const node1 = result.nodes.find(n => n.id === 1)
    const node2 = result.nodes.find(n => n.id === 2)
    const pointsTo3 = [
      node1?.variants[0]?.next === 3,
      node2?.variants[0]?.next === 3,
    ].filter(Boolean)
    expect(pointsTo3.length).toBe(1)
  })

  it('should return unchanged nodes for valid graph', () => {
    const nodes = [
      { id: 1, variants: [{ id: 1, next: 2 }], active: 0 },
      { id: 2, variants: [{ id: 2, next: null }], active: 0 },
    ]
    const result = sanitizeGraphIfNeeded(nodes, 1, false)
    expect(result.notice).toBe('')
  })
})

describe('sanitizeGraphComprehensive', () => {
  it('should return unchanged in debug mode', () => {
    const nodes = [
      { id: 1, variants: [{ id: 1, next: null }], active: 10 }, // invalid active
    ]
    const result = sanitizeGraphComprehensive(nodes, 1, true)
    expect(result.nodes).toBe(nodes)
    expect(result.mutations.activeIndexNormalized).toBe(false)
  })

  it('should normalize active indices', () => {
    const nodes = [
      { id: 1, variants: [{ id: 1, next: null }], active: 10 },
    ]
    const result = sanitizeGraphComprehensive(nodes, 1, false)
    expect(result.mutations.activeIndexNormalized).toBe(true)
    expect(result.nodes[0].active).toBe(0)
  })

  it('should correct invalid rootId', () => {
    const nodes = [
      { id: 1, variants: [{ id: 1, next: 2 }], active: 0 },
      { id: 2, variants: [{ id: 2, next: null }], active: 0 },
    ]
    // rootId 2 has incoming edge from 1, so it's invalid
    const result = sanitizeGraphComprehensive(nodes, 2, false)
    expect(result.mutations.rootIdCorrected).toBe(true)
  })

  it('should fix multiple parents and report details', () => {
    const nodes = [
      { id: 1, variants: [{ id: 1, next: 3 }], active: 0 },
      { id: 2, variants: [{ id: 2, next: 3 }], active: 0 },
      { id: 3, variants: [{ id: 3, next: null }], active: 0 },
    ]
    const result = sanitizeGraphComprehensive(nodes, 1, false)
    expect(result.mutations.edgesCleared).toBe(1)
    expect(result.mutations.clearedEdgeDetails.length).toBe(1)
    expect(result.mutations.clearedEdgeDetails[0].toNodeId).toBe(3)
  })

  it('should include bug notice in combined fix message', () => {
    const nodes = [
      { id: 1, variants: [{ id: 1, next: 3 }], active: 10 }, // invalid active
      { id: 2, variants: [{ id: 2, next: 3 }], active: 0 }, // multiple parents
      { id: 3, variants: [{ id: 3, next: null }], active: 0 },
    ]
    const result = sanitizeGraphComprehensive(nodes, 1, false)
    expect(result.notice).toContain('Auto-fixed')
    expect(result.notice).toContain('Multiple parents fixed')
  })

  it('should handle all issues together', () => {
    const nodes = [
      { id: 1, variants: [{ id: 1, next: 3 }], active: 5 }, // invalid active
      { id: 2, variants: [{ id: 2, next: 3 }], active: 0 }, // creates multiple parents for 3
      { id: 3, variants: [{ id: 3, next: null }], active: 0 },
    ]
    // Pass invalid rootId
    const result = sanitizeGraphComprehensive(nodes, 999, false)
    
    expect(result.mutations.activeIndexNormalized).toBe(true)
    expect(result.mutations.rootIdCorrected).toBe(true)
    expect(result.mutations.edgesCleared).toBeGreaterThan(0)
    expect(result.nodes[0].active).toBe(0)
  })
})
