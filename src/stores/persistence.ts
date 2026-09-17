// Shared localStorage JSON persistence for signal stores.
// Keys must come from @/config/storage; never inline a key string.

/**
 * Reads a JSON object from localStorage, shallow-merging it over `fallback`.
 * Returns a fresh copy of `fallback` when the key is missing or corrupt.
 */
export function loadJSON<T extends object>(key: string, fallback: T): T {
  try {
    const saved = localStorage.getItem(key);
    if (saved) {
      return { ...fallback, ...JSON.parse(saved) };
    }
  } catch {
    // Corrupt value: fall through to defaults
  }
  return { ...fallback };
}

export function saveJSON(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}
