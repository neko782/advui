import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('./openaiClient.js', () => ({ listModels: vi.fn(async () => ['available-model']) }));
import { listModels } from './openaiClient';
import { ensureModels, refreshModels } from './modelsStore';
import { saveSettings } from './settingsStore';
const storageValues = new Map();
const localStorageMock = {
  getItem: key => storageValues.get(key) ?? null,
  setItem: (key, value) => storageValues.set(key, String(value)),
  removeItem: key => storageValues.delete(key),
  clear: () => storageValues.clear(),
};
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });
beforeEach(() => {
  localStorageMock.clear(); vi.clearAllMocks();
  saveSettings({ connections: [{ id: 'conn', name: 'Connection', apiKey: 'saved-key', apiBaseUrl: 'https://example.test/v1', apiMode: 'chat_completions' }], selectedConnectionId: 'conn' });
});
it('fetches models from saved credentials for a connectionId object', async () => {
  expect((await ensureModels({ connectionId: 'conn' })).ids).toEqual(['available-model']);
  expect(listModels).toHaveBeenCalledWith({ connectionId: 'conn', apiKey: 'saved-key', apiBaseUrl: 'https://example.test/v1', apiMode: 'chat_completions' });
  await ensureModels({ connectionId: 'conn' });
  expect(listModels).toHaveBeenCalledTimes(1);
});
it('honors explicit credential overrides when refreshing a saved connection', async () => {
  await refreshModels({ connectionId: 'conn', apiKey: 'override', apiBaseUrl: 'https://override.test/v1' });
  expect(listModels).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'override', apiBaseUrl: 'https://override.test/v1', apiMode: 'chat_completions' }));
});
it('does not replace an explicitly empty key with the stored key', async () => {
  await expect(refreshModels({ connectionId: 'conn', apiKey: '' })).rejects.toThrow('Missing API key');
  expect(listModels).not.toHaveBeenCalled();
});
