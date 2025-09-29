import { describe, it, expect } from 'vitest'
import { toIntOrNull, toClampedNumber } from './numbers.js'

describe('toIntOrNull', () => {
  it('should return null for invalid inputs', () => {
    expect(toIntOrNull('')).toBe(null)
    expect(toIntOrNull(null)).toBe(null)
    expect(toIntOrNull(undefined)).toBe(null)
    expect(toIntOrNull(NaN)).toBe(null)
    expect(toIntOrNull(Infinity)).toBe(null)
    expect(toIntOrNull('abc')).toBe(null)
  })

  it('should parse and floor numbers', () => {
    expect(toIntOrNull(5)).toBe(5)
    expect(toIntOrNull('42')).toBe(42)
    expect(toIntOrNull(5.9)).toBe(5)
  })

  it('should enforce minimum of 1', () => {
    expect(toIntOrNull(0)).toBe(1)
    expect(toIntOrNull(-5)).toBe(1)
  })
})

describe('toClampedNumber', () => {
  it('should return null for invalid inputs', () => {
    expect(toClampedNumber('', 0, 1)).toBe(null)
    expect(toClampedNumber(null, 0, 1)).toBe(null)
    expect(toClampedNumber(NaN, 0, 1)).toBe(null)
    expect(toClampedNumber('abc', 0, 1)).toBe(null)
  })

  it('should clamp to range', () => {
    expect(toClampedNumber(-5, 0, 1)).toBe(0)
    expect(toClampedNumber(5, 0, 1)).toBe(1)
    expect(toClampedNumber(0.5, 0, 1)).toBe(0.5)
  })

  it('should handle boundaries and decimals', () => {
    expect(toClampedNumber(0, 0, 1)).toBe(0)
    expect(toClampedNumber(1, 0, 1)).toBe(1)
    expect(toClampedNumber(0.7654, 0, 1)).toBe(0.7654)
  })
})