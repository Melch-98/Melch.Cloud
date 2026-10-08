/**
 * Caps the public "email me a new link" route so it cannot spend the
 * Resend free quota (100 emails/day).
 *
 * Production has UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN, so the
 * live check is Upstash: 5 requests / 15 minutes per IP, and 40 / 24 hours
 * for the whole route.
 *
 * If those env vars are missing, or Upstash throws, this falls back to an
 * in-memory per-IP window plus a count of invite_sends (source = self-service)
 * over the last 24 hours. The fallback still refuses the send. It does not
 * allow the request through.
 */
import { Ratelimit } from '@upstash/ratelimit';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getRedis } from '@/lib/redis';

export const SET_PASSWORD_IP_LIMIT = 5;
export const SET_PASSWORD_IP_WINDOW_MS = 15 * 60 * 1000;
export const SET_PASSWORD_OVERALL_LIMIT = 40;
export const SET_PASSWORD_OVERALL_WINDOW_MS = 24 * 60 * 60 * 1000;

type StampStore = Map<string, number[]>;

const memoryHits: StampStore = new Map();

export function resetSetPasswordLimitMemory(): void {
  memoryHits.clear();
}

/** Returns true when this hit is still inside the window. */
export function memoryWindowAllows(
  key: string,
  limit: number,
  windowMs: number,
  now: number,
  store: StampStore = memoryHits
): boolean {
  const recent = (store.get(key) || []).filter((stamp) => now - stamp < windowMs);
  if (recent.length >= limit) {
    store.set(key, recent);
    return false;
  }
  recent.push(now);
  store.set(key, recent);
  return true;
}

export function clientIp(headers: { get(name: string): string | null }): string {
  const forwarded = headers.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  if (first) return first;
  const real = headers.get('x-real-ip')?.trim();
  return real || 'unknown';
}

let ipLimiter: Ratelimit | null = null;
let overallLimiter: Ratelimit | null = null;

function upstashLimiters(): { ip: Ratelimit; overall: Ratelimit } | null {
  const redis = getRedis();
  if (!redis) return null;
  if (!ipLimiter) {
    ipLimiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(SET_PASSWORD_IP_LIMIT, '15 m'),
      analytics: false,
      prefix: 'rl:set-password:ip',
    });
  }
  if (!overallLimiter) {
    overallLimiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(SET_PASSWORD_OVERALL_LIMIT, '24 h'),
      analytics: false,
      prefix: 'rl:set-password:all',
    });
  }
  return { ip: ipLimiter, overall: overallLimiter };
}

export async function countRecentSelfServiceSends(
  supabase: SupabaseClient,
  now = Date.now()
): Promise<number> {
  const since = new Date(now - SET_PASSWORD_OVERALL_WINDOW_MS).toISOString();
  const { count, error } = await supabase
    .from('invite_sends')
    .select('id', { count: 'exact', head: true })
    .eq('source', 'self-service')
    .gte('created_at', since);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export type LimitSource = 'upstash' | 'fallback';

/**
 * allowed false means do not send.
 * source tells which cap made the decision.
 */
export async function allowSetPasswordIp(input: {
  ip: string;
  now?: number;
  upstash?: { limitIp: (ip: string) => Promise<boolean> } | null;
}): Promise<{ allowed: boolean; source: LimitSource }> {
  const now = input.now ?? Date.now();
  const ip = input.ip.trim() || 'unknown';
  const upstash = input.upstash === undefined ? wrapUpstash() : input.upstash;

  if (upstash) {
    try {
      return { allowed: await upstash.limitIp(ip), source: 'upstash' };
    } catch (err) {
      console.error('[set-password] Upstash IP limit failed; using the local cap', err);
    }
  }

  return {
    allowed: memoryWindowAllows(`ip:${ip}`, SET_PASSWORD_IP_LIMIT, SET_PASSWORD_IP_WINDOW_MS, now),
    source: 'fallback',
  };
}

export async function allowSetPasswordOverall(input: {
  now?: number;
  recentSelfServiceCount: () => Promise<number>;
  upstash?: { limitOverall: () => Promise<boolean> } | null;
}): Promise<{ allowed: boolean; source: LimitSource }> {
  const now = input.now ?? Date.now();
  const upstash = input.upstash === undefined ? wrapUpstash() : input.upstash;

  if (upstash) {
    try {
      return { allowed: await upstash.limitOverall(), source: 'upstash' };
    } catch (err) {
      console.error('[set-password] Upstash overall limit failed; using the local cap', err);
    }
  }

  let dbOk = true;
  try {
    dbOk = (await input.recentSelfServiceCount()) < SET_PASSWORD_OVERALL_LIMIT;
  } catch (err) {
    console.error('[set-password] could not count invite sends; using the memory cap', err);
  }
  if (!dbOk) return { allowed: false, source: 'fallback' };

  return {
    allowed: memoryWindowAllows('overall', SET_PASSWORD_OVERALL_LIMIT, SET_PASSWORD_OVERALL_WINDOW_MS, now),
    source: 'fallback',
  };
}

function wrapUpstash(): { limitIp: (ip: string) => Promise<boolean>; limitOverall: () => Promise<boolean> } | null {
  const limiters = upstashLimiters();
  if (!limiters) return null;
  return {
    limitIp: async (ip) => (await limiters.ip.limit(ip)).success,
    limitOverall: async () => (await limiters.overall.limit('all')).success,
  };
}
