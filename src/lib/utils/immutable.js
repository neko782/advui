import { klona } from 'klona'

export function deepClone(value) {
  try {
    return klona(value)
  } catch (err) {
    console.warn('deepClone failed via klona, falling back to JSON clone:', err)
  }

  try {
    return JSON.parse(JSON.stringify(value))
  } catch (jsonErr) {
    console.error('deepClone JSON fallback failed:', jsonErr)
    return value
  }
}
