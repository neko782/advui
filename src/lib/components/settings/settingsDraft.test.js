import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { SettingsDraft } from './settingsDraft.svelte';
import SettingsModalHarness from './__fixtures__/SettingsModalHarness.svelte';
import { loadSettings, saveSettings } from '../../settingsStore';
vi.mock('../../utils/exportImport', () => ({
  estimateExportAllDataSize: async () => ({ bytes: 0 }), exportAllData: vi.fn(), importAllData: vi.fn(), importChat: vi.fn(),
}));
const storageValues = new Map();
const localStorageMock = {
  getItem: key => storageValues.get(key) ?? null,
  setItem: (key, value) => storageValues.set(key, String(value)),
  removeItem: key => storageValues.delete(key),
  clear: () => storageValues.clear(),
};
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });
beforeEach(() => { localStorageMock.clear(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });
it('reloads settings on opening and preserves Tavern changes when saving another setting', async () => {
  const component = mount(SettingsModalHarness, { target: document.body });
  flushSync();
  saveSettings({ ...loadSettings(), tavernPerChatPresets: true, tavernAvatarShape: 'card' });
  component.show(); flushSync();
  document.getElementById('settings-tab-features').click(); flushSync();
  await vi.waitFor(() => { flushSync(); expect(document.querySelector('input[aria-label="Fancy effects"]')).toBeTruthy(); });
  document.querySelector('input[aria-label="Fancy effects"]').click(); flushSync();
  await vi.runAllTimersAsync();
  expect(loadSettings()).toMatchObject({ tavernPerChatPresets: true, tavernAvatarShape: 'card', fancyEffects: true });
  await unmount(component);
});
it.each(['responses', 'gemini', 'chat_completions'])('applies tool defaults to new presets only for Responses (%s)', apiMode => {
  saveSettings({ connections: [{ id: 'conn', name: 'Test', apiKey: '', apiBaseUrl: '', apiMode }], selectedConnectionId: 'conn' });
  const draft = new SettingsDraft();
  draft.local.defaultTools = { webSearch: true, codeInterpreter: false, shell: true, imageGeneration: false, mcp: true };
  draft.addPreset();
  expect(draft.activePreset).toMatchObject({ webSearchEnabled: apiMode === 'responses', codeInterpreterEnabled: false, shellEnabled: apiMode === 'responses', imageGenerationEnabled: false, mcpEnabled: apiMode === 'responses' });
  draft.reset();
});
