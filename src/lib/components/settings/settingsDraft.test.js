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
it.each(['responses', 'gemini', 'chat_completions'])('copies tools into new presets only for Responses (%s)', apiMode => {
  saveSettings({ connections: [{ id: 'conn', name: 'Test', apiKey: '', apiBaseUrl: '', apiMode }], selectedConnectionId: 'conn' });
  const draft = new SettingsDraft();
  draft.selectPreset(draft.presets[0].id);
  draft.updateActivePreset({ connectionId: 'conn', webSearchEnabled: true, codeInterpreterEnabled: false, shellEnabled: true, imageGenerationEnabled: false, mcpEnabled: true });
  draft.addPreset();
  expect(draft.activePreset).toMatchObject({ webSearchEnabled: apiMode === 'responses', codeInterpreterEnabled: false, shellEnabled: apiMode === 'responses', imageGenerationEnabled: false, mcpEnabled: apiMode === 'responses' });
  draft.reset();
});
it('shows a message button on exactly the selected roles and hides it when none are left', () => {
  const draft = new SettingsDraft();
  const action = id => draft.messageActions.find(a => a.id === id);
  // Fork is off by default: picking a role turns it on for that role only.
  draft.toggleMessageActionRole('fork', 'assistant');
  expect(action('fork')).toMatchObject({ enabled: true, roles: { user: false, assistant: true, system: false } });
  draft.toggleMessageActionRole('fork', 'assistant');
  expect(action('fork').enabled).toBe(false);
  draft.toggleMessageActionRole('copy', 'system');
  expect(action('copy')).toMatchObject({ enabled: true, roles: { user: true, assistant: true, system: false } });
  draft.reset();
});
it('switches a tool off app-wide and back on', () => {
  const draft = new SettingsDraft();
  draft.setToolDisabled('shell', true);
  expect(draft.disabledTools).toEqual({ shell: true });
  draft.setToolDisabled('shell', false);
  expect(draft.disabledTools).toEqual({});
  draft.reset();
});
