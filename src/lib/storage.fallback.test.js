import { describe, it, expect, beforeEach, vi } from 'vitest'

const idbMock = vi.hoisted(() => ({
  isIndexedDBAvailable: vi.fn(() => true),
  getAllChats: vi.fn(),
  getChatListItems: vi.fn(),
  getChat: vi.fn(),
  putChat: vi.fn(),
  deleteChat: vi.fn(),
  subscribeChatStorage: vi.fn(() => () => {}),
}))

const lsMock = vi.hoisted(() => ({
  isIndexedDBAvailable: vi.fn(() => false),
  getAllChats: vi.fn(),
  getChatListItems: vi.fn(),
  getChat: vi.fn(),
  putChat: vi.fn(),
  deleteChat: vi.fn(),
  subscribeChatStorage: vi.fn(() => () => {}),
}))

vi.mock('./storage.indexeddb.js', () => idbMock)
vi.mock('./storage.localStorage.js', () => lsMock)

// Mock localStorage for Node.js test environment
const localStorageMock = (() => {
  let store = {}
  return {
    getItem: (key) => store[key] ?? null,
    setItem: (key, value) => { store[key] = String(value) },
    removeItem: (key) => { delete store[key] },
    clear: () => { store = {} },
    get length() { return Object.keys(store).length },
    key: (i) => Object.keys(store)[i] ?? null,
  }
})()

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true })

async function freshStorage() {
  vi.resetModules()
  return import('./storage.js')
}

function infraError(name = 'UnknownError') {
  return Object.assign(new Error('IndexedDB infrastructure failure'), { name })
}

const validChat = { id: 'chat-1', nodes: [], rootId: null, updatedAt: 1 }

describe('storage backend fallback policy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    idbMock.isIndexedDBAvailable.mockReturnValue(true)
    idbMock.subscribeChatStorage.mockReturnValue(() => {})
    lsMock.subscribeChatStorage.mockReturnValue(() => {})
  })

  it('does NOT fall back on validation errors from the IDB backend', async () => {
    const storage = await freshStorage()
    idbMock.getChat.mockResolvedValue(null)
    idbMock.putChat.mockRejectedValue(new Error('Invalid chat object structure: Chat nodes must be an array.'))

    await expect(storage.putChatAtomic(validChat)).rejects.toThrow('Invalid chat object structure')
    expect(lsMock.putChat).not.toHaveBeenCalled()
    expect(storage.getBackendName()).toBe('indexeddb')
  })

  it('does NOT fall back on optimistic concurrency conflicts', async () => {
    const storage = await freshStorage()
    idbMock.getChat.mockResolvedValue({ ...validChat, _version: 1 })
    idbMock.putChat.mockRejectedValue(new Error('Concurrent modification conflict for chat "chat-1".'))

    await expect(storage.putChatAtomic(validChat)).rejects.toThrow('Concurrent modification conflict')
    expect(lsMock.putChat).not.toHaveBeenCalled()
    // Conflicts are retried on the same backend
    expect(idbMock.putChat.mock.calls.length).toBeGreaterThan(1)
    expect(storage.getBackendName()).toBe('indexeddb')
  })

  it('falls back on infrastructure errors (e.g. UnknownError)', async () => {
    const storage = await freshStorage()
    idbMock.getChat.mockRejectedValue(infraError('UnknownError'))
    lsMock.getChat.mockResolvedValue(null)
    lsMock.putChat.mockResolvedValue({ ...validChat, _version: 1 })

    const result = await storage.putChatAtomic(validChat)
    expect(result).toEqual({ ...validChat, _version: 1 })
    expect(storage.getBackendName()).toBe('localstorage')
  })

  it('falls back on DOMException errors', async () => {
    const storage = await freshStorage()
    idbMock.getAllChats.mockRejectedValue(new DOMException('quota', 'QuotaExceededError'))
    lsMock.getAllChats.mockResolvedValue([])

    await expect(storage.getAllChats()).resolves.toEqual([])
    expect(storage.getBackendName()).toBe('localstorage')
  })

  it('propagates read validation-style errors without fallback', async () => {
    const storage = await freshStorage()
    idbMock.getChat.mockRejectedValue(new Error('Chat ID is required'))

    await expect(storage.getChat('chat-1')).rejects.toThrow('Chat ID is required')
    expect(lsMock.getChat).not.toHaveBeenCalled()
    expect(storage.getBackendName()).toBe('indexeddb')
  })

  it('propagates updater exceptions from updateChatAtomic without fallback', async () => {
    const storage = await freshStorage()
    idbMock.getChat.mockResolvedValue({ ...validChat, _version: 1 })

    // Even an infrastructure-looking error from the updater must not fall back
    const updaterErr = infraError('UnknownError')
    await expect(
      storage.updateChatAtomic('chat-1', () => { throw updaterErr })
    ).rejects.toBe(updaterErr)

    expect(lsMock.getChat).not.toHaveBeenCalled()
    expect(lsMock.putChat).not.toHaveBeenCalled()
    expect(storage.getBackendName()).toBe('indexeddb')
  })

  it('updateChatAtomic falls back only for backend infrastructure errors', async () => {
    const storage = await freshStorage()
    idbMock.getChat.mockRejectedValue(infraError('InvalidStateError'))
    lsMock.getChat.mockResolvedValue({ ...validChat, _version: 3 })
    lsMock.putChat.mockResolvedValue({ ...validChat, _version: 4 })

    const result = await storage.updateChatAtomic('chat-1', (current) => ({ ...current, title: 't' }))
    expect(result).toEqual({ ...validChat, _version: 4 })
    expect(storage.getBackendName()).toBe('localstorage')
  })

  it('subscribeChatStorage forwards from both backends so events survive fallback', async () => {
    const storage = await freshStorage()
    const listener = vi.fn()
    const unsubscribe = storage.subscribeChatStorage(listener)

    expect(idbMock.subscribeChatStorage).toHaveBeenCalledWith(listener)
    expect(lsMock.subscribeChatStorage).toHaveBeenCalledWith(listener)
    expect(typeof unsubscribe).toBe('function')
    unsubscribe()
  })
})
