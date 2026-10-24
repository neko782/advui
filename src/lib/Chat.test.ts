import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'
import Chat from './Chat.svelte'
import { settingsStore } from './stores/appState.svelte'
import { loadSettings } from './settingsStore'
import * as modelsStore from './modelsStore'
import { makeDefaultPreset } from './utils/presetHelpers'
import { normalizeCardJson } from './tavern/characterCard'
import { createCharacterChat } from './tavern/tavernChat'

let component: ReturnType<typeof mount> | undefined

afterEach(async () => {
  if (component) await unmount(component)
  component = undefined
  document.body.innerHTML = ''
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('Tavern model editing', () => {
  it('keeps the settings and model selection stable while saving each edit', async () => {
    const settings = settingsStore.save({
      ...loadSettings(),
      connections: [{ id: 'test', name: 'Test', apiKey: '', apiBaseUrl: 'https://example.invalid/v1', apiMode: 'chat_completions' }],
      selectedConnectionId: 'test',
      presets: [{ ...makeDefaultPreset('test'), id: 'tavern', name: 'Tavern', model: 'original-model' }],
      tavernSelectedPresetId: 'tavern',
      tavernPerChatPresets: false,
    })
    modelsStore.setModelsCache('test', ['original-model', 'new-model'])
    const character = normalizeCardJson({ name: 'Test', first_mes: 'Hello' })
    const { id } = await createCharacterChat(character, settings)
    component = mount(Chat, { target: document.body, props: { chatId: id, tavernCharacter: character } })
    await vi.waitFor(() => {
      flushSync()
      expect(document.querySelector<HTMLInputElement>('input[aria-label="Model"]')?.value).toBe('original-model')
      expect(document.querySelector('.bubble')).toBeTruthy()
    })
    ;(document.querySelector('[aria-label="Chat settings"]') as HTMLButtonElement).click()
    flushSync()
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Model"]')!
    const loadModelsCache = vi.spyOn(modelsStore, 'loadModelsCache')
    input.focus()
    for (const [value, caret] of [['', 0], ['n', 1], ['ne', 2], ['new-model ', 4], ['new-model', 3]] as const) {
      input.value = value
      input.setSelectionRange(caret, caret)
      input.dispatchEvent(new Event('input', { bubbles: true }))
      flushSync()
      expect(document.querySelector('.chat-settings-group')?.classList.contains('open')).toBe(true)
      expect(input.disabled).toBe(false)
      expect(document.activeElement).toBe(input)
      expect(input.value).toBe(value)
      expect(input.selectionStart).toBe(caret)
    }
    expect(loadModelsCache).not.toHaveBeenCalled()
    expect(settingsStore.current.presets.find(p => p.id === 'tavern')?.model).toBe('new-model')
    expect(loadSettings().presets.find(p => p.id === 'tavern')?.model).toBe('new-model')

    input.blur()
    flushSync()
    settingsStore.save({
      ...settingsStore.current,
      presets: settingsStore.current.presets.map(p => ({ ...p, model: 'another-model' })),
    })
    flushSync()
    expect(input.value).toBe('another-model')
  })
})
