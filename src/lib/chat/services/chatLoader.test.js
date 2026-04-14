import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { loadChat } from './chatLoader.js'
import * as chatsStore from '../../chatsStore.js'
import * as settingsStore from '../../settingsStore.js'
import { DEFAULT_MODEL } from '../../utils/presetHelpers.js'

vi.mock('../../chatsStore.js', () => ({
  getChat: vi.fn(),
  getCachedChat: vi.fn(() => undefined),
}))

vi.mock('../../settingsStore.js', () => ({
  loadSettings: vi.fn(),
}))

describe('loadChat', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    settingsStore.loadSettings.mockReturnValue({
      selectedConnectionId: 'default-conn',
      presets: [
        {
          id: 'default-preset',
          model: DEFAULT_MODEL,
          streaming: true,
          maxOutputTokens: 1000,
          topP: 0.9,
          temperature: 0.7,
          reasoningEffort: 'medium',
          textVerbosity: 'normal',
          reasoningSummary: 'auto',
          connectionId: 'preset-conn'
        }
      ],
      selectedPresetId: 'default-preset'
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should return empty chat when no chatId provided', async () => {
    const result = await loadChat(null)

    expect(result.nodes).toEqual([])
    expect(result.rootId).toBe(1)
    expect(result.nextId).toBe(1)
    expect(result.nextNodeId).toBe(1)
    expect(result.chatSettings.model).toBe(DEFAULT_MODEL)
  })

  it('should load chat with nodes', async () => {
    const loadedChat = {
      nodes: [
        { id: 1, active: 0, variants: [{ id: 1, role: 'user', content: 'hello', next: null }] }
      ],
      rootId: 1,
      settings: {
        model: 'gpt-4',
        streaming: false
      }
    }
    chatsStore.getChat.mockResolvedValue(loadedChat)

    const result = await loadChat('chat123')

    expect(result.nodes).toEqual(loadedChat.nodes)
    expect(result.rootId).toBe(1)
    expect(result.chatSettings.model).toBe('gpt-4')
    expect(result.chatSettings.streaming).toBe(false)
  })

  it('should compute next ids from loaded nodes', async () => {
    const loadedChat = {
      nodes: [
        { id: 1, active: 0, variants: [{ id: 1 }, { id: 2 }] },
        { id: 2, active: 0, variants: [{ id: 5 }] }
      ],
      rootId: 1
    }
    chatsStore.getChat.mockResolvedValue(loadedChat)

    const result = await loadChat('chat123')

    expect(result.nextId).toBe(6)
    expect(result.nextNodeId).toBe(3)
  })

  it('should migrate legacy messages to nodes', async () => {
    const loadedChat = {
      messages: [
        { id: 1, role: 'user', content: 'old format', next: [2] },
        { id: 2, role: 'assistant', content: 'response', next: [] }
      ],
      rootId: 1,
      selected: { 1: 0 }
    }
    chatsStore.getChat.mockResolvedValue(loadedChat)

    const result = await loadChat('chat123')

    expect(result.nodes.length).toBeGreaterThan(0)
    expect(result.nodes[0].variants).toBeDefined()
  })

  it('should merge settings from loaded chat with preset', async () => {
    const loadedChat = {
      nodes: [
        { id: 1, active: 0, variants: [{ id: 1, role: 'user', content: 'test', next: null }] }
      ],
      rootId: 1,
      settings: {
        model: 'custom-model',
        maxOutputTokens: 2000
      }
    }
    chatsStore.getChat.mockResolvedValue(loadedChat)

    const result = await loadChat('chat123')

    expect(result.chatSettings.model).toBe('custom-model')
    expect(result.chatSettings.maxOutputTokens).toBe(2000)
    expect(result.chatSettings.streaming).toBe(true) // from preset
  })

  it('should use preset connectionId when not in loaded settings', async () => {
    const loadedChat = {
      nodes: [{ id: 1, active: 0, variants: [{ id: 1 }] }],
      rootId: 1,
      settings: {}
    }
    chatsStore.getChat.mockResolvedValue(loadedChat)

    const result = await loadChat('chat123')

    expect(result.chatSettings.connectionId).toBe('preset-conn')
  })

  it('should use loaded connectionId when available', async () => {
    const loadedChat = {
      nodes: [{ id: 1, active: 0, variants: [{ id: 1 }] }],
      rootId: 1,
      settings: {
        connectionId: 'loaded-conn'
      }
    }
    chatsStore.getChat.mockResolvedValue(loadedChat)

    const result = await loadChat('chat123')

    expect(result.chatSettings.connectionId).toBe('loaded-conn')
  })

  it('should keep chat empty when loaded chat has no nodes and null root', async () => {
    const loadedChat = {
      nodes: [],
      rootId: null
    }
    chatsStore.getChat.mockResolvedValue(loadedChat)

    const result = await loadChat('chat123')

    expect(result.nodes).toEqual([])
    expect(result.rootId).toBeNull()
    expect(result.nextId).toBe(1)
    expect(result.nextNodeId).toBe(1)
  })

  it('should create default system message when legacy chat is missing nodes but root is defined', async () => {
    const loadedChat = {
      nodes: [],
      rootId: 1
    }
    chatsStore.getChat.mockResolvedValue(loadedChat)

    const result = await loadChat('chat123')

    expect(result.nodes).toHaveLength(1)
    expect(result.nodes[0].variants[0].role).toBe('system')
    expect(result.rootId).toBe(1)
    expect(result.nextId).toBe(2)
    expect(result.nextNodeId).toBe(2)
  })

  it('should create default chat when loaded chat is null', async () => {
    chatsStore.getChat.mockResolvedValue(null)

    const result = await loadChat('chat123')

    expect(result.nodes).toHaveLength(1)
    expect(result.nodes[0].variants[0].role).toBe('system')
    expect(result.rootId).toBe(1)
  })

  it('should handle load errors gracefully', async () => {
    chatsStore.getChat.mockRejectedValue(new Error('Load failed'))

    const result = await loadChat('chat123')

    expect(result.nodes).toHaveLength(1)
    expect(result.nodes[0].variants[0].role).toBe('system')
    expect(result.rootId).toBe(1)
  })

  it('should compute persist signature for loaded chat', async () => {
    const loadedChat = {
      nodes: [
        { id: 1, active: 0, variants: [{ id: 1, role: 'user', content: 'test', next: null }] }
      ],
      rootId: 1,
      settings: { model: DEFAULT_MODEL, streaming: true }
    }
    chatsStore.getChat.mockResolvedValue(loadedChat)

    const result = await loadChat('chat123')

    expect(result.persistSig).toBeTruthy()
    expect(typeof result.persistSig).toBe('string')
  })

  it('should return settings object', async () => {
    const mockSettings = {
      selectedConnectionId: 'test-conn',
      presets: []
    }
    settingsStore.loadSettings.mockReturnValue(mockSettings)
    chatsStore.getChat.mockResolvedValue(null)

    const result = await loadChat('chat123')

    expect(result.settings).toEqual(mockSettings)
  })

  it('should use presetId from loaded chat', async () => {
    const loadedChat = {
      nodes: [{ id: 1, active: 0, variants: [{ id: 1 }] }],
      rootId: 1,
      presetId: 'loaded-preset'
    }
    chatsStore.getChat.mockResolvedValue(loadedChat)

    const result = await loadChat('chat123')

    expect(result.chatSettings.presetId).toBe('loaded-preset')
  })

  it('should use first node id as rootId if not specified', async () => {
    const loadedChat = {
      nodes: [
        { id: 5, active: 0, variants: [{ id: 1, role: 'user', content: 'test', next: null }] }
      ]
    }
    chatsStore.getChat.mockResolvedValue(loadedChat)

    const result = await loadChat('chat123')

    expect(result.rootId).toBe(5)
  })

  it('should handle empty string connectionId by falling back', async () => {
    const loadedChat = {
      nodes: [{ id: 1, active: 0, variants: [{ id: 1 }] }],
      rootId: 1,
      settings: {
        connectionId: '   '
      }
    }
    chatsStore.getChat.mockResolvedValue(loadedChat)

    const result = await loadChat('chat123')

    expect(result.chatSettings.connectionId).toBe('preset-conn')
  })

  it('should handle persist signature computation errors', async () => {
    const loadedChat = {
      nodes: [{ id: 1, active: 0, variants: [{ id: 1 }] }],
      rootId: 1,
      settings: {}
    }
    chatsStore.getChat.mockResolvedValue(loadedChat)

    // Mock computePersistSig to throw
    const chatPersistence = await import('./chatPersistence.js')
    const origCompute = chatPersistence.computePersistSig
    vi.spyOn(chatPersistence, 'computePersistSig').mockImplementation(() => {
      throw new Error('Signature computation failed')
    })

    const result = await loadChat('chat123')

    expect(result.persistSig).toBe('')
    chatPersistence.computePersistSig.mockRestore()
  })

  it('should normalize all chat settings fields', async () => {
    const loadedChat = {
      nodes: [{ id: 1, active: 0, variants: [{ id: 1 }] }],
      rootId: 1,
      settings: {
        model: 'custom',
        streaming: false,
        maxOutputTokens: 'invalid',
        topP: 2.0,
        temperature: -1,
        reasoningEffort: 'invalid',
        textVerbosity: 'invalid',
        reasoningSummary: 'invalid'
      }
    }
    chatsStore.getChat.mockResolvedValue(loadedChat)

    const result = await loadChat('chat123')

    expect(result.chatSettings.model).toBe('custom')
    expect(result.chatSettings.streaming).toBe(false)
    // Validation functions should sanitize invalid values to safe defaults
    expect(result.chatSettings.maxOutputTokens).toBe(null)
    expect(result.chatSettings.topP).toBe(1)
    expect(result.chatSettings.temperature).toBe(0)
    expect(result.chatSettings.reasoningEffort).toBe('none')
    expect(result.chatSettings.textVerbosity).toBe('medium')
    expect(result.chatSettings.reasoningSummary).toBe('auto')
  })

  it('should handle settings with no presets', async () => {
    settingsStore.loadSettings.mockReturnValue({
      presets: [],
      selectedConnectionId: 'conn1'
    })
    chatsStore.getChat.mockResolvedValue(null)

    const result = await loadChat(null)

    expect(result.chatSettings.model).toBe(DEFAULT_MODEL)
    expect(result.chatSettings.streaming).toBe(true)
  })
})
