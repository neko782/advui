import { Blob as NodeBlob } from 'node:buffer';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const stores = vi.hoisted(() => ({ chats: new Map(), images: new Map(), characters: new Map() }));
vi.mock('../chatsStore.js', () => ({
  getChatListItems: async () => [...stores.chats.values()],
  getChat: async (id: string) => stores.chats.get(id),
  createChat: vi.fn(async (chat) => {
    const restored = { ...chat, id: 'restored' };
    stores.chats.set(restored.id, restored);
    return { id: restored.id, chat: restored };
  }),
}));
vi.mock('../imageStore.js', () => ({
  getAllImages: vi.fn(async () => [...stores.images.values()]),
  getImage: async (id: string) => stores.images.get(id) || null,
  storeImage: async (id: string, data: string, mimeType: string, name: string) => stores.images.set(id, { id, data, mimeType, name }),
}));
vi.mock('../tavern/charactersStore.js', () => ({
  getAllCharacters: vi.fn(async () => [...stores.characters.values()]),
  getCharacter: async (id: string) => stores.characters.get(id),
  putCharacter: async (character: { id: string }) => stores.characters.set(character.id, character),
}));
vi.mock('../settingsStore.js', () => ({ loadSettings: () => ({}), saveSettings: vi.fn() }));
// Read actual exported TAR headers without js-untar's browser Worker dependency.
vi.mock('js-untar', () => ({ default: async (buffer: ArrayBuffer) => {
  const bytes = new Uint8Array(buffer);
  const decoder = new TextDecoder();
  const files = [];
  for (let offset = 0; offset + 512 <= bytes.length && bytes[offset];) {
    const name = decoder.decode(bytes.slice(offset, offset + 100)).replace(/\0.*$/, '');
    const size = parseInt(decoder.decode(bytes.slice(offset + 124, offset + 136)).replace(/\0.*$/, '').trim(), 8);
    files.push({ name, buffer: bytes.slice(offset + 512, offset + 512 + size).buffer });
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
} }));
import { exportAllData, importAllData, exportChat, importChat } from './exportImport';

let downloaded: Blob;
const chat = {
  id: 'original', title: 'Character conversation', characterId: 'char-1', rootId: 1,
  settings: {}, updatedAt: 123,
  nodes: [{ id: 1, active: 0, variants: [
    { id: 1, role: 'user', content: 'Hello', next: null, images: [{ id: 'upload' }] },
    { id: 2, role: 'assistant', content: '', next: null, generatedImages: [{ id: 'generated' }], images: [{ id: 'upload' }] },
  ] }],
};
const character = { id: 'char-1', name: 'Cat', description: 'Character prompt', avatar: 'data:image/png;base64,AQID' };

beforeEach(() => {
  stores.chats.clear(); stores.images.clear(); stores.characters.clear();
  stores.chats.set(chat.id, chat);
  stores.characters.set(character.id, character);
  stores.images.set('upload', { id: 'upload', data: 'AQID', mimeType: 'image/png', name: 'upload.png' });
  stores.images.set('generated', { id: 'generated', data: 'BAUG', mimeType: 'image/png', name: 'generated.png' });
  stores.images.set('unrelated', { id: 'unrelated', data: 'Bw==', mimeType: 'image/png' });
  vi.stubGlobal('Blob', NodeBlob);
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => { downloaded = blob as Blob; return 'blob:test'; });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); delete (window as any).showSaveFilePicker; });

describe('portable chat exports', () => {
  it('restores attachments from all branches and the associated character on an empty store', async () => {
    await exportChat(chat.id);
    const text = await downloaded.text();
    expect(JSON.parse(text).images.map((image: { id: string }) => image.id)).toEqual(['upload', 'generated']);
    stores.chats.clear(); stores.images.clear(); stores.characters.clear();
    const result = await importChat({ text: async () => text } as File);
    expect(result.chat.characterId).toBe(character.id);
    expect(stores.characters.get(character.id)).toEqual(character);
    expect(stores.images.get('upload').data).toBe('AQID');
    expect(stores.images.get('generated').data).toBe('BAUG');
  });
  it('still imports legacy JSON without embedded media or a character', async () => {
    const result = await importChat({ text: async () => JSON.stringify({ type: 'single_chat', chat }) } as File);
    expect(result.chat.characterId).toBe(character.id);
  });
  it('reports missing attachments instead of creating an incomplete export', async () => {
    stores.images.delete('upload');
    await expect(exportChat(chat.id)).rejects.toThrow('Missing attachment');
  });
});

it.each([false, true])('restores Tavern characters and associations from a TAR backup (streaming=%s)', async (streaming) => {
  const chunks: Uint8Array[] = [];
  if (streaming) {
    (window as any).showSaveFilePicker = async () => ({ createWritable: async () => ({
      write: async (bytes: Uint8Array) => { chunks.push(bytes); }, close: async () => {},
    }) });
  }
  await exportAllData({ includeMedia: true });
  const buffer = streaming
    ? await new NodeBlob(chunks as ConstructorParameters<typeof NodeBlob>[0]).arrayBuffer()
    : await downloaded.arrayBuffer();
  stores.chats.clear(); stores.characters.clear(); stores.images.clear();
  const result = await importAllData({ arrayBuffer: async () => buffer } as File);
  expect(result.errors).toEqual([]);
  expect(result.charactersImported).toBe(1);
  expect(result.chatsImported).toBe(1);
  expect(stores.chats.get('restored').characterId).toBe(character.id);
  expect(stores.characters.get(character.id)).toEqual(character);
  expect(stores.images.get('generated').data).toBe('BAUG');
});

it.each([false, true])('rejects incomplete media backups (streaming=%s)', async (streaming) => {
  const { getAllImages } = await import('../imageStore');
  vi.mocked(getAllImages).mockRejectedValueOnce(new Error('media unavailable'));
  const abort = vi.fn();
  const close = vi.fn();
  if (streaming) (window as any).showSaveFilePicker = async () => ({ createWritable: async () => ({ write: async () => {}, close, abort }) });
  await expect(exportAllData({ includeMedia: true })).rejects.toThrow('media unavailable');
  if (streaming) {
    expect(abort).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
  }
});
it('rejects a backup when characters cannot be read', async () => {
  const { getAllCharacters } = await import('../tavern/charactersStore');
  vi.mocked(getAllCharacters).mockRejectedValueOnce(new Error('characters unavailable'));
  await expect(exportAllData()).rejects.toThrow('characters unavailable');
});
