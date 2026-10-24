import { describe, it, expect, beforeEach, vi } from 'vitest'

const idbMock = vi.hoisted(() => ({
  isIndexedDBAvailable: vi.fn(() => true),
  openDatabase: vi.fn(async () => {}),
  getAllChats: vi.fn(),
  getChatListItems: vi.fn(),
  getChat: vi.fn(),
  putChat: vi.fn(),
  deleteChat: vi.fn(),
  subscribeChatStorage: vi.fn(() => () => {}),
}))

vi.mock('./storage.indexeddb.js', () => idbMock)

import * as storage from './storage.js'

function infraError(name = 'UnknownError') {
  return Object.assign(new Error('IndexedDB infrastructure failure'), { name })
}

const validChat = { id: 'chat-1', nodes: [], rootId: null, updatedAt: 1 }

describe('storage facade (IndexedDB required)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    idbMock.isIndexedDBAvailable.mockReturnValue(true)
    idbMock.openDatabase.mockResolvedValue(undefined)
  })

  it('rejects every operation with StorageUnavailableError when IndexedDB is missing', async () => {
    idbMock.isIndexedDBAvailable.mockReturnValue(false)

    await expect(storage.probeStorage()).rejects.toBeInstanceOf(storage.StorageUnavailableError)
    await expect(storage.getChatListItems()).rejects.toBeInstanceOf(storage.StorageUnavailableError)
    await expect(storage.putChatAtomic(validChat)).rejects.toBeInstanceOf(storage.StorageUnavailableError)
    expect(idbMock.putChat).not.toHaveBeenCalled()
  })

  it('reports a failed database open as unavailable', async () => {
    idbMock.openDatabase.mockRejectedValue(new Error('IndexedDB open blocked by another connection'))

    const err = await storage.probeStorage().catch(e => e)
    expect(storage.isStorageUnavailable(err)).toBe(true)
    expect(err.message).toContain('blocked')
  })

  it('reports quota errors as unavailable with an actionable message', async () => {
    idbMock.getChat.mockResolvedValue(null)
    idbMock.putChat.mockRejectedValue(infraError('QuotaExceededError'))

    const err = await storage.putChatAtomic(validChat).catch(e => e)
    expect(storage.isStorageUnavailable(err)).toBe(true)
    expect(err.message).toMatch(/storage is full/i)
    expect(err.cause?.name).toBe('QuotaExceededError')
  })

  it('distinguishes a missing chat (null) from a read failure (rejection)', async () => {
    idbMock.getChat.mockResolvedValueOnce(null)
    await expect(storage.getChat('nope')).resolves.toBeNull()

    idbMock.getChat.mockRejectedValueOnce(infraError('InvalidStateError'))
    await expect(storage.getChat('chat-1')).rejects.toBeInstanceOf(storage.StorageUnavailableError)
  })

  it('passes validation errors through unchanged', async () => {
    idbMock.getChat.mockResolvedValue(null)
    idbMock.putChat.mockRejectedValue(new Error('Invalid chat object structure: Chat nodes must be an array.'))

    const err = await storage.putChatAtomic(validChat).catch(e => e)
    expect(err.message).toContain('Invalid chat object structure')
    expect(storage.isStorageUnavailable(err)).toBe(false)
  })

  it('retries optimistic concurrency conflicts, then surfaces the conflict', async () => {
    idbMock.getChat.mockResolvedValue({ ...validChat, _version: 1 })
    idbMock.putChat.mockRejectedValue(new storage.ConflictError('chat-1', 'modification'))

    const err = await storage.putChatAtomic(validChat, { retries: 2 }).catch(e => e)
    expect(storage.isConcurrencyConflict(err)).toBe(true)
    expect(idbMock.putChat).toHaveBeenCalledTimes(3)
  })

  it('recovers when a retried conflict succeeds', async () => {
    idbMock.getChat.mockResolvedValue({ ...validChat, _version: 1 })
    idbMock.putChat
      .mockRejectedValueOnce(new storage.ConflictError('chat-1', 'modification'))
      .mockResolvedValueOnce({ ...validChat, _version: 2 })

    await expect(storage.putChatAtomic(validChat)).resolves.toMatchObject({ _version: 2 })
  })

  it('propagates updater exceptions as-is, without retrying', async () => {
    idbMock.getChat.mockResolvedValue({ ...validChat, _version: 1 })
    const bug = new Error('updater bug')

    await expect(storage.updateChatAtomic('chat-1', () => { throw bug })).rejects.toBe(bug)
    expect(idbMock.getChat).toHaveBeenCalledTimes(1)
    expect(idbMock.putChat).not.toHaveBeenCalled()
  })

  it('passes the latest stored version as the expected version', async () => {
    idbMock.getChat.mockResolvedValue({ ...validChat, _version: 7 })
    idbMock.putChat.mockImplementation(async chat => ({ ...chat, _version: 8 }))

    await storage.updateChatAtomic('chat-1', current => ({ ...current, title: 'x' }))
    expect(idbMock.putChat.mock.calls[0][0]._expectedVersion).toBe(7)
  })
})
