import { describe, it, expect, beforeEach, vi } from 'vitest'

const storageMock = vi.hoisted(() => ({
  putChatAtomic: vi.fn(),
  getBackendName: vi.fn(() => 'indexeddb'),
}))

vi.mock('../storage.js', () => storageMock)

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

import { migrateChatsToIndexedDB } from './storageMigration.js'

const OLD_LS_KEY = 'advui.chats.store.v1'
const MIGRATION_FLAG_KEY = 'storage.migration.completed.v1'

const mockChatData = {
  version: 1,
  byId: {
    'chat-1': { id: 'chat-1', title: 'Test Chat 1', nodes: [], rootId: null, updatedAt: 1 },
    'chat-2': { id: 'chat-2', title: 'Test Chat 2', nodes: [], rootId: null, updatedAt: 2 },
  },
}

describe('migrateChatsToIndexedDB safety guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    vi.stubGlobal('indexedDB', {})
    storageMock.getBackendName.mockReturnValue('indexeddb')
    storageMock.putChatAtomic.mockImplementation(async (chat) => chat)
    localStorage.setItem(OLD_LS_KEY, JSON.stringify(mockChatData))
  })

  it('refuses to migrate when the active backend is localStorage', async () => {
    storageMock.getBackendName.mockReturnValue('localstorage')

    const result = await migrateChatsToIndexedDB()

    expect(result.success).toBe(false)
    expect(result.reason).toBe('Active storage backend is not IndexedDB')
    expect(storageMock.putChatAtomic).not.toHaveBeenCalled()
    // The old data must be preserved and the migration must stay retryable
    expect(localStorage.getItem(OLD_LS_KEY)).not.toBeNull()
    expect(localStorage.getItem(MIGRATION_FLAG_KEY)).toBeNull()
  })

  it('does not remove OLD_LS_KEY when the backend fell back mid-migration', async () => {
    storageMock.getBackendName
      .mockReturnValueOnce('indexeddb') // pre-migration check
      .mockReturnValue('localstorage') // post-migration check

    const result = await migrateChatsToIndexedDB()

    expect(result.migrated).toBe(2)
    // Chats were written to OLD_LS_KEY by the fallback backend, so it must stay
    expect(localStorage.getItem(OLD_LS_KEY)).not.toBeNull()
  })

  it('does not mark migration as completed when every chat fails', async () => {
    storageMock.putChatAtomic.mockRejectedValue(new Error('write failed'))

    const result = await migrateChatsToIndexedDB()

    expect(result.success).toBe(false)
    expect(result.migrated).toBe(0)
    expect(result.failed).toBe(2)
    expect(result.reason).toBe('Migration failed for all chats')
    expect(localStorage.getItem(MIGRATION_FLAG_KEY)).toBeNull()
    expect(localStorage.getItem(OLD_LS_KEY)).not.toBeNull()

    // A later attempt retries instead of reporting "Already completed"
    storageMock.putChatAtomic.mockImplementation(async (chat) => chat)
    const retry = await migrateChatsToIndexedDB()
    expect(retry.migrated).toBe(2)
  })

  it('removes OLD_LS_KEY and sets the flag on full success with IndexedDB active', async () => {
    const result = await migrateChatsToIndexedDB()

    expect(result.success).toBe(true)
    expect(result.migrated).toBe(2)
    expect(result.failed).toBe(0)
    expect(localStorage.getItem(OLD_LS_KEY)).toBeNull()
    const flag = JSON.parse(localStorage.getItem(MIGRATION_FLAG_KEY))
    expect(flag.completed).toBe(true)
  })
})
