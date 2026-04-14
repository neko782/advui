import { describe, expect, it } from 'vitest'
import { deleteMessage } from '../actions/messageActions.js'
import { validateChatEdit } from './chatEditGuard.js'

describe('validateChatEdit', () => {
  it('allows deleting an inserted message only when the mutation is explicit', () => {
    const before = {
      nodes: [
        { id: 1, active: 0, variants: [{ id: 1, role: 'system', content: 'sys', next: 2 }] },
        { id: 2, active: 0, variants: [{ id: 2, role: 'user', content: 'before', next: 5 }] },
        { id: 5, active: 0, variants: [{ id: 8, role: 'user', content: '', next: 3 }] },
        { id: 3, active: 0, variants: [{ id: 3, role: 'assistant', content: 'after', next: null }] },
      ],
      rootId: 1,
      nextId: 9,
      nextNodeId: 6,
    }

    const deleted = deleteMessage(before.nodes, before.rootId, 8)
    const after = {
      ...before,
      nodes: deleted.nodes,
      rootId: deleted.rootId,
    }

    const guarded = validateChatEdit(before, after, { label: 'delete inserted 8' })
    expect(guarded.ok).toBe(false)
    expect(guarded.notice).toContain('without an explicit delete')

    const explicit = validateChatEdit(before, after, { label: 'delete inserted 8', allowDelete: true })
    expect(explicit.ok).toBe(true)
  })
})
