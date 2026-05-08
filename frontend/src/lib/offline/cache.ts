/**
 * Offline data cache — localStorage-based.
 *
 * Caches reference data (products, forms, questions, options) on first successful
 * API load so that visit step pages can render even without network.
 *
 * Strategy:
 *   - Write-through: every successful API response updates the cache
 *   - Read-fallback: only read from cache when the API call fails
 *   - TTL: cached data expires after 24h (products/forms don't change often)
 *
 * We use localStorage (not IndexedDB) because the data is small JSON (<1MB)
 * and synchronous reads simplify component code.
 */

const PREFIX = "espert.cache.";
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CacheEntry<T> {
  data: T;
  ts: number;
}

function write<T>(key: string, data: T): void {
  try {
    const entry: CacheEntry<T> = { data, ts: Date.now() };
    localStorage.setItem(PREFIX + key, JSON.stringify(entry));
  } catch {
    // localStorage full — evict oldest cache entries
    try {
      const cacheKeys = Object.keys(localStorage)
        .filter((k) => k.startsWith(PREFIX))
        .sort((a, b) => {
          try {
            const ea = JSON.parse(localStorage.getItem(a)!) as CacheEntry<unknown>;
            const eb = JSON.parse(localStorage.getItem(b)!) as CacheEntry<unknown>;
            return ea.ts - eb.ts;
          } catch { return 0; }
        });
      // Remove oldest 3
      for (let i = 0; i < Math.min(3, cacheKeys.length); i++) {
        localStorage.removeItem(cacheKeys[i]);
      }
      // Retry
      localStorage.setItem(PREFIX + key, JSON.stringify({ data, ts: Date.now() }));
    } catch { /* give up */ }
  }
}

function read<T>(key: string, ttlMs: number = DEFAULT_TTL_MS): T | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry<T>;
    if (Date.now() - entry.ts > ttlMs) {
      localStorage.removeItem(PREFIX + key);
      return null;
    }
    return entry.data;
  } catch {
    return null;
  }
}

// ── Public API ──

/** Fetch with cache: tries the fetcher first, caches on success. On failure, returns cached data. */
export async function fetchWithCache<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<T> {
  try {
    const data = await fetcher();
    write(key, data);
    return data;
  } catch (err) {
    const cached = read<T>(key, ttlMs);
    if (cached !== null) {
      console.info(`[cache] Using cached ${key} (API failed)`);
      return cached;
    }
    throw err; // No cache available, propagate error
  }
}

/** Read from cache only (no fetch). Useful for synchronous checks. */
export function readCache<T>(key: string, ttlMs?: number): T | null {
  return read<T>(key, ttlMs);
}

/** Write to cache explicitly (outside of fetchWithCache). */
export function writeCache<T>(key: string, data: T): void {
  write(key, data);
}

/** Clear all cache entries. */
export function clearAllCache(): void {
  Object.keys(localStorage)
    .filter((k) => k.startsWith(PREFIX))
    .forEach((k) => localStorage.removeItem(k));
}
