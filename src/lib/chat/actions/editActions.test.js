import { describe, it, expect } from 'vitest'
import { commitEditReplace, applyEditBranch, prepareBranchAndSend } from './editActions.js'

describe('commitEditReplace', () => {
  it('should replace variant content', () => {
    const nodes = [
      { id: 1, active: 0, variants: [{ id: 1, role: 'user', content: 'old text', next: null }] }
    ]

    const result = commitEditReplace(nodes, 1, 'new text')

    expect(result[0].variants[0].content).toBe('new text')
    expect(result[0].variants[0].error).toBeUndefined()
  })

  it('should clear error when editing', () => {
    const nodes = [
      { id: 1, active: 0, variants: [{ id: 1, role: 'user', content: 'text', error: 'Some error', next: null }] }
    ]

    const result = commitEditReplace(nodes, 1, 'updated text')

    expect(result[0].variants[0].content).toBe('updated text')
    expect(result[0].variants[0].error).toBeUndefined()
  })

  it('should convert editing text to string', () => {
    const nodes = [
      { id: 1, active: 0, variants: [{ id: 1, role: 'user', content: 'old', next: null }] }
    ]

    const result = commitEditReplace(nodes, 1, 123)

    expect(result[0].variants[0].content).toBe('123')
  })

  it('should return unchanged if editingId is null', () => {
    const nodes = [
      { id: 1, active: 0, variants: [{ id: 1, role: 'user', content: 'text', next: null }] }
    ]

    const result = commitEditReplace(nodes, null, 'new text')

    expect(result).toEqual(nodes)
  })

  it('should only update the specified variant', () => {
    const nodes = [
      {
        id: 1,
        active: 0,
        variants: [
          { id: 1, role: 'user', content: 'first', next: null },
          { id: 2, role: 'user', content: 'second', next: null }
        ]
      }
    ]

    const result = commitEditReplace(nodes, 2, 'updated')

    expect(result[0].variants[0].content).toBe('first')
    expect(result[0].variants[1].content).toBe('updated')
  })
})

describe('applyEditBranch', () => {
  it('should create a new variant with edited content', () => {
    const nodes = [
      { id: 1, active: 0, variants: [{ id: 1, role: 'user', content: 'original', next: 2 }] }
    ]

    const result = applyEditBranch(nodes, 1, 'branched', 10)

    expect(result.nodes[0].variants).toHaveLength(2)
    expect(result.nodes[0].variants[1].id).toBe(10)
    expect(result.nodes[0].variants[1].content).toBe('branched')
    expect(result.nodes[0].variants[1].next).toBeNull()
    expect(result.nodes[0].active).toBe(1)
    expect(result.nextId).toBe(11)
  })

  it('should not inherit next pointer from original variant', () => {
    const nodes = [
      { id: 1, active: 0, variants: [{ id: 1, role: 'user', content: 'original', next: 5 }] }
    ]

    const result = applyEditBranch(nodes, 1, 'branched', 10)

    expect(result.nodes[0].variants[1].next).toBeNull()
  })

  it('should preserve other properties except id, time, typing, error, next', () => {
    const nodes = [
      {
        id: 1,
        active: 0,
        variants: [{
          id: 1,
          role: 'user',
          content: 'original',
          next: 2,
          customProp: 'should-be-preserved'
        }]
      }
    ]

    const result = applyEditBranch(nodes, 1, 'branched', 10)

    expect(result.nodes[0].variants[1].customProp).toBe('should-be-preserved')
    expect(result.nodes[0].variants[1].typing).toBe(false)
  })

  it('should return unchanged if editingId is null', () => {
    const nodes = [
      { id: 1, active: 0, variants: [{ id: 1, role: 'user', content: 'text', next: null }] }
    ]

    const result = applyEditBranch(nodes, null, 'new', 10)

    expect(result.nodes).toEqual(nodes)
    expect(result.nextId).toBe(10)
  })

  it('should return unchanged if variant not found', () => {
    const nodes = [
      { id: 1, active: 0, variants: [{ id: 1, role: 'user', content: 'text', next: null }] }
    ]

    const result = applyEditBranch(nodes, 999, 'new', 10)

    expect(result.nodes).toEqual(nodes)
    expect(result.nextId).toBe(10)
  })

  it('should set time to current timestamp', () => {
    const nodes = [
      { id: 1, active: 0, variants: [{ id: 1, role: 'user', content: 'original', next: null }] }
    ]

    const before = Date.now()
    const result = applyEditBranch(nodes, 1, 'branched', 10)
    const after = Date.now()

    const newVariant = result.nodes[0].variants[1]
    expect(newVariant.time).toBeGreaterThanOrEqual(before)
    expect(newVariant.time).toBeLessThanOrEqual(after)
  })
})

describe('prepareBranchAndSend', () => {
  it('should return refresh-only when no change on last message', () => {
    const nodes = [
      { id: 1, active: 0, variants: [{ id: 1, role: 'user', content: 'hello', next: null }] }
    ]
    const rootId = 1

    const result = prepareBranchAndSend(nodes, rootId, 1, 'hello', 10, 2)

    expect(result.shouldRefreshOnly).toBe(true)
    expect(result.insertIndex).toBe(0)
    expect(result.nodes).toEqual(nodes)
    expect(result.nextId).toBe(10)
  })

  it('should branch when content changes on last message', () => {
    const nodes = [
      { id: 1, active: 0, variants: [{ id: 1, role: 'user', content: 'hello', next: null }] }
    ]
    const rootId = 1

    const result = prepareBranchAndSend(nodes, rootId, 1, 'goodbye', 10, 2)

    expect(result.shouldRefreshOnly).toBe(false)
    expect(result.nodes[0].variants).toHaveLength(2)
    expect(result.nodes[0].variants[1].content).toBe('goodbye')
    expect(result.nodes[0].active).toBe(1)
  })

  it('should add typing node after branched variant', () => {
    const nodes = [
      { id: 1, active: 0, variants: [{ id: 1, role: 'user', content: 'hello', next: null }] }
    ]
    const rootId = 1

    const result = prepareBranchAndSend(nodes, rootId, 1, 'goodbye', 10, 2)

    expect(result.nodes).toHaveLength(2)
    const typingNode = result.nodes[1]
    expect(typingNode.id).toBe(2)
    expect(typingNode.variants[0].typing).toBe(true)
    expect(typingNode.variants[0].role).toBe('assistant')
    expect(result.typingVariantId).toBe(11)
  })

  it('should link branched variant to typing node', () => {
    const nodes = [
      { id: 1, active: 0, variants: [{ id: 1, role: 'user', content: 'hello', next: null }] }
    ]
    const rootId = 1

    const result = prepareBranchAndSend(nodes, rootId, 1, 'goodbye', 10, 2)

    const branchedVariant = result.nodes[0].variants[1]
    expect(branchedVariant.next).toBe(2)
  })

  it('should build history up to edited message', () => {
    const nodes = [
      { id: 1, active: 0, variants: [{ id: 1, role: 'user', content: 'first', next: 2 }] },
      { id: 2, active: 0, variants: [{ id: 2, role: 'assistant', content: 'second', next: 3 }] },
      { id: 3, active: 0, variants: [{ id: 3, role: 'user', content: 'third', next: null }] }
    ]
    const rootId = 1

    const result = prepareBranchAndSend(nodes, rootId, 2, 'edited second', 10, 4)

    expect(result.history).toHaveLength(2)
    expect(result.history[0].content).toBe('first')
    expect(result.history[1].content).toBe('edited second')
  })

  it('should filter out typing messages from history', () => {
    const nodes = [
      { id: 1, active: 0, variants: [{ id: 1, role: 'user', content: 'first', next: 2 }] },
      { id: 2, active: 0, variants: [{ id: 2, role: 'assistant', content: 'typing', typing: true, next: null }] }
    ]
    const rootId = 1

    const result = prepareBranchAndSend(nodes, rootId, 1, 'edited first', 10, 3)

    expect(result.history).toHaveLength(1)
    expect(result.history[0].content).toBe('edited first')
  })

  it('should return null if editingId not found', () => {
    const nodes = [
      { id: 1, active: 0, variants: [{ id: 1, role: 'user', content: 'hello', next: null }] }
    ]
    const rootId = 1

    const result = prepareBranchAndSend(nodes, rootId, 999, 'text', 10, 2)

    expect(result).toBeNull()
  })

  it('should return null if editingId is null', () => {
    const nodes = [
      { id: 1, active: 0, variants: [{ id: 1, role: 'user', content: 'hello', next: null }] }
    ]
    const rootId = 1

    const result = prepareBranchAndSend(nodes, rootId, null, 'text', 10, 2)

    expect(result).toBeNull()
  })

  it('should increment nextId and nextNodeId correctly', () => {
    const nodes = [
      { id: 1, active: 0, variants: [{ id: 1, role: 'user', content: 'hello', next: null }] }
    ]
    const rootId = 1

    const result = prepareBranchAndSend(nodes, rootId, 1, 'goodbye', 10, 2)

    expect(result.nextId).toBe(12) // 10 for branched variant, 11 for typing variant
    expect(result.nextNodeId).toBe(3) // 2 for typing node
  })

  it('should initialize typing node with reasoning summary fields', () => {
    const nodes = [
      { id: 1, active: 0, variants: [{ id: 1, role: 'user', content: 'hello', next: null }] }
    ]
    const rootId = 1

    const result = prepareBranchAndSend(nodes, rootId, 1, 'goodbye', 10, 2)

    const typingVariant = result.nodes[1].variants[0]
    expect(typingVariant.reasoningSummary).toBe('')
    expect(typingVariant.reasoningSummaryLoading).toBe(true)
  })

  it('should branch even when editing middle message', () => {
    const nodes = [
      { id: 1, active: 0, variants: [{ id: 1, role: 'user', content: 'first', next: 2 }] },
      { id: 2, active: 0, variants: [{ id: 2, role: 'assistant', content: 'second', next: 3 }] },
      { id: 3, active: 0, variants: [{ id: 3, role: 'user', content: 'third', next: null }] }
    ]
    const rootId = 1

    const result = prepareBranchAndSend(nodes, rootId, 2, 'edited', 10, 4)

    expect(result.shouldRefreshOnly).toBe(false)
    expect(result.nodes[1].variants).toHaveLength(2)
  })
})