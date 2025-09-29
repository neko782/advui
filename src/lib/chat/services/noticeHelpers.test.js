import { describe, it, expect, vi } from 'vitest'
import {
  computeValidationNotice,
  computeGenerationNotice,
  assembleNotice,
  computeFollowingMap
} from './noticeHelpers.js'
import * as branching from '../../branching.js'

vi.mock('../../branching.js', () => ({
  validateTree: vi.fn(),
  buildVisible: vi.fn(),
  BUG_NOTICE: 'Please report this bug.',
  DEBUG_AUTOFIX_NOTICE: 'Auto-fix disabled in debug mode.'
}))

vi.mock('../../constants/index.js', () => ({
  BUG_NOTICE: 'Please report this bug.',
  DEBUG_AUTOFIX_NOTICE: 'Auto-fix disabled in debug mode.'
}))

describe('computeValidationNotice', () => {
  it('should return empty string for valid tree', () => {
    branching.validateTree.mockReturnValue({ ok: true, problems: [] })

    const result = computeValidationNotice([], 1, false)

    expect(result).toBe('')
  })

  it('should return notice for invalid tree', () => {
    branching.validateTree.mockReturnValue({
      ok: false,
      problems: ['Multiple parents', 'Cycle detected']
    })

    const result = computeValidationNotice([], 1, false)

    expect(result).toContain('Multiple parents')
    expect(result).toContain('Cycle detected')
    expect(result).toContain('Please report this bug')
  })

  it('should include debug notice when debug is true', () => {
    branching.validateTree.mockReturnValue({
      ok: false,
      problems: ['Issue']
    })

    const result = computeValidationNotice([], 1, true)

    expect(result).toContain('Auto-fix disabled in debug mode')
  })

  it('should not include debug notice when debug is false', () => {
    branching.validateTree.mockReturnValue({
      ok: false,
      problems: ['Issue']
    })

    const result = computeValidationNotice([], 1, false)

    expect(result).not.toContain('Auto-fix disabled in debug mode')
  })
})

describe('computeGenerationNotice', () => {
  it('should return empty string if no errors', () => {
    branching.buildVisible.mockReturnValue([
      { m: { role: 'user', content: 'hello' } },
      { m: { role: 'assistant', content: 'hi' } }
    ])

    const result = computeGenerationNotice([], 1)

    expect(result).toBe('')
  })

  it('should return error from most recent message', () => {
    branching.buildVisible.mockReturnValue([
      { m: { role: 'user', content: 'hello' } },
      { m: { role: 'assistant', content: 'response', error: 'Failed to generate' } }
    ])

    const result = computeGenerationNotice([], 1)

    expect(result).toContain('Failed to generate')
  })

  it('should prepend "Error:" if not present', () => {
    branching.buildVisible.mockReturnValue([
      { m: { role: 'assistant', content: 'response', error: 'Something went wrong' } }
    ])

    const result = computeGenerationNotice([], 1)

    expect(result).toBe('Error: Something went wrong')
  })

  it('should not duplicate "Error:" prefix', () => {
    branching.buildVisible.mockReturnValue([
      { m: { role: 'assistant', content: 'response', error: 'Error: Already prefixed' } }
    ])

    const result = computeGenerationNotice([], 1)

    expect(result).toBe('Error: Already prefixed')
    expect(result.match(/Error:/g)).toHaveLength(1)
  })

  it('should return last error when multiple exist', () => {
    branching.buildVisible.mockReturnValue([
      { m: { role: 'assistant', content: 'resp1', error: 'First error' } },
      { m: { role: 'user', content: 'hello' } },
      { m: { role: 'assistant', content: 'resp2', error: 'Last error' } }
    ])

    const result = computeGenerationNotice([], 1)

    expect(result).toContain('Last error')
    expect(result).not.toContain('First error')
  })

  it('should handle buildVisible throwing error', () => {
    branching.buildVisible.mockImplementation(() => {
      throw new Error('Build failed')
    })

    const result = computeGenerationNotice([], 1)

    expect(result).toBe('')
  })
})

describe('assembleNotice', () => {
  it('should join multiple notices', () => {
    const result = assembleNotice('Error 1', 'Error 2', 'Error 3', '', '')

    expect(result).toBe('Error 1 Error 2 Error 3')
  })

  it('should filter out empty notices', () => {
    const result = assembleNotice('', 'Valid notice', '', 'Another notice', '')

    expect(result).toBe('Valid notice Another notice')
  })

  it('should return empty string if all notices are empty', () => {
    const result = assembleNotice('', '', '', '', '')

    expect(result).toBe('')
  })

  it('should return empty string if assembled equals dismissed', () => {
    const result = assembleNotice('Error 1', '', '', '', 'Error 1')

    expect(result).toBe('')
  })

  it('should return notice if different from dismissed', () => {
    const result = assembleNotice('New error', '', '', '', 'Old error')

    expect(result).toBe('New error')
  })

  it('should handle null or undefined notices', () => {
    const result = assembleNotice(null, undefined, 'Valid', null, '')

    expect(result).toBe('Valid')
  })
})

describe('computeFollowingMap', () => {
  it('should map messages with following assistant messages', () => {
    branching.buildVisible.mockReturnValue([
      { m: { id: 1, role: 'user', content: 'hello' } },
      { m: { id: 2, role: 'assistant', content: 'hi', typing: false } },
      { m: { id: 3, role: 'user', content: 'how are you' } },
      { m: { id: 4, role: 'assistant', content: 'good', typing: false } }
    ])

    const result = computeFollowingMap([], 1)

    expect(result[0]).toEqual({ has: true, id: 2, typing: false })
    expect(result[1]).toEqual({ has: false, id: null, typing: false })
    expect(result[2]).toEqual({ has: true, id: 4, typing: false })
    expect(result[3]).toEqual({ has: false, id: null, typing: false })
  })

  it('should indicate typing status', () => {
    branching.buildVisible.mockReturnValue([
      { m: { id: 1, role: 'user', content: 'hello' } },
      { m: { id: 2, role: 'assistant', content: 'typing', typing: true } }
    ])

    const result = computeFollowingMap([], 1)

    expect(result[0]).toEqual({ has: true, id: 2, typing: true })
  })

  it('should return no following for last message', () => {
    branching.buildVisible.mockReturnValue([
      { m: { id: 1, role: 'user', content: 'hello' } }
    ])

    const result = computeFollowingMap([], 1)

    expect(result[0]).toEqual({ has: false, id: null, typing: false })
  })

  it('should only track immediate following assistant messages', () => {
    branching.buildVisible.mockReturnValue([
      { m: { id: 1, role: 'user', content: 'hello' } },
      { m: { id: 2, role: 'user', content: 'more' } },
      { m: { id: 3, role: 'assistant', content: 'response' } }
    ])

    const result = computeFollowingMap([], 1)

    expect(result[0]).toEqual({ has: false, id: null, typing: false })
    expect(result[1]).toEqual({ has: true, id: 3, typing: false })
    expect(result[2]).toEqual({ has: false, id: null, typing: false })
  })

  it('should handle empty visible list', () => {
    branching.buildVisible.mockReturnValue([])

    const result = computeFollowingMap([], 1)

    expect(result).toEqual({})
  })

  it('should handle single message', () => {
    branching.buildVisible.mockReturnValue([
      { m: { id: 1, role: 'assistant', content: 'only message' } }
    ])

    const result = computeFollowingMap([], 1)

    expect(result[0]).toEqual({ has: false, id: null, typing: false })
  })
})