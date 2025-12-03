// Number parsing and validation utilities

export function toIntOrNull(val: unknown): number | null {
  if (val === '' || val == null) return null;
  const num = Number(val);
  if (!Number.isFinite(num)) return null;
  const rounded = Math.max(1, Math.floor(num));
  return Number.isFinite(rounded) ? rounded : null;
}

export function toClampedNumber(val: unknown, min: number, max: number): number | null {
  if (val === '' || val == null) return null;
  const num = Number(val);
  if (!Number.isFinite(num)) return null;
  return Math.min(max, Math.max(min, num));
}

