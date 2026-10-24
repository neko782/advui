// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount, unmount, flushSync } from 'svelte'
import App from './App.svelte'

// No IndexedDB in this environment: the app must refuse to start rather than
// presenting the outage as an empty chat list (or creating a new chat).

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

describe('App without IndexedDB', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    expect(typeof (globalThis as { indexedDB?: unknown }).indexedDB).toBe('undefined')
  })
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('shows a blocking storage error with a retry button', async () => {
    const component = mount(App, { target: document.body })
    flushSync()
    await sleep(50)
    flushSync()

    const alert = document.querySelector('.storage-unavailable')
    expect(alert, 'storage unavailable screen').toBeTruthy()
    expect(alert?.textContent).toContain('IndexedDB')
    expect(document.querySelector('.chat-pane'), 'chat UI must not render').toBeFalsy()

    const retry = [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Retry')
    expect(retry).toBeTruthy()
    retry!.click()
    await sleep(20)
    flushSync()
    expect(document.querySelector('.storage-unavailable')).toBeTruthy()

    await unmount(component)
  })
})
