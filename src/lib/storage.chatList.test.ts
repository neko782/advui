import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as storage from './storage.indexeddb';
import type { Chat } from './types';

function chat(id: string, updatedAt = 1): Chat {
  return { id, title: id, updatedAt, nodes: [], rootId: null, presetId: null, settings: {} as Chat['settings'] };
}

beforeEach(() => {
  storage.closeDB();
  vi.stubGlobal('indexedDB', new IDBFactory());
});
afterEach(() => {
  vi.restoreAllMocks();
  storage.closeDB();
  vi.unstubAllGlobals();
});

it('backfills legacy chats once, including chats absent from the timestamp index', async () => {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('advui_chats', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('chats', { keyPath: 'id' })
        .createIndex('idx_updatedAt', 'updatedAt');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const legacy = { ...chat('legacy', 20), title: '   ', characterId: 'character', locked: true,
    nodes: [{ id: 1, active: 0, variants: [{ id: 1, role: 'assistant', content: 'partial', typing: true, next: null }] }] };
  const tx = db.transaction('chats', 'readwrite');
  tx.objectStore('chats').put(legacy);
  tx.objectStore('chats').put({ ...chat('no-date'), updatedAt: undefined });
  tx.objectStore('chats').put(chat('recent', 30));
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
  db.close();

  expect(await storage.getChatListItems()).toEqual([
    { id: 'recent', title: 'recent', updatedAt: 30, characterId: undefined },
    { id: 'legacy', title: 'New Chat', updatedAt: 20, characterId: 'character' },
    { id: 'no-date', title: 'no-date', updatedAt: 0, characterId: undefined },
  ]);
  expect(await storage.getChat('legacy')).toEqual(legacy);

  storage.closeDB();
  const cursor = vi.spyOn(IDBObjectStore.prototype, 'openCursor');
  const all = vi.spyOn(IDBObjectStore.prototype, 'getAll');
  expect(await storage.getChatListItems()).toHaveLength(3);
  expect(cursor).not.toHaveBeenCalled();
  expect(all.mock.contexts.map(store => (store as IDBObjectStore).name)).toEqual(['chatListItems']);
});

it('retries an aborted summary migration without changing the original history', async () => {
  const request = indexedDB.open('advui_chats', 1);
  request.onupgradeneeded = () => {
    request.result.createObjectStore('chats', { keyPath: 'id' }).put(chat('legacy', 42));
  };
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  const put = IDBObjectStore.prototype.put;
  const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
    const write = put.apply(this, args);
    if (this.name === 'chatListItems') write.addEventListener('success', () => this.transaction.abort());
    return write;
  });
  await expect(storage.openDatabase()).rejects.toThrow();
  spy.mockRestore();
  await storage.openDatabase();
  expect(await storage.getChat('legacy')).toEqual(chat('legacy', 42));
  expect(await storage.getChatListItems()).toEqual([
    { id: 'legacy', title: 'legacy', updatedAt: 42, characterId: undefined },
  ]);
});

it('bulk-loads only summaries and keeps titles, character ownership, order, and deletion current', async () => {
  await storage.putChat(chat('older', 10));
  await storage.putChat(chat('newer', 20));
  const all = vi.spyOn(IDBObjectStore.prototype, 'getAll');
  const cursor = vi.spyOn(IDBObjectStore.prototype, 'openCursor');
  expect((await storage.getChatListItems()).map(item => item.id)).toEqual(['newer', 'older']);
  expect(all.mock.contexts.map(store => (store as IDBObjectStore).name)).toEqual(['chatListItems']);
  expect(cursor).not.toHaveBeenCalled();

  await storage.putChat({ ...chat('older', 30), title: 'Renamed', characterId: 'cat' });
  expect(await storage.getChatListItems()).toEqual([
    { id: 'older', title: 'Renamed', characterId: 'cat', updatedAt: 30 },
    { id: 'newer', title: 'newer', characterId: undefined, updatedAt: 20 },
  ]);
  await storage.deleteChat('older');
  expect((await storage.getChatListItems()).map(item => item.id)).toEqual(['newer']);
});

it('rolls back both records when a summary write or delete fails', async () => {
  const original = await storage.putChat(chat('chat', 10));
  const put = IDBObjectStore.prototype.put;
  const putSpy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
    const request = put.apply(this, args);
    if (this.name === 'chatListItems') request.addEventListener('success', () => this.transaction.abort());
    return request;
  });
  await expect(storage.putChat({ ...original, title: 'Lost update', updatedAt: 20 })).rejects.toThrow();
  putSpy.mockRestore();
  expect(await storage.getChat('chat')).toEqual(original);
  expect((await storage.getChatListItems())[0]).toMatchObject({ title: 'chat', updatedAt: 10 });

  const remove = IDBObjectStore.prototype.delete;
  vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['delete']>) {
    const request = remove.apply(this, args);
    if (this.name === 'chatListItems') request.addEventListener('success', () => this.transaction.abort());
    return request;
  });
  await expect(storage.deleteChat('chat')).rejects.toThrow();
  expect(await storage.getChat('chat')).toEqual(original);
  expect((await storage.getChatListItems())[0]?.id).toBe('chat');
});

it('does not publish stale summaries after a version conflict', async () => {
  const saved = await storage.putChat(chat('chat', 10));
  await expect(storage.putChat({ ...saved, title: 'Stale', _expectedVersion: 0 })).rejects.toThrow(/concurrent/i);
  expect((await storage.getChatListItems())[0]?.title).toBe('chat');
});
