// ─── Simple In-Memory Cache with TTL ────────────────────────────
// Lightweight caching layer for Meta API responses.
// Runs per-serverless-instance (not shared across instances),
// but still dramatically reduces Meta API calls for repeated page loads.

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

const store = new Map<string, CacheEntry<any>>();

const DEFAULT_TTL = 15 * 60 * 1000; // 15 minutes

export function cacheGet<T>(key: string): T | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > entry.ttl) {
    store.delete(key);
    return null;
  }
  return entry.data as T;
}

export function cacheSet<T>(key: string, data: T, ttl = DEFAULT_TTL): void {
  // Limit cache size to prevent memory leaks in serverless
  if (store.size > 200) {
    // Evict oldest entries
    const entries = Array.from(store.entries()).sort((a, b) => a[1].timestamp - b[1].timestamp);
    for (let i = 0; i < 50; i++) {
      store.delete(entries[i][0]);
    }
  }
  store.set(key, { data, timestamp: Date.now(), ttl });
}

export function cacheKey(...parts: string[]): string {
  return parts.join(':');
}

export function getCacheTimestamp(key: string): number | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > entry.ttl) return null;
  return entry.timestamp;
}
