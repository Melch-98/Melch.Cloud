import { Redis } from '@upstash/redis';
import { Ratelimit } from '@upstash/ratelimit';

// Singleton Redis client — reads UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN from env.
// Returns null if env vars are missing so the app degrades gracefully in local dev.
let _redis: Redis | null = null;
export function getRedis(): Redis | null {
  if (_redis) return _redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  _redis = new Redis({ url, token });
  return _redis;
}

// Rate limiter for Shopify sync — 5 requests per minute per brand.
let _syncLimiter: Ratelimit | null = null;
export function getSyncRateLimiter(): Ratelimit | null {
  if (_syncLimiter) return _syncLimiter;
  const redis = getRedis();
  if (!redis) return null;
  _syncLimiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(5, '60 s'),
    analytics: true,
    prefix: 'rl:shopify-sync',
  });
  return _syncLimiter;
}

// Try to acquire a per-brand sync lock so two syncs can't run concurrently.
// Returns true if the lock was acquired, false if another sync is in progress.
export async function acquireSyncLock(brandId: string, ttlSeconds = 120): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return true; // No redis → no locking
  const key = `lock:shopify-sync:${brandId}`;
  const result = await redis.set(key, Date.now(), { nx: true, ex: ttlSeconds });
  return result === 'OK';
}

export async function releaseSyncLock(brandId: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  await redis.del(`lock:shopify-sync:${brandId}`);
}

// Cache helpers for daily P&L data.
export async function getCachedPnl(brandId: string, year: string): Promise<unknown | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    return await redis.get(`pnl:${brandId}:${year}`);
  } catch {
    return null;
  }
}

export async function setCachedPnl(brandId: string, year: string, data: unknown, ttlSeconds = 60): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.set(`pnl:${brandId}:${year}`, data, { ex: ttlSeconds });
  } catch {
    // Cache failures should never break the request
  }
}

export async function invalidatePnlCache(brandId: string, year?: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    if (year) {
      await redis.del(`pnl:${brandId}:${year}`);
    } else {
      // Invalidate all years for this brand
      const currentYear = new Date().getFullYear();
      await Promise.all([
        redis.del(`pnl:${brandId}:${currentYear}`),
        redis.del(`pnl:${brandId}:${currentYear - 1}`),
      ]);
    }
  } catch {
    // ignore
  }
}
