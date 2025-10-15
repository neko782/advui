export function deepClone(value) {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch (err) {
      console.warn('structuredClone failed, falling back to JSON clone:', err);
    }
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (err) {
    console.error('deepClone failed:', err);
    return value;
  }
}
