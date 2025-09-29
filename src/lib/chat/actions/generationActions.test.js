import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  prepareUserMessage,
  prepareTypingNode,
  generateResponse,
  handleGenerationSuccess,
  handleGenerationError,
  prepareRefreshAssistant,
  prepareRefreshAfterUser
} from './generationActions.js'
import * as openaiClient from '../../openaiClient.js'
import * as errors from '../../utils/errors.js'

vi.mock('../../openaiClient.js', () => ({
  respond: vi.fn(),
}))

vi.mock('../../utils/errors.js', () => ({
  isAbortError: vi.fn(),
}))

describe('prepareUserMessage', () => {
  it('should prepare a new user message', () => {
    const nodes = [
      { id: 1, active: 0, variants: [{ id: 1, role: 'system', content: 'sys', next: null }] }
    ]
    const rootId = 1

    const result = prepareUserMessage(nodes, rootId, 'hello', 10, 2)

    expect(result).not.toBeNull()
    expect(result.nodes).toHaveLength(2)
    expect(result.nodes[1].variants[0].content).toBe('hello')
    expect(result.nodes[1].variants[0].role).toBe('user')
    expect(result.nextId).toBe(11)
    expect(result.nextNodeId).toBe(3)
  })

  it('should link new message to last visible message', () => {
    const nodes = [
      { id: 1, active: 0, variants: [{ id: 1, role: 'user', content: 'first', next: null }] }
    ]
    const rootId = 1

    const result = prepareUserMessage(nodes, rootId, 'second', 10, 2)

    expect(result.nodes[0].variants[0].next).toBe(2)
  })

  it('should return null for empty trimmed input without images', () => {
    const nodes = []
    const rootId = 1

    const result = prepareUserMessage(nodes, rootId, '   ', 10, 2)

    expect(result).toBeNull()
  })

  it('should accept empty text if images are provided', () => {
    const nodes = []
    const rootId = 1
    const images = ['image1.png']

    const result = prepareUserMessage(nodes, rootId, '', 10, 2, images)

    expect(result).not.toBeNull()
    expect(result.nodes[0].variants[0].images).toEqual(images)
  })

  it('should set new node as root if no parent', () => {
    const nodes = []
    const rootId = null

    const result = prepareUserMessage(nodes, rootId, 'hello', 10, 1)

    expect(result.rootId).toBe(1)
  })

  it('should include images in message', () => {
    const nodes = []
    const rootId = null
    const images = ['img1.png', 'img2.jpg']

    const result = prepareUserMessage(nodes, rootId, 'check these out', 10, 1, images)

    expect(result.nodes[0].variants[0].images).toEqual(images)
  })

  it('should not include images field if no images', () => {
    const nodes = []
    const rootId = null

    const result = prepareUserMessage(nodes, rootId, 'hello', 10, 1, [])

    expect(result.nodes[0].variants[0].images).toBeUndefined()
  })
})

describe('prepareTypingNode', () => {
  it('should create a typing node', () => {
    const nodes = [
      { id: 1, active: 0, variants: [{ id: 1, role: 'user', content: 'hello', next: null }] }
    ]
    const rootId = 1

    const result = prepareTypingNode(nodes, rootId, 1, 10, 2)

    expect(result.nodes).toHaveLength(2)
    const typingNode = result.nodes[1]
    expect(typingNode.variants[0].typing).toBe(true)
    expect(typingNode.variants[0].role).toBe('assistant')
    expect(typingNode.variants[0].content).toBe('typing')
    expect(result.typingVariantId).toBe(10)
  })

  it('should link parent to typing node', () => {
    const nodes = [
      { id: 1, active: 0, variants: [{ id: 1, role: 'user', content: 'hello', next: null }] }
    ]
    const rootId = 1

    const result = prepareTypingNode(nodes, rootId, 1, 10, 2)

    expect(result.nodes[0].variants[0].next).toBe(2)
  })

  it('should set typing node as root if no parent', () => {
    const nodes = []
    const rootId = null

    const result = prepareTypingNode(nodes, rootId, null, 10, 1)

    expect(result.rootId).toBe(1)
  })

  it('should initialize reasoning summary fields', () => {
    const nodes = []
    const rootId = null

    const result = prepareTypingNode(nodes, rootId, null, 10, 1)

    const typingVariant = result.nodes[0].variants[0]
    expect(typingVariant.reasoningSummary).toBe('')
    expect(typingVariant.reasoningSummaryLoading).toBe(true)
  })

  it('should increment IDs correctly', () => {
    const nodes = []
    const rootId = null

    const result = prepareTypingNode(nodes, rootId, null, 10, 2)

    expect(result.nextId).toBe(11)
    expect(result.nextNodeId).toBe(3)
  })
})

describe('generateResponse', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should call respond with correct parameters', async () => {
    const nodes = [
      { id: 1, active: 0, variants: [{ id: 1, role: 'user', content: 'hello', next: null }] }
    ]
    const rootId = 1
    const chatSettings = {
      model: 'gpt-5',
      maxOutputTokens: 1000,
      topP: 0.9,
      temperature: 0.7,
      reasoningEffort: 'medium',
      textVerbosity: 'normal',
      reasoningSummary: 'auto'
    }
    const connectionId = 'conn1'

    openaiClient.respond.mockResolvedValue({ text: 'response' })

    await generateResponse({
      nodes,
      rootId,
      chatSettings,
      connectionId,
      streaming: false,
      typingVariantId: 10
    })

    expect(openaiClient.respond).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [{ role: 'user', content: 'hello' }],
        model: 'gpt-5',
        maxOutputTokens: 1000,
        topP: 0.9,
        temperature: 0.7,
        reasoningEffort: 'medium',
        textVerbosity: 'normal',
        reasoningSummary: 'auto',
        connectionId: 'conn1'
      })
    )
  })

  it('should filter out typing messages from history', async () => {
    const nodes = [
      { id: 1, active: 0, variants: [{ id: 1, role: 'user', content: 'hello', next: 2 }] },
      { id: 2, active: 0, variants: [{ id: 2, role: 'assistant', content: 'typing', typing: true, next: null }] }
    ]
    const rootId = 1

    openaiClient.respond.mockResolvedValue({ text: 'response' })

    await generateResponse({
      nodes,
      rootId,
      chatSettings: { model: 'gpt-5' },
      connectionId: 'conn1',
      streaming: false
    })

    const call = openaiClient.respond.mock.calls[0][0]
    expect(call.messages).toHaveLength(1)
    expect(call.messages[0].content).toBe('hello')
  })

  it('should include images in history', async () => {
    const nodes = [
      {
        id: 1,
        active: 0,
        variants: [{
          id: 1,
          role: 'user',
          content: 'check this',
          images: ['img1.png'],
          next: null
        }]
      }
    ]
    const rootId = 1

    openaiClient.respond.mockResolvedValue({ text: 'response' })

    await generateResponse({
      nodes,
      rootId,
      chatSettings: { model: 'gpt-5' },
      connectionId: 'conn1',
      streaming: false
    })

    const call = openaiClient.respond.mock.calls[0][0]
    expect(call.messages[0].images).toEqual(['img1.png'])
  })

  it('should use streaming when enabled', async () => {
    const nodes = [
      { id: 1, active: 0, variants: [{ id: 1, role: 'user', content: 'hello', next: null }] }
    ]
    const rootId = 1
    const onTextDelta = vi.fn()

    openaiClient.respond.mockResolvedValue({ text: 'response' })

    await generateResponse({
      nodes,
      rootId,
      chatSettings: { model: 'gpt-5' },
      connectionId: 'conn1',
      streaming: true,
      typingVariantId: 10,
      onTextDelta
    })

    expect(openaiClient.respond).toHaveBeenCalledWith(
      expect.objectContaining({
        stream: true,
        onTextDelta
      })
    )
  })
})

describe('handleGenerationSuccess', () => {
  it('should update typing variant with response', () => {
    const nodes = [
      { id: 1, active: 0, variants: [{ id: 1, role: 'assistant', content: 'typing', typing: true, next: null }] }
    ]
    const reply = { text: 'Hello there!' }

    const result = handleGenerationSuccess(nodes, 1, reply, '')

    expect(result[0].variants[0].content).toBe('Hello there!')
    expect(result[0].variants[0].typing).toBe(false)
    expect(result[0].variants[0].error).toBeUndefined()
  })

  it('should handle string reply', () => {
    const nodes = [
      { id: 1, active: 0, variants: [{ id: 1, role: 'assistant', content: 'typing', typing: true, next: null }] }
    ]

    const result = handleGenerationSuccess(nodes, 1, 'Simple string response', '')

    expect(result[0].variants[0].content).toBe('Simple string response')
  })

  it('should use reasoning summary from reply if available', () => {
    const nodes = [
      { id: 1, active: 0, variants: [{ id: 1, role: 'assistant', content: 'typing', typing: true, next: null }] }
    ]
    const reply = { text: 'response', reasoningSummary: 'I thought about it' }

    const result = handleGenerationSuccess(nodes, 1, reply, '')

    expect(result[0].variants[0].reasoningSummary).toBe('I thought about it')
    expect(result[0].variants[0].reasoningSummaryLoading).toBe(false)
  })

  it('should use summaryBuffer if reply has no reasoning summary', () => {
    const nodes = [
      { id: 1, active: 0, variants: [{ id: 1, role: 'assistant', content: 'typing', typing: true, next: null }] }
    ]
    const reply = { text: 'response' }

    const result = handleGenerationSuccess(nodes, 1, reply, 'buffer summary')

    expect(result[0].variants[0].reasoningSummary).toBe('buffer summary')
  })

  it('should return unchanged if typingVariantId is null', () => {
    const nodes = [
      { id: 1, active: 0, variants: [{ id: 1, role: 'assistant', content: 'typing', typing: true, next: null }] }
    ]

    const result = handleGenerationSuccess(nodes, null, 'response', '')

    expect(result).toEqual(nodes)
  })
})

describe('handleGenerationError', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should update variant with error message', () => {
    const nodes = [
      { id: 1, active: 0, variants: [{ id: 1, role: 'assistant', content: 'typing', typing: true, next: null }] }
    ]
    const error = new Error('API failed')

    errors.isAbortError.mockReturnValue(false)

    const result = handleGenerationError(nodes, 1, error)

    expect(result[0].variants[0].typing).toBe(false)
    expect(result[0].variants[0].error).toBe('API failed')
  })

  it('should clear content if it was typing', () => {
    const nodes = [
      { id: 1, active: 0, variants: [{ id: 1, role: 'assistant', content: 'typing', typing: true, next: null }] }
    ]

    errors.isAbortError.mockReturnValue(false)

    const result = handleGenerationError(nodes, 1, new Error('Failed'))

    expect(result[0].variants[0].content).toBe('')
  })

  it('should preserve partial content if not "typing"', () => {
    const nodes = [
      { id: 1, active: 0, variants: [{ id: 1, role: 'assistant', content: 'partial response', typing: true, next: null }] }
    ]

    errors.isAbortError.mockReturnValue(false)

    const result = handleGenerationError(nodes, 1, new Error('Failed'))

    expect(result[0].variants[0].content).toBe('partial response')
  })

  it('should handle abort without error message', () => {
    const nodes = [
      { id: 1, active: 0, variants: [{ id: 1, role: 'assistant', content: 'typing', typing: true, next: null }] }
    ]

    errors.isAbortError.mockReturnValue(true)

    const result = handleGenerationError(nodes, 1, new Error('Aborted'))

    expect(result[0].variants[0].typing).toBe(false)
    expect(result[0].variants[0].error).toBeUndefined()
  })

  it('should return unchanged if typingVariantId is null', () => {
    const nodes = [
      { id: 1, active: 0, variants: [{ id: 1, role: 'assistant', content: 'typing', typing: true, next: null }] }
    ]

    errors.isAbortError.mockReturnValue(false)

    const result = handleGenerationError(nodes, null, new Error('Failed'))

    expect(result).toEqual(nodes)
  })

  it('should use default error message if none provided', () => {
    const nodes = [
      { id: 1, active: 0, variants: [{ id: 1, role: 'assistant', content: 'typing', typing: true, next: null }] }
    ]

    errors.isAbortError.mockReturnValue(false)

    const result = handleGenerationError(nodes, 1, {})

    expect(result[0].variants[0].error).toBe('Something went wrong.')
  })
})

describe('prepareRefreshAssistant', () => {
  it('should create new variant for regeneration', () => {
    const nodes = [
      { id: 1, active: 0, variants: [{ id: 1, role: 'user', content: 'hello', next: 2 }] },
      { id: 2, active: 0, variants: [{ id: 2, role: 'assistant', content: 'original', next: null }] }
    ]
    const rootId = 1

    const result = prepareRefreshAssistant(nodes, rootId, 2, 10)

    expect(result).not.toBeNull()
    expect(result.nodes[1].variants).toHaveLength(2)
    expect(result.nodes[1].variants[1].typing).toBe(true)
    expect(result.nodes[1].active).toBe(1)
  })

  it('should build history excluding assistant message being refreshed', () => {
    const nodes = [
      { id: 1, active: 0, variants: [{ id: 1, role: 'user', content: 'hello', next: 2 }] },
      { id: 2, active: 0, variants: [{ id: 2, role: 'assistant', content: 'original', next: null }] }
    ]
    const rootId = 1

    const result = prepareRefreshAssistant(nodes, rootId, 2, 10)

    expect(result.history).toHaveLength(1)
    expect(result.history[0].content).toBe('hello')
  })

  it('should return null if message not found', () => {
    const nodes = [
      { id: 1, active: 0, variants: [{ id: 1, role: 'user', content: 'hello', next: null }] }
    ]
    const rootId = 1

    const result = prepareRefreshAssistant(nodes, rootId, 999, 10)

    expect(result).toBeNull()
  })

  it('should return null if message is not assistant', () => {
    const nodes = [
      { id: 1, active: 0, variants: [{ id: 1, role: 'user', content: 'hello', next: null }] }
    ]
    const rootId = 1

    const result = prepareRefreshAssistant(nodes, rootId, 1, 10)

    expect(result).toBeNull()
  })

  it('should return null if message is typing', () => {
    const nodes = [
      { id: 1, active: 0, variants: [{ id: 1, role: 'assistant', content: 'typing', typing: true, next: null }] }
    ]
    const rootId = 1

    const result = prepareRefreshAssistant(nodes, rootId, 1, 10)

    expect(result).toBeNull()
  })
})

describe('prepareRefreshAfterUser', () => {
  it('should add typing node after user message', () => {
    const nodes = [
      { id: 1, active: 0, variants: [{ id: 1, role: 'user', content: 'hello', next: null }] }
    ]
    const rootId = 1

    const result = prepareRefreshAfterUser(nodes, rootId, 0, 10, 2)

    expect(result).not.toBeNull()
    expect(result.nodes).toHaveLength(2)
    expect(result.nodes[1].variants[0].typing).toBe(true)
  })

  it('should link user message to typing node', () => {
    const nodes = [
      { id: 1, active: 0, variants: [{ id: 1, role: 'user', content: 'hello', next: null }] }
    ]
    const rootId = 1

    const result = prepareRefreshAfterUser(nodes, rootId, 0, 10, 2)

    expect(result.nodes[0].variants[0].next).toBe(2)
  })

  it('should build history up to and including user message', () => {
    const nodes = [
      { id: 1, active: 0, variants: [{ id: 1, role: 'system', content: 'sys', next: 2 }] },
      { id: 2, active: 0, variants: [{ id: 2, role: 'user', content: 'hello', next: null }] }
    ]
    const rootId = 1

    const result = prepareRefreshAfterUser(nodes, rootId, 1, 10, 3)

    expect(result.history).toHaveLength(2)
    expect(result.history[1].content).toBe('hello')
  })

  it('should return null if message index is invalid', () => {
    const nodes = [
      { id: 1, active: 0, variants: [{ id: 1, role: 'user', content: 'hello', next: null }] }
    ]
    const rootId = 1

    const result = prepareRefreshAfterUser(nodes, rootId, 999, 10, 2)

    expect(result).toBeNull()
  })

  it('should include images in history', () => {
    const nodes = [
      {
        id: 1,
        active: 0,
        variants: [{
          id: 1,
          role: 'user',
          content: 'check this',
          images: ['img.png'],
          next: null
        }]
      }
    ]
    const rootId = 1

    const result = prepareRefreshAfterUser(nodes, rootId, 0, 10, 2)

    expect(result.history[0].images).toEqual(['img.png'])
  })
})