const DEFAULT_WARN_BYTES = 4 * 1024 * 1024; // 4MB

function getStorage() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
    if (typeof localStorage !== 'undefined') {
      return localStorage;
    }
  } catch (err) {
    console.error('Local storage unavailable:', err);
  }
  return null;
}

export function safeRead(key, defaultValue, validator = null) {
  const storage = getStorage();
  if (!storage) return defaultValue;
  try {
    const raw = storage.getItem(key);
    if (!raw) return defaultValue;
    const parsed = JSON.parse(raw);
    if (validator && typeof validator === 'function') {
      return validator(parsed);
    }
    return parsed;
  } catch (err) {
    console.error(`Storage read failed for key "${key}":`, err);
    return defaultValue;
  }
}

export function safeWrite(key, value, { warnThresholdBytes = DEFAULT_WARN_BYTES } = {}) {
  const storage = getStorage();
  if (!storage) return false;
  try {
    const serialized = JSON.stringify(value);
    if (warnThresholdBytes && serialized.length > warnThresholdBytes) {
      console.warn(
        `Large storage write (${(serialized.length / 1024).toFixed(0)}KB) for key "${key}"`
      );
    }
    storage.setItem(key, serialized);
    return true;
  } catch (err) {
    if (err && err.name === 'QuotaExceededError') {
      console.error('localStorage quota exceeded!', err);
    } else {
      console.error(`Storage write failed for key "${key}":`, err);
    }
    return false;
  }
}

export function safeRemove(key) {
  const storage = getStorage();
  if (!storage) return false;
  try {
    storage.removeItem(key);
    return true;
  } catch (err) {
    console.error(`Storage remove failed for key "${key}":`, err);
    return false;
  }
}
