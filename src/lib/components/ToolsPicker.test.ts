import { afterEach, expect, it, vi } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'
import ToolsPicker, { type ToolsValue } from './ToolsPicker.svelte'

let component: object | undefined
afterEach(async () => {
  if (component) await unmount(component)
  component = undefined
  document.body.innerHTML = ''
})

function render(value: ToolsValue, extra: { configurable?: boolean } = {}) {
  const onChange = vi.fn()
  component = mount(ToolsPicker, { target: document.body, props: { value, onChange, ...extra } })
  flushSync()
  return onChange
}
const button = (label: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
function click(node: HTMLElement | null) { node!.click(); flushSync() }

it('toggles a tool from its chip', () => {
  const onChange = render({ webSearchEnabled: true })
  expect(button('Web search')!.getAttribute('aria-pressed')).toBe('true')
  expect(button('Shell')!.getAttribute('aria-pressed')).toBe('false')
  click(button('Shell'))
  expect(onChange).toHaveBeenCalledWith({ shellEnabled: true })
  click(button('Web search'))
  expect(onChange).toHaveBeenLastCalledWith({ webSearchEnabled: false })
})

it('offers options only for enabled tools that have them', () => {
  render({ webSearchEnabled: true, shellEnabled: true })
  expect(button('Web search options')).toBeNull()
  expect(button('Code interpreter options')).toBeNull()
  expect(button('Shell options')).toBeTruthy()
})

it('sets network access as one choice instead of a switch plus a field', () => {
  const onChange = render({ shellEnabled: true, shellNetworkEnabled: true, shellAllowedDomains: 'pypi.org' })
  click(button('Shell options'))
  const modes = [...document.querySelectorAll<HTMLButtonElement>('[role=radio]')]
  expect(modes.map(mode => mode.textContent)).toEqual(['Off', 'Any domain', 'Allowlist'])
  expect(modes[2]!.getAttribute('aria-checked')).toBe('true')
  expect(document.querySelector<HTMLInputElement>('[aria-label="Shell allowed domains"]')!.value).toBe('pypi.org')
  click(modes[1]!)
  expect(onChange).toHaveBeenLastCalledWith({ shellNetworkEnabled: true, shellAllowedDomains: undefined })
  click(modes[0]!)
  expect(onChange).toHaveBeenLastCalledWith({ shellNetworkEnabled: false })
})

it('is plain on/off when not configurable', () => {
  render({ shellEnabled: true, mcpEnabled: true, imageGenerationEnabled: true }, { configurable: false })
  expect(document.querySelector('[aria-expanded]')).toBeNull()
})
