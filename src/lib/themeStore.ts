import { safeRead, safeWrite } from './utils/localStorageHelper.js';
import type { ThemeMode, ThemeValue, ThemeState, ThemeListener } from './types/index.js';

const THEME_KEY = 'ui.theme.preference.v1';
const THEME_VALUES: ReadonlySet<string> = new Set(['light', 'dark', 'system']);
export const THEME_OPTIONS: readonly ThemeMode[] = ['light', 'dark', 'system'];

let currentMode: ThemeMode = 'system';
let resolvedTheme: ThemeValue = 'light';
let systemMediaQuery: MediaQueryList | null = null;
const listeners = new Set<ThemeListener>();
let initialized = false;

function normalizeMode(mode: unknown): ThemeMode {
  if (typeof mode !== 'string') return 'system';
  const trimmed = mode.trim().toLowerCase();
  return THEME_VALUES.has(trimmed) ? (trimmed as ThemeMode) : 'system';
}

function ensureSystemMediaListener(): void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
  if (systemMediaQuery) return;
  systemMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const handler = (event: MediaQueryListEvent): void => {
    if (currentMode === 'system') {
      applyTheme('system', event.matches ? 'dark' : 'light');
    }
  };
  if (typeof systemMediaQuery.addEventListener === 'function') {
    systemMediaQuery.addEventListener('change', handler);
  } else if (typeof (systemMediaQuery as unknown as { addListener?: (fn: (e: MediaQueryListEvent) => void) => void }).addListener === 'function') {
    (systemMediaQuery as unknown as { addListener: (fn: (e: MediaQueryListEvent) => void) => void }).addListener(handler);
  }
}

function getSystemTheme(): ThemeValue {
  if (!systemMediaQuery) {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return 'light';
    }
    systemMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  }
  return systemMediaQuery.matches ? 'dark' : 'light';
}

function readStoredMode(): ThemeMode {
  const stored = safeRead<string>(THEME_KEY, 'system', (value) => (typeof value === 'string' ? value : 'system'));
  return normalizeMode(stored);
}

function persistMode(mode: ThemeMode): void {
  safeWrite(THEME_KEY, mode);
}

function applyDocumentAttributes(mode: ThemeMode, theme: ThemeValue): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (!root) return;
  root.setAttribute('data-theme', theme);
  root.setAttribute('data-theme-mode', mode);
  root.style.colorScheme = theme === 'dark' ? 'dark' : 'light';
}

function notifyListeners(state: ThemeState): void {
  listeners.forEach((listener) => {
    try { listener(state); } catch {
      /* ignore listener errors */
    }
  });
}

function applyTheme(mode: ThemeMode, themeOverride: ThemeValue | null = null): void {
  const normalizedMode = normalizeMode(mode);
  const theme = themeOverride || (normalizedMode === 'system' ? getSystemTheme() : normalizedMode as ThemeValue);
  currentMode = normalizedMode;
  resolvedTheme = theme === 'dark' ? 'dark' : 'light';
  applyDocumentAttributes(currentMode, resolvedTheme);
  notifyListeners({ mode: currentMode, theme: resolvedTheme });
}

export function initTheme(): ThemeState {
  if (initialized) return { mode: currentMode, theme: resolvedTheme };
  ensureSystemMediaListener();
  const mode = readStoredMode();
  applyTheme(mode);
  initialized = true;
  return { mode: currentMode, theme: resolvedTheme };
}

export function getThemeState(): ThemeState {
  if (!initialized) return initTheme();
  return { mode: currentMode, theme: resolvedTheme };
}

export function setThemeMode(mode: ThemeMode): ThemeState {
  ensureSystemMediaListener();
  const normalized = normalizeMode(mode);
  persistMode(normalized);
  applyTheme(normalized);
  return { mode: currentMode, theme: resolvedTheme };
}

export function subscribeTheme(listener: ThemeListener): () => void {
  if (typeof listener !== 'function') return () => {};
  ensureSystemMediaListener();
  const state = getThemeState();
  try { listener(state); } catch {
    /* ignore listener errors */
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

