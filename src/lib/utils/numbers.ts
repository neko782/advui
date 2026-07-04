// Number parsing and validation utilities

export interface ToIntOrNullOptions {
  /**
   * How to treat values below the minimum of 1:
   * - 'clamp' (default): clamp up to 1
   * - 'unset': return null, treating the value as not set (e.g. 0 = unset
   *   for maxOutputTokens/thinkingBudgetTokens)
   */
  belowMin?: 'clamp' | 'unset';
}

export function toIntOrNull(val: unknown, options: ToIntOrNullOptions = {}): number | null {
  if (val === '' || val == null) return null;
  const num = Number(val);
  if (!Number.isFinite(num)) return null;
  const floored = Math.floor(num);
  if (floored < 1) {
    return options.belowMin === 'unset' ? null : 1;
  }
  return floored;
}

export function toClampedNumber(val: unknown, min: number, max: number): number | null {
  if (val === '' || val == null) return null;
  const num = Number(val);
  if (!Number.isFinite(num)) return null;
  return Math.min(max, Math.max(min, num));
}

