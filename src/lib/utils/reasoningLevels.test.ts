import { expect, it } from 'vitest'
import { isReasoningLevelSupported, reasoningLevelOptions } from './reasoningLevels'

const values = (...args: Parameters<typeof reasoningLevelOptions>) => reasoningLevelOptions(...args).map(option => option.value)

it('offers each API its own current levels', () => {
  expect(values('responses')).toEqual(['default', 'none', 'low', 'medium', 'high', 'xhigh', 'max'])
  expect(values('chat_completions')).toEqual(['default', 'none', 'low', 'medium', 'high', 'xhigh', 'max'])
  expect(values('gemini')).toEqual(['default', 'minimal', 'low', 'medium', 'high'])
})

it('brings deprecated levels back only with the legacy option', () => {
  expect(values('responses', { legacy: true })).toEqual(['default', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
  expect(values('gemini', { legacy: true })).toEqual(['default', 'minimal', 'low', 'medium', 'high'])
})

it('keeps an already-selected level visible and marked', () => {
  expect(reasoningLevelOptions('responses', { selected: 'minimal' })).toContainEqual({ value: 'minimal', label: 'minimal (deprecated)' })
  expect(reasoningLevelOptions('gemini', { selected: 'xhigh' })).toContainEqual({ value: 'xhigh', label: 'xhigh (not supported here)' })
})

it('knows which levels an API accepts', () => {
  expect(isReasoningLevelSupported('gemini', 'max')).toBe(false)
  expect(isReasoningLevelSupported('gemini', 'low')).toBe(true)
  expect(isReasoningLevelSupported('responses', 'minimal')).toBe(true)
  expect(isReasoningLevelSupported('responses', 'default')).toBe(false)
})
