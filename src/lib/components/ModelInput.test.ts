import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushSync, mount, tick, unmount } from 'svelte'
import ModelInput from './ModelInput.svelte'

let component: ReturnType<typeof mount> | undefined

afterEach(async () => {
  if (component) await unmount(component)
  component = undefined
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

function setup(models = ['vendor/model-alpha', 'vendor/model-beta', 'other/model-beta']) {
  const onInput = vi.fn()
  component = mount(ModelInput, { target: document.body, props: { models, onInput } })
  flushSync()
  const input = document.querySelector<HTMLInputElement>('[role=combobox]')!
  input.focus()
  flushSync()
  return { input, onInput }
}

function type(input: HTMLInputElement, value: string) {
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()
}

async function press(input: HTMLInputElement, key: string) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  input.dispatchEvent(event)
  flushSync()
  await tick()
  return event
}

describe('custom model suggestions', () => {
  it('filters case-insensitively by all search terms and accepts unlisted IDs', () => {
    const { input, onInput } = setup()
    expect(input.hasAttribute('list')).toBe(false)
    expect(document.querySelector('datalist')).toBeNull()
    expect(document.querySelectorAll('[role=option]')).toHaveLength(3)
    type(input, 'BETA vendor')
    expect(document.querySelectorAll('[role=option]')).toHaveLength(1)
    expect(document.querySelector('[role=option]')?.textContent).toBe('vendor/model-beta')
    type(input, 'my-private-model')
    expect(document.querySelector('[role=status]')?.textContent).toContain('No matches')
    expect(onInput).toHaveBeenLastCalledWith('my-private-model')
    expect(input.value).toBe('my-private-model')
  })

  it('selects a touched result without blurring or closing its containing settings', () => {
    const { input, onInput } = setup()
    const option = document.querySelectorAll<HTMLButtonElement>('[role=option]')[1]!
    const down = new Event('pointerdown', { bubbles: true, cancelable: true })
    option.dispatchEvent(down)
    expect(down.defaultPrevented).toBe(true)
    option.click()
    flushSync()
    expect(document.activeElement).toBe(input)
    expect(input.value).toBe('vendor/model-beta')
    expect(onInput).toHaveBeenLastCalledWith('vendor/model-beta')
    expect(input.getAttribute('aria-expanded')).toBe('false')
    type(input, 'alpha')
    expect(document.querySelectorAll('[role=option]')).toHaveLength(1)
  })

  it('supports arrows and Enter, and consumes Escape before the parent closes', async () => {
    const { input, onInput } = setup()
    await press(input, 'ArrowDown')
    const selectedId = input.getAttribute('aria-activedescendant')!
    expect(document.getElementById(selectedId)?.textContent).toBe('vendor/model-alpha')
    await press(input, 'ArrowDown')
    await press(input, 'Enter')
    expect(onInput).toHaveBeenLastCalledWith('vendor/model-beta')
    await press(input, 'ArrowUp')
    const onParentKey = vi.fn()
    window.addEventListener('keydown', onParentKey)
    try {
      expect((await press(input, 'Escape')).defaultPrevented).toBe(true)
      expect(onParentKey).not.toHaveBeenCalled()
      expect(input.getAttribute('aria-expanded')).toBe('false')
      expect(document.activeElement).toBe(input)
      await press(input, 'Escape')
      expect(onParentKey).toHaveBeenCalledTimes(1)
    } finally {
      window.removeEventListener('keydown', onParentKey)
    }
  })

  it('dismisses when focus leaves and bounds large model catalogs', () => {
    const { input } = setup(Array.from({ length: 1000 }, (_, i) => `model-${i}`))
    expect(document.querySelectorAll('[role=option]')).toHaveLength(100)
    expect(document.querySelector('.model-hint')?.textContent).toContain('100 of 1000')
    type(input, 'model-999')
    expect(document.querySelectorAll('[role=option]')).toHaveLength(1)
    input.blur()
    flushSync()
    expect(input.getAttribute('aria-expanded')).toBe('false')
  })

  it('shrinks its results when the visual viewport changes with the keyboard', () => {
    const viewport = new EventTarget()
    Object.defineProperty(viewport, 'height', { value: 240, configurable: true })
    vi.stubGlobal('visualViewport', viewport)
    try {
      setup()
      const suggestions = document.querySelector<HTMLElement>('.suggestions')!
      expect(suggestions.style.getPropertyValue('--model-viewport-height')).toBe('128px')
      Object.defineProperty(viewport, 'height', { value: 180 })
      viewport.dispatchEvent(new Event('resize'))
      flushSync()
      expect(suggestions.style.getPropertyValue('--model-viewport-height')).toBe('68px')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
