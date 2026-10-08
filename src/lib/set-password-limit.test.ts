import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SET_PASSWORD_IP_LIMIT,
  SET_PASSWORD_OVERALL_LIMIT,
  allowSetPasswordIp,
  allowSetPasswordOverall,
  memoryWindowAllows,
  resetSetPasswordLimitMemory,
} from './set-password-limit';

describe('set-password request cap', () => {
  beforeEach(() => {
    resetSetPasswordLimitMemory();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('stops one IP after 5 requests in the window', async () => {
    const now = Date.UTC(2026, 9, 8, 12, 0, 0);
    for (let i = 0; i < SET_PASSWORD_IP_LIMIT; i++) {
      const result = await allowSetPasswordIp({ ip: '203.0.113.4', now, upstash: null });
      expect(result.allowed).toBe(true);
      expect(result.source).toBe('fallback');
    }
    const blocked = await allowSetPasswordIp({ ip: '203.0.113.4', now, upstash: null });
    expect(blocked.allowed).toBe(false);
    const other = await allowSetPasswordIp({ ip: '203.0.113.5', now, upstash: null });
    expect(other.allowed).toBe(true);
  });

  it('stops the whole route once 40 self-service sends are already logged', async () => {
    const result = await allowSetPasswordOverall({
      upstash: null,
      recentSelfServiceCount: async () => SET_PASSWORD_OVERALL_LIMIT,
    });
    expect(result.allowed).toBe(false);
    expect(result.source).toBe('fallback');
  });

  it('uses Upstash when it is configured and honors a denial', async () => {
    const result = await allowSetPasswordIp({
      ip: '203.0.113.4',
      upstash: { limitIp: async () => false },
    });
    expect(result).toEqual({ allowed: false, source: 'upstash' });
  });

  it('does not fail open when Upstash throws', async () => {
    const now = Date.UTC(2026, 9, 8, 12, 0, 0);
    const upstash = {
      limitIp: async () => {
        throw new Error('redis down');
      },
    };
    for (let i = 0; i < SET_PASSWORD_IP_LIMIT; i++) {
      expect((await allowSetPasswordIp({ ip: '198.51.100.8', now, upstash })).allowed).toBe(true);
    }
    expect((await allowSetPasswordIp({ ip: '198.51.100.8', now, upstash })).allowed).toBe(false);
  });

  it('caps the day in memory when the send log cannot be read', async () => {
    const now = Date.UTC(2026, 9, 8, 12, 0, 0);
    for (let i = 0; i < SET_PASSWORD_OVERALL_LIMIT; i++) {
      const result = await allowSetPasswordOverall({
        now,
        upstash: null,
        recentSelfServiceCount: async () => {
          throw new Error('invite_sends missing');
        },
      });
      expect(result.allowed).toBe(true);
    }
    const blocked = await allowSetPasswordOverall({
      now,
      upstash: null,
      recentSelfServiceCount: async () => {
        throw new Error('invite_sends missing');
      },
    });
    expect(blocked.allowed).toBe(false);
  });

  it('shares one bucket for a missing IP', () => {
    const now = 1_000;
    for (let i = 0; i < 5; i++) {
      expect(memoryWindowAllows('ip:unknown', 5, 60_000, now)).toBe(true);
    }
    expect(memoryWindowAllows('ip:unknown', 5, 60_000, now)).toBe(false);
  });
});
