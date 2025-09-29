// Settings validation utilities
import { REASONING_OPTIONS, TEXT_VERBOSITY_OPTIONS, REASONING_SUMMARY_OPTIONS } from '../constants/index.js'
import { toIntOrNull, toClampedNumber } from './numbers.js'

export function normalizeReasoning(val) {
  return REASONING_OPTIONS.includes(val) ? val : 'none'
}

export function normalizeVerbosity(val) {
  return TEXT_VERBOSITY_OPTIONS.includes(val) ? val : 'medium'
}

export function normalizeReasoningSummary(val) {
  return REASONING_SUMMARY_OPTIONS.includes(val) ? val : 'auto'
}

export function parseMaxTokens(value) {
  return toIntOrNull(value)
}

export function parseTopP(value) {
  return toClampedNumber(value, 0, 1)
}

export function parseTemperature(value) {
  return toClampedNumber(value, 0, 2)
}