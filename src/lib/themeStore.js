import { safeRead, safeWrite } from './utils/localStorageHelper.js'

const THEME_KEY = 'ui.theme.preference.v1'
const THEME_VALUES = new Set(['light', 'dark', 'system'])
export const THEME_OPTIONS = ['light', 'dark', 'system']

let currentMode = 'system'
let resolvedTheme = 'light'
let systemMediaQuery = null
const listeners = new Set()
let initialized = false

function normalizeMode(mode) {
  if (typeof mode !== 'string') return 'system'
  const trimmed = mode.trim().toLowerCase()
  return THEME_VALUES.has(trimmed) ? trimmed : 'system'
}

function ensureSystemMediaListener() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
  if (systemMediaQuery) return
  systemMediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
  const handler = (event) => {
    if (currentMode === 'system') {
      applyTheme('system', event.matches ? 'dark' : 'light')
    }
  }
  if (typeof systemMediaQuery.addEventListener === 'function') {
    systemMediaQuery.addEventListener('change', handler)
  } else if (typeof systemMediaQuery.addListener === 'function') {
    systemMediaQuery.addListener(handler)
  }
}

function getSystemTheme() {
  if (!systemMediaQuery) {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return 'light'
    }
    systemMediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
  }
  return systemMediaQuery.matches ? 'dark' : 'light'
}

function readStoredMode() {
  const stored = safeRead(THEME_KEY, 'system', (value) => (typeof value === 'string' ? value : 'system'))
  return normalizeMode(stored)
}

function persistMode(mode) {
  safeWrite(THEME_KEY, mode)
}

function applyDocumentAttributes(mode, theme) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (!root) return
  root.setAttribute('data-theme', theme)
  root.setAttribute('data-theme-mode', mode)
  root.style.colorScheme = theme === 'dark' ? 'dark' : 'light'
}

function notifyListeners(state) {
  listeners.forEach((listener) => {
    try { listener(state) } catch {
      /* ignore listener errors */
    }
  })
}

function applyTheme(mode, themeOverride = null) {
  const normalizedMode = normalizeMode(mode)
  const theme = themeOverride || (normalizedMode === 'system' ? getSystemTheme() : normalizedMode)
  currentMode = normalizedMode
  resolvedTheme = theme === 'dark' ? 'dark' : 'light'
  applyDocumentAttributes(currentMode, resolvedTheme)
  notifyListeners({ mode: currentMode, theme: resolvedTheme })
}

export function initTheme() {
  if (initialized) return { mode: currentMode, theme: resolvedTheme }
  ensureSystemMediaListener()
  const mode = readStoredMode()
  applyTheme(mode)
  initialized = true
  return { mode: currentMode, theme: resolvedTheme }
}

export function getThemeState() {
  if (!initialized) return initTheme()
  return { mode: currentMode, theme: resolvedTheme }
}

export function setThemeMode(mode) {
  ensureSystemMediaListener()
  const normalized = normalizeMode(mode)
  persistMode(normalized)
  applyTheme(normalized)
  return { mode: currentMode, theme: resolvedTheme }
}

export function subscribeTheme(listener) {
  if (typeof listener !== 'function') return () => {}
  ensureSystemMediaListener()
  const state = getThemeState()
  try { listener(state) } catch {
    /* ignore listener errors */
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
