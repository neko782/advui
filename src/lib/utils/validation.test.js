import { describe, it, expect } from 'vitest'
import {
  normalizeReasoning,
  normalizeVerbosity,
  normalizeReasoningSummary,
  parseMaxTokens,
  parseTopP,
  parseTemperature
} from './validation.js'

describe('normalizeReasoning', () => {
  it('should validate reasoning options', () => {
    expect(normalizeReasoning('high')).toBe('high')
    expect(normalizeReasoning('invalid')).toBe('none')
  })
})

describe('normalizeVerbosity', () => {
  it('should validate verbosity options', () => {
    expect(normalizeVerbosity('low')).toBe('low')
    expect(normalizeVerbosity('invalid')).toBe('medium')
  })
})

describe('normalizeReasoningSummary', () => {
  it('should validate reasoning summary options', () => {
    expect(normalizeReasoningSummary('concise')).toBe('concise')
    expect(normalizeReasoningSummary('invalid')).toBe('auto')
  })
})

describe('parseMaxTokens', () => {
  it('should parse max tokens using toIntOrNull', () => {
    expect(parseMaxTokens(100)).toBe(100)
    expect(parseMaxTokens('abc')).toBe(null)
    expect(parseMaxTokens(0)).toBe(1) // enforces min of 1
  })
})

describe('parseTopP', () => {
  it('should clamp top_p to 0-1 range', () => {
    expect(parseTopP(0.5)).toBe(0.5)
    expect(parseTopP(-1)).toBe(0)
    expect(parseTopP(2)).toBe(1)
  })
})

describe('parseTemperature', () => {
  it('should clamp temperature to 0-2 range', () => {
    expect(parseTemperature(1)).toBe(1)
    expect(parseTemperature(-1)).toBe(0)
    expect(parseTemperature(3)).toBe(2)
  })
})