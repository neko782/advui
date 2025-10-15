import { describe, it, expect } from 'vitest'
import {
  makeSystemPrologue,
  normalizePreset,
  pickPresetFromSettings,
  presetSignature,
  computeInitialConnectionId,
  buildChatSettings,
  recomputeNextIds,
  DEFAULT_SYSTEM_PROMPT
} from './chatInit.js'

describe('makeSystemPrologue', () => {
  it('should create system message with default id', () => {
    const msg = makeSystemPrologue()

    expect(msg.id).toBe(1)
    expect(msg.role).toBe('system')
    expect(msg.content).toBe(DEFAULT_SYSTEM_PROMPT)
    expect(msg.time).toBeGreaterThan(0)
  })

  it('should create system message with custom id', () => {
    const msg = makeSystemPrologue(42)

    expect(msg.id).toBe(42)
  })

  it('should include custom prompt when provided', () => {
    const prompt = 'Follow the company handbook.'
    const msg = makeSystemPrologue(7, prompt)

    expect(msg.content).toBe(prompt)
  })
})

describe('normalizePreset', () => {
  it('should normalize valid preset', () => {
    const preset = {
      id: 'preset1',
      model: 'gpt-5',
      streaming: true,
      maxOutputTokens: 1000,
      topP: 0.9,
      temperature: 0.7,
      reasoningEffort: 'medium',
      textVerbosity: 'medium',
      reasoningSummary: 'auto',
      systemPrompt: 'Act like a pirate.',
      connectionId: 'conn-1',
      thinkingEnabled: true,
      thinkingBudgetTokens: 2400,
    }

    const result = normalizePreset(preset)

    expect(result).toEqual(preset)
  })

  it('should use defaults for null input', () => {
    const result = normalizePreset(null)

    expect(result.id).toBeNull()
    expect(result.model).toBe('gpt-5')
    expect(result.streaming).toBe(true)
    expect(result.maxOutputTokens).toBeNull()
    expect(result.reasoningEffort).toBe('none')
    expect(result.textVerbosity).toBe('medium')
    expect(result.reasoningSummary).toBe('auto')
    expect(result.systemPrompt).toBe(DEFAULT_SYSTEM_PROMPT)
    expect(result.thinkingEnabled).toBe(false)
    expect(result.thinkingBudgetTokens).toBeNull()
  })

  it('should trim model string', () => {
    const preset = { model: '  gpt-5  ' }

    const result = normalizePreset(preset)

    expect(result.model).toBe('gpt-5')
  })

  it('should use default model for empty string', () => {
    const preset = { model: '   ' }

    const result = normalizePreset(preset)

    expect(result.model).toBe('gpt-5')
  })

  it('should normalize boolean streaming', () => {
    const preset1 = { streaming: true }
    const preset2 = { streaming: false }
    const preset3 = {}

    expect(normalizePreset(preset1).streaming).toBe(true)
    expect(normalizePreset(preset2).streaming).toBe(false)
    expect(normalizePreset(preset3).streaming).toBe(true)
  })

  it('should normalize id to null if not valid', () => {
    const preset1 = { id: '' }
    const preset2 = { id: '   ' }
    const preset3 = {}

    expect(normalizePreset(preset1).id).toBeNull()
    expect(normalizePreset(preset2).id).toBeNull()
    expect(normalizePreset(preset3).id).toBeNull()
  })
})

describe('pickPresetFromSettings', () => {
  it('should pick selected preset by id', () => {
    const state = {
      selectedPresetId: 'preset2',
      presets: [
        { id: 'preset1', model: 'gpt-4' },
        { id: 'preset2', model: 'gpt-5' },
        { id: 'preset3', model: 'gpt-3' }
      ]
    }

    const result = pickPresetFromSettings(state)

    expect(result.id).toBe('preset2')
    expect(result.model).toBe('gpt-5')
  })

  it('should pick first preset if no selection', () => {
    const state = {
      presets: [
        { id: 'preset1', model: 'gpt-4' },
        { id: 'preset2', model: 'gpt-5' }
      ]
    }

    const result = pickPresetFromSettings(state)

    expect(result.id).toBe('preset1')
    expect(result.model).toBe('gpt-4')
  })

  it('should return default if selected preset not found', () => {
    const state = {
      selectedPresetId: 'nonexistent',
      presets: [
        { id: 'preset1', model: 'gpt-4' }
      ]
    }

    const result = pickPresetFromSettings(state)

    expect(result.id).toBe('preset1')
  })

  it('should return default if no presets', () => {
    const state = { presets: [] }

    const result = pickPresetFromSettings(state)

    expect(result.id).toBeNull()
    expect(result.model).toBe('gpt-5')
  })

  it('should handle null state', () => {
    const result = pickPresetFromSettings(null)

    expect(result.id).toBeNull()
    expect(result.model).toBe('gpt-5')
  })
})

describe('presetSignature', () => {
  it('should create signature from presets list', () => {
    const state = {
      presets: [
        {
          id: 'preset1',
          name: 'Fast',
          model: 'gpt-5',
          streaming: true,
          maxOutputTokens: 1000,
          topP: 0.9,
          temperature: 0.7,
          reasoningEffort: 'low',
          textVerbosity: 'concise',
          reasoningSummary: 'auto',
          connectionId: 'conn1'
        },
        {
          id: 'preset2',
          name: 'Slow',
          model: 'gpt-4',
          streaming: false
        }
      ]
    }

    const sig = presetSignature(state)

    expect(typeof sig).toBe('string')
    expect(sig).toContain('preset1')
    expect(sig).toContain('preset2')
    expect(sig).toContain(';')
  })

  it('should return empty string for no presets', () => {
    const state = { presets: [] }

    const sig = presetSignature(state)

    expect(sig).toBe('')
  })

  it('should handle null state', () => {
    const sig = presetSignature(null)

    expect(sig).toBe('')
  })

  it('should represent streaming as 1 or 0', () => {
    const state = {
      presets: [
        { id: 'p1', streaming: true },
        { id: 'p2', streaming: false }
      ]
    }

    const sig = presetSignature(state)

    expect(sig).toMatch(/\|1\|/)
    expect(sig).toMatch(/\|0\|/)
  })
})

describe('computeInitialConnectionId', () => {
  it('should use preset connectionId if available', () => {
    const preset = { connectionId: 'preset-conn' }
    const settings = { selectedConnectionId: 'settings-conn' }

    const result = computeInitialConnectionId(preset, settings)

    expect(result).toBe('preset-conn')
  })

  it('should use settings connectionId if preset has none', () => {
    const preset = {}
    const settings = { selectedConnectionId: 'settings-conn' }

    const result = computeInitialConnectionId(preset, settings)

    expect(result).toBe('settings-conn')
  })

  it('should trim connection ids', () => {
    const preset = { connectionId: '  preset-conn  ' }
    const settings = {}

    const result = computeInitialConnectionId(preset, settings)

    expect(result).toBe('preset-conn')
  })

  it('should return null if no connection id available', () => {
    const preset = {}
    const settings = {}

    const result = computeInitialConnectionId(preset, settings)

    expect(result).toBeNull()
  })

  it('should ignore empty string connection ids', () => {
    const preset = { connectionId: '   ' }
    const settings = { selectedConnectionId: 'settings-conn' }

    const result = computeInitialConnectionId(preset, settings)

    expect(result).toBe('settings-conn')
  })
})

describe('buildChatSettings', () => {
  it('should build chat settings from preset and settings', () => {
    const preset = {
      id: 'preset1',
      model: 'gpt-5',
      streaming: true,
      maxOutputTokens: 2000,
      topP: 0.95,
      temperature: 0.8,
      reasoningEffort: 'high',
      textVerbosity: 'verbose',
      reasoningSummary: 'always',
      thinkingEnabled: true,
      thinkingBudgetTokens: 1800,
      connectionId: 'conn1'
    }
    const settings = { selectedConnectionId: 'fallback-conn' }

    const result = buildChatSettings(preset, settings)

    expect(result.model).toBe('gpt-5')
    expect(result.streaming).toBe(true)
    expect(result.presetId).toBe('preset1')
    expect(result.maxOutputTokens).toBe(2000)
    expect(result.topP).toBe(0.95)
    expect(result.temperature).toBe(0.8)
    expect(result.reasoningEffort).toBe('high')
    expect(result.textVerbosity).toBe('verbose')
    expect(result.reasoningSummary).toBe('always')
    expect(result.thinkingEnabled).toBe(true)
    expect(result.thinkingBudgetTokens).toBe(1800)
    expect(result.connectionId).toBe('conn1')
  })

  it('should fallback to settings connectionId if preset has none', () => {
    const preset = {
      model: 'gpt-5',
      streaming: true
    }
    const settings = { selectedConnectionId: 'settings-conn' }

    const result = buildChatSettings(preset, settings)

    expect(result.connectionId).toBe('settings-conn')
    expect(result.thinkingEnabled).toBe(false)
    expect(result.thinkingBudgetTokens).toBeNull()
  })
})

describe('recomputeNextIds', () => {
  it('should compute next ids from existing nodes', () => {
    const nodes = [
      { id: 1, variants: [{ id: 1 }, { id: 2 }] },
      { id: 3, variants: [{ id: 5 }, { id: 8 }] },
      { id: 2, variants: [{ id: 3 }] }
    ]

    const result = recomputeNextIds(nodes)

    expect(result.nextId).toBe(9)
    expect(result.nextNodeId).toBe(4)
  })

  it('should handle empty nodes array', () => {
    const result = recomputeNextIds([])

    expect(result.nextId).toBe(1)
    expect(result.nextNodeId).toBe(1)
  })

  it('should handle null nodes', () => {
    const result = recomputeNextIds(null)

    expect(result.nextId).toBe(1)
    expect(result.nextNodeId).toBe(1)
  })

  it('should handle nodes with no variants', () => {
    const nodes = [
      { id: 5, variants: [] },
      { id: 10 }
    ]

    const result = recomputeNextIds(nodes)

    expect(result.nextId).toBe(1)
    expect(result.nextNodeId).toBe(11)
  })

  it('should handle malformed data gracefully', () => {
    const nodes = [
      { id: 'not-a-number', variants: [{ id: 'also-not-a-number' }] }
    ]

    const result = recomputeNextIds(nodes)

    expect(result.nextId).toBe(1)
    expect(result.nextNodeId).toBe(1)
  })

  it('should find max IDs correctly', () => {
    const nodes = [
      { id: 5, variants: [{ id: 100 }] },
      { id: 50, variants: [{ id: 25 }] },
      { id: 3, variants: [{ id: 200 }] }
    ]

    const result = recomputeNextIds(nodes)

    expect(result.nextId).toBe(201)
    expect(result.nextNodeId).toBe(51)
  })
})
