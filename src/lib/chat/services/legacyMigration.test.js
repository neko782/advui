import { describe, it, expect } from 'vitest'
import { migrateLegacyGraphToNodes } from './legacyMigration.js'
import { validateTree, buildVisible } from '../../branching.js'

describe('migrateLegacyGraphToNodes', () => {
  it('should migrate a linear legacy chat', () => {
    const messages = [
      { id: 1, role: 'user', content: 'hello', next: [2] },
      { id: 2, role: 'assistant', content: 'hi there', next: [] }
    ]

    const result = migrateLegacyGraphToNodes(messages, 1, {})

    expect(result.nodes).toHaveLength(2)
    expect(result.rootId).toBe(result.nodes[0].id)
    const visible = buildVisible(result.nodes, result.rootId)
    expect(visible.map(vm => vm.m.content)).toEqual(['hello', 'hi there'])
    expect(validateTree(result.nodes, result.rootId).ok).toBe(true)
  })

  it('should return empty result for no messages', () => {
    const result = migrateLegacyGraphToNodes([], null, null)
    expect(result.nodes).toEqual([])
    expect(result.rootId).toBeNull()
  })

  it('should convert legacy sibling branches into variants of one node', () => {
    // root has two alternative assistant replies; second one selected
    const messages = [
      { id: 1, role: 'user', content: 'question', next: [2, 3] },
      { id: 2, role: 'assistant', content: 'answer A', next: [] },
      { id: 3, role: 'assistant', content: 'answer B', next: [] }
    ]

    const result = migrateLegacyGraphToNodes(messages, 1, { 1: 1 })

    expect(result.nodes).toHaveLength(2)
    const childNode = result.nodes[1]
    expect(childNode.variants).toHaveLength(2)
    expect(childNode.variants.map(v => v.content)).toEqual(['answer A', 'answer B'])
    expect(childNode.active).toBe(1)

    const visible = buildVisible(result.nodes, result.rootId)
    expect(visible.map(vm => vm.m.content)).toEqual(['question', 'answer B'])

    const check = validateTree(result.nodes, result.rootId)
    expect(check.ok).toBe(true)
    expect(check.problems).toEqual([])
  })

  it('should recursively wire each branch subtree and keep selected path active', () => {
    // Branched conversation:
    // 1 -> [2, 3] (selected 0)
    // 2 -> [4]
    // 3 -> [5]
    // 5 -> [6, 7] (selected 1)
    const messages = [
      { id: 1, role: 'user', content: 'root', next: [2, 3] },
      { id: 2, role: 'assistant', content: 'branch A', next: [4] },
      { id: 3, role: 'assistant', content: 'branch B', next: [5] },
      { id: 4, role: 'user', content: 'follow A', next: [] },
      { id: 5, role: 'user', content: 'follow B', next: [6, 7] },
      { id: 6, role: 'assistant', content: 'reply B1', next: [] },
      { id: 7, role: 'assistant', content: 'reply B2', next: [] }
    ]

    const result = migrateLegacyGraphToNodes(messages, 1, { 1: 0, 5: 1 })

    // Every legacy message must be present in the new graph
    const allVariantIds = result.nodes.flatMap(n => n.variants.map(v => v.id)).sort((a, b) => a - b)
    expect(allVariantIds).toEqual([1, 2, 3, 4, 5, 6, 7])

    // The graph must be a valid tree (no orphan roots / detached nodes)
    const check = validateTree(result.nodes, result.rootId)
    expect(check.ok).toBe(true)
    expect(check.problems).toEqual([])

    // Selected path: 1 -> 2 -> 4
    const visible = buildVisible(result.nodes, result.rootId)
    expect(visible.map(vm => vm.m.content)).toEqual(['root', 'branch A', 'follow A'])

    // Non-selected branch keeps its own subtree wired: variant 3 -> node(5) -> node(6,7) active 1
    const branchNode = result.nodes.find(n => n.variants.some(v => v.id === 3))
    const v3 = branchNode.variants.find(v => v.id === 3)
    expect(v3.next).not.toBeNull()
    const node5 = result.nodes.find(n => n.id === v3.next)
    expect(node5.variants[0].id).toBe(5)
    const node67 = result.nodes.find(n => n.id === node5.variants[0].next)
    expect(node67.variants.map(v => v.id)).toEqual([6, 7])
    expect(node67.active).toBe(1)
  })

  it('should clamp invalid selected indices', () => {
    const messages = [
      { id: 1, role: 'user', content: 'q', next: [2, 3] },
      { id: 2, role: 'assistant', content: 'a', next: [] },
      { id: 3, role: 'assistant', content: 'b', next: [] }
    ]

    const result = migrateLegacyGraphToNodes(messages, 1, { 1: 99 })

    expect(result.nodes[1].active).toBe(1)
    expect(validateTree(result.nodes, result.rootId).ok).toBe(true)
  })

  it('should fall back to a parentless message when legacy rootId is missing', () => {
    const messages = [
      { id: 10, role: 'user', content: 'start', next: [11] },
      { id: 11, role: 'assistant', content: 'end', next: [] }
    ]

    const result = migrateLegacyGraphToNodes(messages, null, null)

    const visible = buildVisible(result.nodes, result.rootId)
    expect(visible.map(vm => vm.m.content)).toEqual(['start', 'end'])
    expect(validateTree(result.nodes, result.rootId).ok).toBe(true)
  })

  it('should ignore dangling child references', () => {
    const messages = [
      { id: 1, role: 'user', content: 'q', next: [2, 999] },
      { id: 2, role: 'assistant', content: 'a', next: [] }
    ]

    const result = migrateLegacyGraphToNodes(messages, 1, {})

    expect(result.nodes).toHaveLength(2)
    expect(validateTree(result.nodes, result.rootId).ok).toBe(true)
  })

  it('should survive very deep legacy chains without stack overflow', () => {
    const N = 100000
    const messages = []
    for (let i = 1; i <= N; i++) {
      messages.push({
        id: i,
        role: i % 2 ? 'user' : 'assistant',
        content: `m${i}`,
        next: i < N ? [i + 1] : []
      })
    }

    const result = migrateLegacyGraphToNodes(messages, 1, {})

    expect(result.nodes).toHaveLength(N)
    const visible = buildVisible(result.nodes, result.rootId)
    expect(visible).toHaveLength(N)
  })
})
