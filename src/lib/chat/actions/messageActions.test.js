import { describe, it, expect } from 'vitest'
import { deleteMessage, setMessageRole, moveUp, moveDown } from './messageActions.js'

describe('deleteMessage', () => {
  it('should delete a message and connect parent to the next branch', () => {
    const nodes = [
      { id: 1, active: 0, variants: [{ id: 1, role: 'system', content: 'sys', next: 2 }] },
      { id: 2, active: 0, variants: [{ id: 2, role: 'user', content: 'hi', next: 3 }] },
      { id: 3, active: 0, variants: [{ id: 3, role: 'assistant', content: 'hello', next: null }] }
    ]
    const rootId = 1

    const result = deleteMessage(nodes, rootId, 2)

    expect(result.nodes).toHaveLength(2)
    expect(result.nodes.find(n => n.id === 2)).toBeUndefined()
    const rootNode = result.nodes.find(n => n.id === 1)
    expect(rootNode.variants[0].next).toBe(3)
  })

  it('should delete root node and clear root when no successors', () => {
    const nodes = [
      { id: 1, active: 0, variants: [{ id: 1, role: 'system', content: 'hi', next: null }] }
    ]
    const rootId = 1

    const result = deleteMessage(nodes, rootId, 1)

    expect(result.nodes).toHaveLength(0)
    expect(result.rootId).toBeNull()
  })

  it('should delete root node and promote next node to root', () => {
    const nodes = [
      { id: 1, active: 0, variants: [{ id: 1, role: 'system', content: 'sys', next: 2 }] },
      { id: 2, active: 0, variants: [{ id: 2, role: 'user', content: 'hi', next: 3 }] },
      { id: 3, active: 0, variants: [{ id: 3, role: 'assistant', content: 'hello', next: null }] }
    ]
    const rootId = 1

    const result = deleteMessage(nodes, rootId, 1)

    expect(result.nodes).toHaveLength(2)
    expect(result.rootId).toBe(2)
    const promoted = result.nodes.find(n => n.id === 2)
    expect(promoted.variants[0].next).toBe(3)
  })

  it('should return unchanged if message not found', () => {
    const nodes = [
      { id: 1, active: 0, variants: [{ id: 1, role: 'user', content: 'hi', next: null }] }
    ]
    const rootId = 1

    const result = deleteMessage(nodes, rootId, 999)

    expect(result.nodes).toEqual(nodes)
    expect(result.rootId).toBe(rootId)
  })

  it('should drop alternate branches while keeping the active continuation', () => {
    const nodes = [
      { id: 1, active: 0, variants: [{ id: 10, role: 'system', content: 'sys', next: 2 }] },
      {
        id: 2,
        active: 0,
        variants: [
          { id: 20, role: 'assistant', content: 'branch 1', next: 3 },
          { id: 21, role: 'assistant', content: 'branch 2', next: 4 }
        ]
      },
      { id: 3, active: 0, variants: [{ id: 30, role: 'user', content: 'follow 1', next: null }] },
      { id: 4, active: 0, variants: [{ id: 40, role: 'user', content: 'follow 2', next: null }] }
    ]
    const rootId = 1

    const result = deleteMessage(nodes, rootId, 20)

    expect(result.nodes.map(n => n.id)).toEqual([1, 3])
    const rootNode = result.nodes.find(n => n.id === 1)
    expect(rootNode.variants[0].next).toBe(3)
  })

  it('should clean dangling next pointers', () => {
    const nodes = [
      { id: 1, active: 0, variants: [{ id: 1, role: 'user', content: 'hi', next: 2 }] },
      { id: 2, active: 0, variants: [{ id: 2, role: 'assistant', content: 'hello', next: 3 }] },
      { id: 3, active: 0, variants: [{ id: 3, role: 'user', content: 'bye', next: null }] }
    ]
    const rootId = 1

    const result = deleteMessage(nodes, rootId, 3)

    expect(result.nodes).toHaveLength(2)
    const parent = result.nodes.find(n => n.id === 2)
    expect(parent.variants[0].next).toBeNull()
  })

  it('should choose new root from remaining nodes without parents', () => {
    const nodes = [
      { id: 1, active: 0, variants: [{ id: 10, role: 'system', content: 'root', next: null }] },
      { id: 3, active: 0, variants: [{ id: 30, role: 'user', content: 'orphan', next: null }] }
    ]
    const rootId = 1

    const result = deleteMessage(nodes, rootId, 10)

    expect(result.nodes).toHaveLength(1)
    expect(result.nodes[0].id).toBe(3)
    expect(result.rootId).toBe(3)
  })
})

describe('setMessageRole', () => {
  it('should change message role', () => {
    const nodes = [
      { id: 1, active: 0, variants: [{ id: 1, role: 'user', content: 'test', next: null }] }
    ]

    const result = setMessageRole(nodes, 1, 'assistant')

    expect(result[0].variants[0].role).toBe('assistant')
    expect(result[0].variants[0].content).toBe('test')
  })

  it('should only change the specified variant', () => {
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

    const result = setMessageRole(nodes, 2, 'assistant')

    expect(result[0].variants[0].role).toBe('user')
    expect(result[0].variants[1].role).toBe('assistant')
  })

  it('should reject invalid roles', () => {
    const nodes = [
      { id: 1, active: 0, variants: [{ id: 1, role: 'user', content: 'test', next: null }] }
    ]

    const result = setMessageRole(nodes, 1, 'invalid-role')

    expect(result).toEqual(nodes)
  })

  it('should return unchanged if variant not found', () => {
    const nodes = [
      { id: 1, active: 0, variants: [{ id: 1, role: 'user', content: 'test', next: null }] }
    ]

    const result = setMessageRole(nodes, 999, 'assistant')

    expect(result).toEqual(nodes)
  })

  it('should handle empty nodes array', () => {
    const nodes = []

    const result = setMessageRole(nodes, 1, 'assistant')

    expect(result).toEqual([])
  })
})

describe('moveUp', () => {
  it('should move message up in sequence', () => {
    const nodes = [
      { id: 1, active: 0, variants: [{ id: 1, role: 'user', content: 'first', next: 2 }] },
      { id: 2, active: 0, variants: [{ id: 2, role: 'assistant', content: 'second', next: 3 }] },
      { id: 3, active: 0, variants: [{ id: 3, role: 'user', content: 'third', next: null }] }
    ]
    const rootId = 1

    const result = moveUp(nodes, rootId, 2)

    // Message 2 should now come before message 1
    expect(result.rootId).toBe(2)
    expect(result.nodes.find(n => n.id === 2).variants[0].next).toBe(1)
    expect(result.nodes.find(n => n.id === 1).variants[0].next).toBe(3)
  })

  it('should not move first message up', () => {
    const nodes = [
      { id: 1, active: 0, variants: [{ id: 1, role: 'user', content: 'first', next: 2 }] },
      { id: 2, active: 0, variants: [{ id: 2, role: 'assistant', content: 'second', next: null }] }
    ]
    const rootId = 1

    const result = moveUp(nodes, rootId, 1)

    expect(result.nodes).toEqual(nodes)
    expect(result.rootId).toBe(rootId)
  })

  it('should not move typing message', () => {
    const nodes = [
      { id: 1, active: 0, variants: [{ id: 1, role: 'user', content: 'first', next: 2 }] },
      { id: 2, active: 0, variants: [{ id: 2, role: 'assistant', content: 'typing', typing: true, next: null }] }
    ]
    const rootId = 1

    const result = moveUp(nodes, rootId, 2)

    expect(result.nodes).toEqual(nodes)
    expect(result.rootId).toBe(rootId)
  })

  it('should handle moving message up when there are 3+ messages', () => {
    const nodes = [
      { id: 1, active: 0, variants: [{ id: 1, role: 'user', content: 'first', next: 2 }] },
      { id: 2, active: 0, variants: [{ id: 2, role: 'assistant', content: 'second', next: 3 }] },
      { id: 3, active: 0, variants: [{ id: 3, role: 'user', content: 'third', next: 4 }] },
      { id: 4, active: 0, variants: [{ id: 4, role: 'assistant', content: 'fourth', next: null }] }
    ]
    const rootId = 1

    const result = moveUp(nodes, rootId, 3)

    // Message 3 should swap with message 2
    expect(result.nodes.find(n => n.id === 1).variants[0].next).toBe(3)
    expect(result.nodes.find(n => n.id === 3).variants[0].next).toBe(2)
    expect(result.nodes.find(n => n.id === 2).variants[0].next).toBe(4)
  })

  it('should return unchanged if message not found', () => {
    const nodes = [
      { id: 1, active: 0, variants: [{ id: 1, role: 'user', content: 'first', next: null }] }
    ]
    const rootId = 1

    const result = moveUp(nodes, rootId, 999)

    expect(result.nodes).toEqual(nodes)
    expect(result.rootId).toBe(rootId)
  })
})

describe('moveDown', () => {
  it('should move message down in sequence', () => {
    const nodes = [
      { id: 1, active: 0, variants: [{ id: 1, role: 'user', content: 'first', next: 2 }] },
      { id: 2, active: 0, variants: [{ id: 2, role: 'assistant', content: 'second', next: 3 }] },
      { id: 3, active: 0, variants: [{ id: 3, role: 'user', content: 'third', next: null }] }
    ]
    const rootId = 1

    const result = moveDown(nodes, rootId, 1)

    // Message 1 should now come after message 2
    expect(result.rootId).toBe(2)
    expect(result.nodes.find(n => n.id === 2).variants[0].next).toBe(1)
    expect(result.nodes.find(n => n.id === 1).variants[0].next).toBe(3)
  })

  it('should not move last message down', () => {
    const nodes = [
      { id: 1, active: 0, variants: [{ id: 1, role: 'user', content: 'first', next: 2 }] },
      { id: 2, active: 0, variants: [{ id: 2, role: 'assistant', content: 'second', next: null }] }
    ]
    const rootId = 1

    const result = moveDown(nodes, rootId, 2)

    expect(result.nodes).toEqual(nodes)
    expect(result.rootId).toBe(rootId)
  })

  it('should not move typing message', () => {
    const nodes = [
      { id: 1, active: 0, variants: [{ id: 1, role: 'user', content: 'first', typing: true, next: 2 }] },
      { id: 2, active: 0, variants: [{ id: 2, role: 'assistant', content: 'second', next: null }] }
    ]
    const rootId = 1

    const result = moveDown(nodes, rootId, 1)

    expect(result.nodes).toEqual(nodes)
    expect(result.rootId).toBe(rootId)
  })

  it('should handle moving message down when there are 3+ messages', () => {
    const nodes = [
      { id: 1, active: 0, variants: [{ id: 1, role: 'user', content: 'first', next: 2 }] },
      { id: 2, active: 0, variants: [{ id: 2, role: 'assistant', content: 'second', next: 3 }] },
      { id: 3, active: 0, variants: [{ id: 3, role: 'user', content: 'third', next: 4 }] },
      { id: 4, active: 0, variants: [{ id: 4, role: 'assistant', content: 'fourth', next: null }] }
    ]
    const rootId = 1

    const result = moveDown(nodes, rootId, 2)

    // Message 2 should swap with message 3
    expect(result.nodes.find(n => n.id === 1).variants[0].next).toBe(3)
    expect(result.nodes.find(n => n.id === 3).variants[0].next).toBe(2)
    expect(result.nodes.find(n => n.id === 2).variants[0].next).toBe(4)
  })

  it('should return unchanged if message not found', () => {
    const nodes = [
      { id: 1, active: 0, variants: [{ id: 1, role: 'user', content: 'first', next: null }] }
    ]
    const rootId = 1

    const result = moveDown(nodes, rootId, 999)

    expect(result.nodes).toEqual(nodes)
    expect(result.rootId).toBe(rootId)
  })

  it('should handle moving second-to-last message', () => {
    const nodes = [
      { id: 1, active: 0, variants: [{ id: 1, role: 'user', content: 'first', next: 2 }] },
      { id: 2, active: 0, variants: [{ id: 2, role: 'assistant', content: 'second', next: 3 }] },
      { id: 3, active: 0, variants: [{ id: 3, role: 'user', content: 'third', next: null }] }
    ]
    const rootId = 1

    const result = moveDown(nodes, rootId, 2)

    expect(result.nodes.find(n => n.id === 1).variants[0].next).toBe(3)
    expect(result.nodes.find(n => n.id === 3).variants[0].next).toBe(2)
    expect(result.nodes.find(n => n.id === 2).variants[0].next).toBeNull()
  })
})
