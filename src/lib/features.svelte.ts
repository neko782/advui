import { scheduleIdleWork } from './utils/idleWork';
import type { Settings } from './types';

const loaders = {
  settings: () => import('./SettingsModal.svelte'),
  general: () => import('./components/settings/GeneralTab.svelte'),
  features: () => import('./components/settings/FeaturesTab.svelte'),
  connections: () => import('./components/settings/ConnectionsTab.svelte'),
  presets: () => import('./components/settings/PresetsTab.svelte'),
  markdown: () => import('./components/chat/MarkdownContent.svelte'),
  latex: () => import('./utils/latex'),
  tavernSidebar: () => import('./components/tavern/TavernSidebar.svelte'),
  tavernSettings: () => import('./components/tavern/TavernSettingsModal.svelte'),
  characterEditor: () => import('./components/tavern/CharacterEditorModal.svelte'),
  characterCard: () => import('./tavern/characterCard'),
  tavernChat: () => import('./tavern/tavernChat'),
  archives: () => import('./utils/exportImport'),
  tar: () => import('tar-js'),
  untar: () => import('js-untar'),
};

export type Feature = keyof typeof loaders;
type Modules = { [K in Feature]: Awaited<ReturnType<typeof loaders[K]>> };
export const loadedFeatures: Partial<Modules> = $state({});
const pending = new Map<Feature, Promise<unknown>>();

/** User actions and idle work share both the in-flight import and its result. */
export function loadFeature<K extends Feature>(key: K): Promise<Modules[K]> {
  const cached = loadedFeatures[key];
  if (cached) return Promise.resolve(cached);
  const existing = pending.get(key);
  if (existing) return existing as Promise<Modules[K]>;
  const request = loaders[key]().then(module => {
    loadedFeatures[key] = module as Modules[K];
    pending.delete(key);
    return module as Modules[K];
  }, error => {
    pending.delete(key);
    throw error;
  });
  pending.set(key, request);
  return request;
}

/** A fulfilled module is synchronous, so Svelte skips the loading state. */
export function feature<K extends Feature>(key: K): Modules[K] | Promise<Modules[K]> {
  return loadedFeatures[key] ?? loadFeature(key);
}

export function backgroundFeatures(settings: Pick<Settings, 'renderLatex'>, tavern: boolean): Feature[] {
  const keys: Feature[] = ['settings', 'general', 'features', 'connections', 'presets', 'markdown', 'tavernSidebar', 'archives', 'tar', 'untar'];
  if (settings.renderLatex) keys.push('latex');
  if (tavern) keys.push('tavernSettings', 'characterEditor', 'characterCard', 'tavernChat');
  return keys;
}

export function preloadFeatures(keys: Feature[]): () => void {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (__OFFLINE_BUILD__ || connection?.saveData) return () => {};
  return scheduleIdleWork(keys.filter(key => !loadedFeatures[key]).map(key => () => loadFeature(key)));
}
