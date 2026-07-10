// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import { mount, unmount, flushSync } from 'svelte'
import App from './App.svelte'

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

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

describe('App settings modal integration', () => {
  beforeEach(() => {
    localStorage.clear()
    document.body.innerHTML = ''
  })

  it('opens settings from the sidebar and closes it again', async () => {
    const component = mount(App, { target: document.body })
    flushSync()
    // Let deferred startup (setTimeout 0 + async storage) settle
    await sleep(50)
    flushSync()

    // Open settings
    const settingsBtn = document.querySelector('[aria-label="Settings"], [title="Settings"]') as HTMLButtonElement
    expect(settingsBtn, 'sidebar settings button').toBeTruthy()
    settingsBtn.click()
    flushSync()
    expect(document.querySelector('.modal'), 'modal should open').toBeTruthy()

    // Close via the X button
    const closeBtn = document.querySelector('.modal-head .icon-btn') as HTMLButtonElement
    expect(closeBtn, 'close button').toBeTruthy()
    closeBtn.click()
    flushSync()
    await sleep(20)
    flushSync()
    expect(document.querySelector('.modal'), 'modal should close').toBeFalsy()

    // Reopen and close via Escape
    settingsBtn.click()
    flushSync()
    expect(document.querySelector('.modal')).toBeTruthy()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    flushSync()
    expect(document.querySelector('.modal')).toBeFalsy()

    await unmount(component)
  })
})
