import { describe, it, expect, beforeEach, vi } from 'vitest'

const storageMock = vi.hoisted(() => ({
  updateChatAtomic: vi.fn(),
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
    storageMock.updateChatAtomic.mockImplementation(async (_id, updater) => updater(null))
    localStorage.setItem(OLD_LS_KEY, JSON.stringify(mockChatData))
  })

  it('migrates legacy data written after an earlier completed migration', async () => {
    // Older builds could fall back to localStorage after migrating, leaving
    // newer chats there. A completed flag must not hide them.
    localStorage.setItem(MIGRATION_FLAG_KEY, JSON.stringify({ completed: true, stats: { migrated: 1, failed: 0, skipped: 0 } }))
    localStorage.setItem('storage.backend.v1', 'localstorage')

    const result = await migrateChatsToIndexedDB()

    expect(result).toMatchObject({ success: true, migrated: 2 })
    expect(localStorage.getItem(OLD_LS_KEY)).toBeNull()
    expect(localStorage.getItem('storage.backend.v1')).toBeNull()
  })

  it('does not mark migration as completed when every chat fails', async () => {
    storageMock.updateChatAtomic.mockRejectedValue(new Error('write failed'))

    const result = await migrateChatsToIndexedDB()

    expect(result.success).toBe(false)
    expect(result.migrated).toBe(0)
    expect(result.failed).toBe(2)
    expect(result.reason).toBe('Migration failed for all chats')
    expect(localStorage.getItem(MIGRATION_FLAG_KEY)).toBeNull()
    expect(localStorage.getItem(OLD_LS_KEY)).not.toBeNull()

    // A later attempt retries instead of reporting "Already completed"
    storageMock.updateChatAtomic.mockImplementation(async (_id, updater) => updater(null))
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
  it('retries partial failures without overwriting chats already migrated', async () => {
    const destination = new Map();
    let fail = true;
    storageMock.updateChatAtomic.mockImplementation(async (id, updater) => {
      if (id === 'chat-2' && fail) throw new Error('temporary failure');
      const next = updater(destination.get(id) || null);
      if (next !== undefined) destination.set(id, next);
      return destination.get(id);
    });
    const first = await migrateChatsToIndexedDB();
    expect(first.success).toBe(false);
    expect(first.failed).toBe(1);
    expect(localStorage.getItem(MIGRATION_FLAG_KEY)).toBeNull();
    destination.set('chat-1', { ...destination.get('chat-1'), title: 'edited after migration' });
    fail = false;
    const retry = await migrateChatsToIndexedDB();
    expect(retry).toMatchObject({ success: true, skipped: 1, migrated: 1, failed: 0 });
    expect(destination.get('chat-1').title).toBe('edited after migration');
    expect(localStorage.getItem(OLD_LS_KEY)).toBeNull();
  });

  it('recovers legacy partial-completion flags and migrates a newer source record', async () => {
    localStorage.setItem(MIGRATION_FLAG_KEY, JSON.stringify({ completed: true, stats: { failed: 1 } }));
    const destination = new Map([['chat-1', { ...mockChatData.byId['chat-1'], title: 'older destination', updatedAt: 0 }]]);
    storageMock.updateChatAtomic.mockImplementation(async (id, updater) => {
      const next = updater(destination.get(id) || null);
      if (next !== undefined) destination.set(id, next);
      return destination.get(id);
    });
    const result = await migrateChatsToIndexedDB();
    expect(result).toMatchObject({ success: true, migrated: 2 });
    expect(destination.get('chat-1').title).toBe('Test Chat 1');
  });

})
