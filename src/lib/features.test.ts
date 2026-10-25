import { afterEach, expect, it, vi } from 'vitest';
import { backgroundFeatures, feature, loadFeature, loadedFeatures, preloadFeatures } from './features.svelte';
import { SETTINGS_KEY, loadSettings, saveSettings } from './settingsStore';
import * as idleWork from './utils/idleWork';

afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('respects Data Saver without scheduling background imports', () => {
  const schedule = vi.spyOn(idleWork, 'scheduleIdleWork');
  vi.stubGlobal('navigator', { connection: { saveData: true } });
  preloadFeatures(['general'])();
  expect(schedule).not.toHaveBeenCalled();
});

it('preloads the common UI without math or unused Tavern editors', () => {
  const keys = backgroundFeatures({ renderLatex: false }, false);
  expect(keys).toContain('settings');
  expect(keys).toContain('markdown');
  expect(keys).toContain('tavernSidebar');
  expect(keys).not.toContain('latex');
  expect(keys).not.toContain('characterEditor');
  expect(backgroundFeatures({ renderLatex: true }, true)).toEqual(expect.arrayContaining(['latex', 'characterEditor', 'tavernSettings']));
});

it('shares an in-flight import and exposes the completed module synchronously', async () => {
  const first = loadFeature('characterCard');
  expect(loadFeature('characterCard')).toBe(first);
  const module = await first;
  expect(feature('characterCard')).toBe(module);
  expect(loadedFeatures.characterCard).toBe(module);
});

it('defaults new and legacy settings to LaTeX off, preserving explicit preferences', () => {
  localStorage.clear();
  expect(loadSettings().renderLatex).toBe(false);
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ debug: true }));
  expect(loadSettings().renderLatex).toBe(false);
  expect(saveSettings({ renderLatex: true }).renderLatex).toBe(true);
  expect(loadSettings().renderLatex).toBe(true);
  expect(saveSettings({ renderLatex: false }).renderLatex).toBe(false);
  expect(loadSettings().renderLatex).toBe(false);
});
