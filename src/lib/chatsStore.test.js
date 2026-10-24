import { beforeEach, describe, expect, it, vi } from 'vitest';
const records = vi.hoisted(() => new Map());
vi.mock('./storage.js', () => ({
  getAllChats: async () => [...records.values()],
  getChatListItems: async () => [...records.values()],
  getChat: async id => records.get(id) || null,
  putChatAtomic: async chat => { records.set(chat.id, chat); return chat; },
  updateChatAtomic: vi.fn(async (id, updater) => {
    const next = await updater(records.get(id) || null);
    if (next !== undefined) records.set(id, next);
    return records.get(id) || null;
  }),
  deleteChatAtomic: vi.fn(),
}));
import { createChat, getChat, renameChat, saveChatContent } from './chatsStore';
import { saveSettings } from './settingsStore';
import { updateChatAtomic } from './storage';
import { loadChatSettings, normalizePreset } from './utils/presetHelpers';

const storageValues = new Map();
const localStorageMock = {
  getItem: key => storageValues.get(key) ?? null,
  setItem: (key, value) => storageValues.set(key, String(value)),
  removeItem: key => storageValues.delete(key),
  clear: () => storageValues.clear(),
};
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });
beforeEach(() => { records.clear(); localStorageMock.clear(); vi.clearAllMocks(); saveSettings({}); });
const network = {
  codeInterpreterNetworkEnabled: true, codeInterpreterAllowedDomains: 'example.org',
  shellNetworkEnabled: true, shellAllowedDomains: 'example.com',
};
describe('chat persistence round trips', () => {
  it('preserves tool network settings through create, save, and reload', async () => {
    const created = await createChat({ nodes: [], settings: network });
    expect(created.chat.settings).toMatchObject(network);
    const saved = await saveChatContent(created.id, { settings: network });
    expect(saved.settings).toMatchObject(network);
    const loaded = loadChatSettings(await getChat(created.id), normalizePreset({}), null);
    expect(loaded).toMatchObject(network);
    const cleared = await saveChatContent(created.id, { settings: {
      codeInterpreterNetworkEnabled: false, codeInterpreterAllowedDomains: undefined,
      shellNetworkEnabled: false, shellAllowedDomains: undefined,
    } });
    expect(cleared.settings).toMatchObject({ codeInterpreterNetworkEnabled: false, shellNetworkEnabled: false });
    const clearedReloaded = loadChatSettings(JSON.parse(JSON.stringify(cleared)), normalizePreset({ codeInterpreterAllowedDomains: 'preset.example', shellAllowedDomains: 'preset.example' }), null);
    expect(clearedReloaded.codeInterpreterAllowedDomains).toBe('');
    expect(clearedReloaded.shellAllowedDomains).toBe('');
  });
  it('propagates storage failures to the persistence retry handler', async () => {
    updateChatAtomic.mockRejectedValueOnce(new Error('write failed'));
    await expect(saveChatContent('chat', {})).rejects.toThrow('write failed');
  });
  it('preserves manually renamed titles while continuing to auto-title ordinary chats', async () => {
    const created = await createChat({ messages: [{ role: 'user', content: 'Hello' }] });
    const nodes = [{ ...created.chat.nodes[0], variants: [{ ...created.chat.nodes[0].variants[0], content: 'Updated' }] }];
    expect((await saveChatContent(created.id, { nodes })).title).toBe('Updated');
    await renameChat(created.id, 'Custom title');
    expect((await saveChatContent(created.id, { nodes })).title).toBe('Custom title');
  });
  it('preserves legacy renamed titles without a manual-title marker', async () => {
    records.set('legacy', { id: 'legacy', title: 'Custom title', nodes: [], rootId: null, settings: {} });
    expect((await saveChatContent('legacy', {})).title).toBe('Custom title');
  });
});
