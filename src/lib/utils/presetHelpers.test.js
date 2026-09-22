import { describe, expect, it } from 'vitest'
import { normalizePreset, buildChatSettings, loadChatSettings } from './presetHelpers.js'
import { presetSignature } from '../chat/services/chatInit.js'

describe('OpenRouter provider presets', () => {
  it('normalizes and preserves the provider through preset serialization', () => {
    const preset = normalizePreset({ id: 'preset', openRouterProvider: ' anthropic ' })
    expect(preset.openRouterProvider).toBe('anthropic')
    expect(normalizePreset(JSON.parse(JSON.stringify(preset))).openRouterProvider).toBe('anthropic')
    expect(normalizePreset({ openRouterProvider: 123 }).openRouterProvider).toBe('')
  })

  it('inherits the provider in new and legacy chats', () => {
    const preset = normalizePreset({ openRouterProvider: 'anthropic' })
    expect(buildChatSettings(preset, null).openRouterProvider).toBe('anthropic')
    expect(loadChatSettings({ settings: {} }, preset, null).openRouterProvider).toBe('anthropic')
  })

  it.each(['openai', ''])('preserves an explicit chat override of %s', (provider) => {
    const preset = normalizePreset({ openRouterProvider: 'anthropic' })
    expect(loadChatSettings({ settings: { openRouterProvider: provider } }, preset, null).openRouterProvider).toBe(provider)
  })

  it('treats presets without a provider as automatic routing', () => {
    expect(buildChatSettings(normalizePreset({}), null).openRouterProvider).toBe('')
  })

  it('detects provider-only changes to presets', () => {
    const preset = normalizePreset({ id: 'preset', openRouterProvider: 'anthropic' })
    expect(presetSignature({ presets: [preset] })).not.toBe(
      presetSignature({ presets: [{ ...preset, openRouterProvider: 'openai' }] }))
  })
})
