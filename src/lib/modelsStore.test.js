import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('./openaiClient.js', () => ({ listModels: vi.fn(async () => ['available-model']) }));
import { listModels } from './openaiClient';
import { ensureModels, refreshModels, setModelsCache } from './modelsStore';
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
it('uses an empty cache without fetching models, even with saved credentials', async () => {
  expect((await ensureModels({ connectionId: 'conn' })).ids).toEqual([]);
  expect(listModels).not.toHaveBeenCalled();
});
it('uses cached models without a network request', async () => {
  setModelsCache('conn', ['cached-model']);
  expect((await ensureModels({ connectionId: 'conn' })).ids).toEqual(['cached-model']);
  expect(listModels).not.toHaveBeenCalled();
});
it('fetches models from saved credentials only on refresh', async () => {
  expect((await refreshModels({ connectionId: 'conn' })).ids).toEqual(['available-model']);
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
