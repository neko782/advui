import { describe, it, expect } from 'vitest'
import { genPresetId, genConnectionId } from './idGenerator.js'

describe('genPresetId', () => {
  it('should generate unique IDs with correct format', () => {
    const ids = new Set([genPresetId(), genPresetId(), genPresetId()])
    expect(ids.size).toBe(3)
    ids.forEach(id => expect(id).toMatch(/^preset_[a-z0-9]+_[a-z0-9]{6}$/))
  })
})

describe('genConnectionId', () => {
  it('should generate unique IDs with correct format', () => {
    const ids = new Set([genConnectionId(), genConnectionId(), genConnectionId()])
    expect(ids.size).toBe(3)
    ids.forEach(id => expect(id).toMatch(/^connection_[a-z0-9]+_[a-z0-9]{6}$/))
  })
})