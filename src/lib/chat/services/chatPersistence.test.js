import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { computePersistSig, persistChatContent } from './chatPersistence.js'
import * as chatsStore from '../../chatsStore.js'
import * as graphValidation from './graphValidation.js'

vi.mock('../../chatsStore.js', () => ({
  saveChatContent: vi.fn(),
}))

vi.mock('./graphValidation.js', () => ({
  sanitizeGraphIfNeeded: vi.fn(),
}))

describe('computePersistSig', () => {
  it('should compute signature for simple nodes', () => {
    const nodes = [
      { id: 1, active: 0, variants: [{ id: 1, role: 'user', content: 'hello', next: 2 }] },
      { id: 2, active: 0, variants: [{ id: 2, role: 'assistant', content: 'hi there', next: null }] }
    ]
    const chatSettings = {
      model: 'gpt-5',
      streaming: true,
      presetId: 'preset1',
      maxOutputTokens: 1000,
      topP: 0.9,
      temperature: 0.7,
      reasoningEffort: 'medium',
      textVerbosity: 'normal',
      reasoningSummary: 'auto',
      connectionId: 'conn1',
    }
    const rootId = 1

    const sig = computePersistSig(nodes, chatSettings, rootId)

    expect(sig).toBeTruthy()
    expect(typeof sig).toBe('string')
    const parsed = JSON.parse(sig)
    expect(parsed.m).toHaveLength(2)
    expect(parsed.m[0]).toBe('1|user|5|1')
    expect(parsed.m[1]).toBe('2|assistant|8|0')
    expect(parsed.settings.model).toBe('gpt-5')
    expect(parsed.rootId).toBe(1)
  })

  it('should handle empty nodes array', () => {
    const nodes = []
    const chatSettings = { model: 'gpt-5', streaming: false }
    const rootId = 1

    const sig = computePersistSig(nodes, chatSettings, rootId)

    expect(sig).toBeTruthy()
    const parsed = JSON.parse(sig)
    expect(parsed.m).toHaveLength(0)
  })

  it('should handle null/undefined inputs gracefully', () => {
    const sig = computePersistSig(null, null, null)

    expect(sig).toBeTruthy()
    const parsed = JSON.parse(sig)
    expect(parsed.m).toHaveLength(0)
    expect(parsed.settings.model).toBe('')
  })

  it('should use active variant for signature', () => {
    const nodes = [
      {
        id: 1,
        active: 1,
        variants: [
          { id: 1, role: 'user', content: 'first', next: null },
          { id: 2, role: 'user', content: 'second variant', next: null }
        ]
      }
    ]
    const chatSettings = { model: 'gpt-5', streaming: true }
    const rootId = 1

    const sig = computePersistSig(nodes, chatSettings, rootId)

    const parsed = JSON.parse(sig)
    expect(parsed.m[0]).toBe('1|user|14|0')
  })

  it('should handle nodes with missing variants', () => {
    const nodes = [
      { id: 1, active: 0, variants: [] }
    ]
    const chatSettings = { model: 'gpt-5', streaming: true }
    const rootId = 1

    const sig = computePersistSig(nodes, chatSettings, rootId)

    const parsed = JSON.parse(sig)
    expect(parsed.m[0]).toBe('1||0|0')
  })

  it('should return empty string on JSON.stringify error', () => {
    const nodes = [{ id: 1, active: 0, variants: [{ id: 1 }] }]
    const badSettings = {}
    Object.defineProperty(badSettings, 'model', {
      get() { throw new Error('Cannot access') }
    })

    const sig = computePersistSig(nodes, badSettings, 1)

    expect(sig).toBe('')
  })

  it('should include all chat settings in signature', () => {
    const nodes = []
    const chatSettings = {
      model: 'custom-model',
      streaming: false,
      presetId: 'my-preset',
      maxOutputTokens: 2000,
      topP: 0.95,
      temperature: 1.0,
      reasoningEffort: 'high',
      textVerbosity: 'verbose',
      reasoningSummary: 'always',
      connectionId: 'special-conn',
    }
    const rootId = 5

    const sig = computePersistSig(nodes, chatSettings, rootId)

    const parsed = JSON.parse(sig)
    expect(parsed.settings.model).toBe('custom-model')
    expect(parsed.settings.streaming).toBe(false)
    expect(parsed.settings.presetId).toBe('my-preset')
    expect(parsed.settings.maxOutputTokens).toBe(2000)
    expect(parsed.settings.topP).toBe(0.95)
    expect(parsed.settings.temperature).toBe(1.0)
    expect(parsed.settings.reasoningEffort).toBe('high')
    expect(parsed.settings.textVerbosity).toBe('verbose')
    expect(parsed.settings.reasoningSummary).toBe('always')
    expect(parsed.settings.connectionId).toBe('special-conn')
    expect(parsed.rootId).toBe(5)
  })

  it('should produce different signatures for different content', () => {
    const nodes1 = [{ id: 1, active: 0, variants: [{ id: 1, role: 'user', content: 'hello', next: null }] }]
    const nodes2 = [{ id: 1, active: 0, variants: [{ id: 1, role: 'user', content: 'goodbye', next: null }] }]
    const chatSettings = { model: 'gpt-5', streaming: true }

    const sig1 = computePersistSig(nodes1, chatSettings, 1)
    const sig2 = computePersistSig(nodes2, chatSettings, 1)

    expect(sig1).not.toBe(sig2)
  })
})

describe('persistChatContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should persist chat content successfully', async () => {
    const chatId = 'chat123'
    const nodes = [{ id: 1, active: 0, variants: [{ id: 1, role: 'user', content: 'test', next: null }] }]
    const chatSettings = { model: 'gpt-5', streaming: true }
    const rootId = 1
    const debug = false
    const mounted = true

    const sanitized = { nodes, notice: '' }
    graphValidation.sanitizeGraphIfNeeded.mockReturnValue(sanitized)

    const updated = { success: true, timestamp: Date.now() }
    chatsStore.saveChatContent.mockResolvedValue(updated)

    const result = await persistChatContent(chatId, nodes, chatSettings, rootId, debug, mounted)

    expect(graphValidation.sanitizeGraphIfNeeded).toHaveBeenCalledWith(nodes, rootId, debug)
    expect(chatsStore.saveChatContent).toHaveBeenCalledWith(chatId, {
      nodes,
      settings: chatSettings,
      rootId
    })
    expect(result.updated).toEqual(updated)
    expect(result.notice).toBe('')
    expect(result.nodes).toEqual(nodes)
  })

  it('should return sanitizer notice if graph was fixed', async () => {
    const chatId = 'chat123'
    const nodes = [{ id: 1 }]
    const sanitized = { nodes: [{ id: 1, fixed: true }], notice: 'Graph was sanitized' }
    graphValidation.sanitizeGraphIfNeeded.mockReturnValue(sanitized)
    chatsStore.saveChatContent.mockResolvedValue({ success: true })

    const result = await persistChatContent(chatId, nodes, {}, 1, false, true)

    expect(result.notice).toBe('Graph was sanitized')
    expect(result.nodes).toEqual([{ id: 1, fixed: true }])
  })

  it('should not persist if chatId is missing', async () => {
    const result = await persistChatContent(null, [], {}, 1, false, true)

    expect(chatsStore.saveChatContent).not.toHaveBeenCalled()
    expect(result.updated).toBeNull()
    expect(result.notice).toBe('')
  })

  it('should not persist if not mounted', async () => {
    const result = await persistChatContent('chat123', [], {}, 1, false, false)

    expect(chatsStore.saveChatContent).not.toHaveBeenCalled()
    expect(result.updated).toBeNull()
    expect(result.notice).toBe('')
  })

  it('should handle save errors gracefully', async () => {
    const chatId = 'chat123'
    const nodes = [{ id: 1 }]
    graphValidation.sanitizeGraphIfNeeded.mockReturnValue({ nodes, notice: '' })
    chatsStore.saveChatContent.mockRejectedValue(new Error('Save failed'))

    const result = await persistChatContent(chatId, nodes, {}, 1, false, true)

    expect(result.updated).toBeNull()
    expect(result.notice).toBe('')
    expect(result.nodes).toEqual(nodes)
  })

  it('should pass debug flag to sanitizer', async () => {
    const chatId = 'chat123'
    const nodes = [{ id: 1 }]
    const debug = true
    graphValidation.sanitizeGraphIfNeeded.mockReturnValue({ nodes, notice: '' })
    chatsStore.saveChatContent.mockResolvedValue({})

    await persistChatContent(chatId, nodes, {}, 1, debug, true)

    expect(graphValidation.sanitizeGraphIfNeeded).toHaveBeenCalledWith(nodes, 1, true)
  })

  it('should handle sanitizer errors gracefully', async () => {
    const chatId = 'chat123'
    const nodes = [{ id: 1 }]
    graphValidation.sanitizeGraphIfNeeded.mockImplementation(() => {
      throw new Error('Sanitizer failed')
    })

    const result = await persistChatContent(chatId, nodes, {}, 1, false, true)

    expect(result.updated).toBeNull()
    expect(result.notice).toBe('')
  })
})