import { indexedDB, IDBObjectStore } from 'fake-indexeddb';
import { afterEach, expect, it, vi } from 'vitest';
import * as chats from './storage.indexeddb';
import { storeImage, getImage, getAllImages } from './imageStore';
import { putCharacter, getCharacter, getAllCharacters } from './tavern/charactersStore';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); chats.closeDB(); });

it('rejects rolled-back chat, media, and character writes without announcing success', async () => {
  vi.stubGlobal('indexedDB', indexedDB);
  const original = IDBObjectStore.prototype.put;
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
    const request = original.apply(this, args);
    request.addEventListener('success', () => this.transaction.abort());
    return request;
  });
  const change = vi.fn();
  const unsubscribe = chats.subscribeChatStorage(change);
  try {
    await expect(chats.putChat({ id: 'aborted', nodes: [], rootId: null, settings: {}, title: 'Test', updatedAt: 1 } as any)).rejects.toThrow();
    expect(await chats.getChat('aborted')).toBeNull();
    expect(change).not.toHaveBeenCalled();
    await expect(storeImage('aborted', 'YWJj', 'image/png', 'test.png')).rejects.toThrow();
    expect(await getImage('aborted')).toBeFalsy();
    await expect(putCharacter({ id: 'aborted', name: 'Test' } as any)).rejects.toThrow();
    expect(await getCharacter('aborted')).toBeNull();
  } finally { unsubscribe(); }
});

it('propagates media and character read failures to backup callers', async () => {
  vi.stubGlobal('indexedDB', indexedDB);
  vi.spyOn(IDBObjectStore.prototype, 'getAll').mockImplementation(() => { throw new Error('read unavailable'); });
  await expect(getAllImages()).rejects.toThrow('read unavailable');
  await expect(getAllCharacters()).rejects.toThrow('read unavailable');
});
