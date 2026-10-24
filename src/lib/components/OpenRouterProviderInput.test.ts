import { afterEach, expect, it, vi } from 'vitest'
import { mount, unmount, flushSync } from 'svelte'
import OpenRouterProviderInput from './OpenRouterProviderInput.svelte'

let component: ReturnType<typeof mount> | undefined
afterEach(async () => {
  if (component) await unmount(component)
  component = undefined
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

it('keeps provider entry and fetching behind its button and forwards manual overrides', async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [{ slug: 'test', name: 'Test' }] }) })
  vi.stubGlobal('fetch', fetch)
  const onInput = vi.fn()
  component = mount(OpenRouterProviderInput, { target: document.body, props: { onInput } })
  flushSync()
  expect(document.querySelector('input')).toBeNull()
  expect(fetch).not.toHaveBeenCalled()
  const button = document.querySelector<HTMLButtonElement>('[aria-label="OpenRouter provider"]')!
  button.click(); flushSync()
  await vi.waitFor(() => { flushSync(); expect(document.querySelector('option')?.value).toBe('test') })
  const input = document.querySelector<HTMLInputElement>('input')!
  input.value = 'manual-provider'
  input.dispatchEvent(new Event('input', { bubbles: true }))
  expect(onInput).toHaveBeenCalledWith('manual-provider')
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  flushSync()
  expect(button.getAttribute('aria-expanded')).toBe('false')
  expect(document.querySelector('input')).toBeNull()
})
