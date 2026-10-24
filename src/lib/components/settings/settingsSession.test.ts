import { afterEach, expect, it } from 'vitest'
import { mount, unmount, flushSync } from 'svelte'
import Harness from './__fixtures__/SettingsSessionHarness.svelte'
import { loadSettings } from '../../settingsStore'

let component: { show(id?: 'a' | 'b'): void; hide(): void } | undefined
afterEach(async () => {
  if (component) await unmount(component)
  component = undefined
  document.body.innerHTML = ''
  localStorage.clear()
})

async function frame() { await new Promise(requestAnimationFrame); flushSync() }
function click(selector: string) { (document.querySelector(selector) as HTMLButtonElement).click(); flushSync() }
function scroll(node: HTMLElement, top: number) { node.scrollTop = top; node.dispatchEvent(new Event('scroll')) }

it('retains normal settings tabs, expanded groups, fields and scroll through tab changes and reopening', async () => {
  component = mount(Harness, { target: document.body })
  component.show(); flushSync()
  click('#settings-tab-presets')
  const groups = document.querySelectorAll<HTMLButtonElement>('.preset-group-header')
  groups[1]!.click(); flushSync()
  const editor = document.querySelector<HTMLTextAreaElement>('[aria-label="System prompt"]')!
  editor.style.height = '270px'
  const scroller = editor.closest<HTMLElement>('.ui-modal-scroller')!
  await frame()
  scroll(scroller, 180)
  click('#settings-tab-features')
  click('#settings-tab-presets')
  await frame()
  expect(scroller.scrollTop).toBe(180)
  const name = document.querySelector<HTMLInputElement>('[aria-label="Preset name"]')!
  name.value = 'Saved before closing'
  name.dispatchEvent(new Event('input', { bubbles: true }))
  component.hide(); flushSync()
  component.show(); flushSync()
  await frame()
  expect(document.querySelector('#settings-tab-presets')?.getAttribute('aria-selected')).toBe('true')
  expect(groups[1]!.querySelector('.expanded')).toBeTruthy()
  expect(document.querySelector('[aria-label="System prompt"]')).toBe(editor)
  expect(editor.style.height).toBe('270px')
  expect(scroller.scrollTop).toBe(180)
  expect(loadSettings().presets[0]?.name).toBe('Saved before closing')
})

it('retains Tavern prompt expansion, editor DOM and scroll, and offers the shared collapse editor', async () => {
  component = mount(Harness, { target: document.body, props: { kind: 'tavern' } })
  component.show(); flushSync()
  const tabs = document.querySelectorAll<HTMLButtonElement>('[role=tab]')
  tabs[1]!.click(); flushSync()
  click('.block-title')
  const editor = document.querySelector<HTMLTextAreaElement>('[aria-label="Prompt text"]')!
  editor.style.height = '280px'
  const scroller = editor.closest<HTMLElement>('.ui-modal-scroller')!
  await frame()
  scroll(scroller, 210)
  editor.focus(); flushSync()
  expect(document.querySelector('.collapse-btn')).toBeTruthy()
  click('.collapse-btn')
  expect(document.activeElement).not.toBe(editor)
  tabs[2]!.click(); flushSync()
  tabs[1]!.click(); flushSync()
  component.hide(); flushSync()
  component.show(); flushSync()
  await frame()
  expect(tabs[1]!.getAttribute('aria-selected')).toBe('true')
  expect(document.querySelector('.block-title')?.getAttribute('aria-expanded')).toBe('true')
  expect(document.querySelector('[aria-label="Prompt text"]')).toBe(editor)
  expect(editor.style.height).toBe('280px')
  expect(scroller.scrollTop).toBe(210)
})

it('remembers each character section and its scroll without mixing characters', async () => {
  component = mount(Harness, { target: document.body, props: { kind: 'character' } })
  component.show('a'); flushSync()
  const tabs = document.querySelectorAll<HTMLButtonElement>('[role=tab]')
  tabs[2]!.click(); flushSync()
  const scroller = document.querySelector<HTMLElement>('.modal-scroller')!
  await frame()
  scroll(scroller, 140)
  component.hide(); flushSync()
  component.show('b'); flushSync()
  await frame()
  expect(tabs[0]!.getAttribute('aria-selected')).toBe('true')
  expect(scroller.scrollTop).toBe(0)
  component.show('a'); flushSync()
  await frame()
  expect(tabs[2]!.getAttribute('aria-selected')).toBe('true')
  expect(scroller.scrollTop).toBe(140)
})
