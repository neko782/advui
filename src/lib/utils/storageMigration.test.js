import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  migrateChatsToIndexedDB,
  needsMigration,
  getMigrationStatus,
  resetMigrationFlag,
} from './storageMigration.js'

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

describe('Storage Migration', () => {
  beforeEach(() => {
    // Clean up localStorage before each test
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('should export all required functions', () => {
    expect(typeof migrateChatsToIndexedDB).toBe('function')
    expect(typeof needsMigration).toBe('function')
    expect(typeof getMigrationStatus).toBe('function')
    expect(typeof resetMigrationFlag).toBe('function')
  })

  it('should reset migration flag', () => {
    const result = resetMigrationFlag()
    expect(typeof result).toBe('boolean')
  })

  it('should get migration status', () => {
    const status = getMigrationStatus()
    expect(status).toHaveProperty('completed')
    expect(status).toHaveProperty('needsMigration')
    expect(status).toHaveProperty('chatsInLocalStorage')
    expect(status).toHaveProperty('indexedDBAvailable')
    expect(typeof status.completed).toBe('boolean')
    expect(typeof status.needsMigration).toBe('boolean')
    expect(typeof status.chatsInLocalStorage).toBe('number')
    expect(typeof status.indexedDBAvailable).toBe('boolean')
  })

  it('should check if migration is needed', () => {
    const result = needsMigration()
    expect(typeof result).toBe('boolean')
  })

  it('should handle migration with no chats', async () => {
    // Ensure no chats in localStorage
    localStorage.removeItem('advui.chats.store.v1')

    const result = await migrateChatsToIndexedDB()

    expect(result).toHaveProperty('success')
    expect(result).toHaveProperty('reason')
    expect(result).toHaveProperty('migrated')
    expect(result).toHaveProperty('failed')
    expect(result).toHaveProperty('skipped')
  })

  it('should not migrate if already completed', async () => {
    // Mark migration as completed
    localStorage.setItem(
      'storage.migration.completed.v1',
      JSON.stringify({
        completed: true,
        migratedAt: Date.now(),
        stats: { migrated: 0, failed: 0, skipped: 0 },
      })
    )

    const result = await migrateChatsToIndexedDB()

    // Either IndexedDB not available or already completed
    if (result.reason === 'IndexedDB not available') {
      expect(result.success).toBe(false)
    } else {
      expect(result.success).toBe(true)
      expect(result.reason).toBe('Already completed')
    }
    expect(result.migrated).toBe(0)
  })

  it('should handle IndexedDB not available', async () => {
    // This test assumes IndexedDB might not be available in test environment
    const result = await migrateChatsToIndexedDB()

    expect(result).toHaveProperty('success')
    expect(result).toHaveProperty('reason')

    // If IndexedDB is not available, migration should fail gracefully
    if (!result.success && result.reason === 'IndexedDB not available') {
      expect(result.migrated).toBe(0)
    }
  })
})

describe('Storage Migration - Data Validation', () => {
  const mockChatData = {
    version: 1,
    byId: {
      'chat-1': {
        id: 'chat-1',
        title: 'Test Chat 1',
        nodes: [
          {
            id: 1,
            variants: [
              {
                id: 1,
                role: 'system',
                content: 'Test',
                time: Date.now(),
                typing: false,
                next: null,
              },
            ],
            active: 0,
          },
        ],
        rootId: 1,
        settings: { model: 'gpt-4', streaming: true },
        updatedAt: Date.now(),
      },
    },
  }

  beforeEach(() => {
    localStorageMock.clear()
  })

  afterEach(() => {
    localStorageMock.clear()
  })

  it('should detect chats that need migration', () => {
    // Add mock chat data to localStorage
    localStorage.setItem('advui.chats.store.v1', JSON.stringify(mockChatData))

    const status = getMigrationStatus()
    expect(status.chatsInLocalStorage).toBe(1)
  })

  it('should validate migration status structure', () => {
    const status = getMigrationStatus()

    // Verify all required properties exist
    expect(status).toHaveProperty('completed')
    expect(status).toHaveProperty('needsMigration')
    expect(status).toHaveProperty('chatsInLocalStorage')
    expect(status).toHaveProperty('indexedDBAvailable')
  })
})
