// Object type-guard helpers

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function hasOwn<T extends object>(obj: T | null | undefined, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(obj ?? {}, key);
}
