// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, unmount, flushSync } from 'svelte'
import SettingsModal from './SettingsModal.svelte'

const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = String(value) },
    removeItem: (key: string) => { delete store[key] },
    clear: () => { store = {} },
    get length() { return Object.keys(store).length },
    key: (index: number) => Object.keys(store)[index] ?? null,
  }
})()
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true })

describe('SettingsModal', () => {
  beforeEach(() => {
    localStorage.clear()
    document.body.innerHTML = ''
  })

  it('renders when open and calls onClose from the close button', async () => {
    const onClose = vi.fn()
    const component = mount(SettingsModal, {
      target: document.body,
      props: { open: true, onClose },
    })
    flushSync()

    expect(document.querySelector('.modal')).toBeTruthy()

    const closeBtn = document.querySelector('.modal-head .icon-btn') as HTMLButtonElement
    expect(closeBtn).toBeTruthy()
    closeBtn.click()
    flushSync()

    expect(onClose).toHaveBeenCalledTimes(1)
    await unmount(component)
  })

  it('calls onClose when the backdrop is clicked', async () => {
    const onClose = vi.fn()
    const component = mount(SettingsModal, {
      target: document.body,
      props: { open: true, onClose },
    })
    flushSync()

    const backdrop = document.querySelector('.backdrop') as HTMLButtonElement
    expect(backdrop).toBeTruthy()
    backdrop.click()
    flushSync()

    expect(onClose).toHaveBeenCalledTimes(1)
    await unmount(component)
  })

  it('closes via Escape after switching tabs and editing settings', async () => {
    vi.useFakeTimers()
    const onClose = vi.fn()
    const onSaved = vi.fn()
    const component = mount(SettingsModal, {
      target: document.body,
      props: { open: true, onClose, onSaved },
    })
    flushSync()

    // Switch to connections tab and back
    ;(document.getElementById('settings-tab-connection') as HTMLButtonElement).click()
    flushSync()
    ;(document.getElementById('settings-tab-general') as HTMLButtonElement).click()
    flushSync()

    // Edit a setting (debug switch) to trigger the debounced persist
    const debugSwitch = document.querySelector('.developer-group input[type="checkbox"]') as HTMLInputElement
    expect(debugSwitch).toBeTruthy()
    debugSwitch.click()
    flushSync()
    await vi.runAllTimersAsync()
    expect(onSaved).toHaveBeenCalled()

    // Escape closes
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    flushSync()
    expect(onClose).toHaveBeenCalledTimes(1)

    vi.useRealTimers()
    await unmount(component)
  })

  it('switches between all tabs without crashing', async () => {
    const component = mount(SettingsModal, {
      target: document.body,
      props: { open: true },
    })
    flushSync()

    for (const id of ['features', 'connection', 'presets', 'general']) {
      const tab = document.getElementById(`settings-tab-${id}`) as HTMLButtonElement
      expect(tab).toBeTruthy()
      tab.click()
      flushSync()
      expect(tab.getAttribute('aria-selected')).toBe('true')
    }
    await unmount(component)
  })
})
