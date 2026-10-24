// @vitest-environment happy-dom
import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { mount, unmount, flushSync } from 'svelte'
import App from './App.svelte'
import { createChat, getChatListItems, deleteChat } from './lib/chatsStore'

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
    expect(document.querySelector('.ui-modal'), 'modal should open').toBeTruthy()

    // Close via the X button
    const closeBtn = document.querySelector('.ui-modal-head .ui-icon-btn') as HTMLButtonElement
    expect(closeBtn, 'close button').toBeTruthy()
    closeBtn.click()
    flushSync()
    await sleep(20)
    flushSync()
    expect(document.querySelector('.ui-modal'), 'modal should close').toBeFalsy()

    // Reopen and close via Escape
    settingsBtn.click()
    flushSync()
    expect(document.querySelector('.ui-modal')).toBeTruthy()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    flushSync()
    expect(document.querySelector('.ui-modal')).toBeFalsy()

    await unmount(component)
  })

  it('removes the last deleted chat before showing its replacement', async () => {
    for (const chat of await getChatListItems()) await deleteChat(chat.id)
    const created = await createChat({ title: 'Delete me' })
    const component = mount(App, { target: document.body })
    try {
      await vi.waitFor(() => { flushSync(); expect(document.querySelectorAll('.chat-row')).toHaveLength(1) })
      ;(document.querySelector('[aria-label="Chat options"]') as HTMLButtonElement).click()
      flushSync()
      const remove = [...document.querySelectorAll<HTMLButtonElement>('.chat-menu-item')].find(button => button.textContent?.trim() === 'Delete')!
      remove.click()
      flushSync()
      ;(document.querySelector('.ui-modal .ui-btn-danger') as HTMLButtonElement).click()
      await vi.waitFor(async () => {
        const list = await getChatListItems()
        expect(list).toHaveLength(1)
        expect(list[0]?.id).not.toBe(created.id)
        flushSync()
        expect(document.querySelectorAll('.chat-row')).toHaveLength(1)
        expect(document.querySelector('.chat-title')?.textContent).not.toBe('Delete me')
      })
    } finally {
      await unmount(component)
    }
  })
})
