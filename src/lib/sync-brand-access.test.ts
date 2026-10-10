import { describe, expect, it } from 'vitest';
import { authorizationMatchesSecret, mayTriggerBrandSync } from '@/lib/sync-brand-access';

describe('sync brand access', () => {
  it('matches a bearer secret and rejects a missing or different one', () => {
    expect(authorizationMatchesSecret('Bearer cron-secret', 'cron-secret')).toBe(true);
    expect(authorizationMatchesSecret('Bearer cron-secret', undefined)).toBe(false);
    expect(authorizationMatchesSecret('Bearer cron-secret', '')).toBe(false);
    expect(authorizationMatchesSecret('Bearer other', 'cron-secret')).toBe(false);
    expect(authorizationMatchesSecret('Bearer cron-secret-extra', 'cron-secret')).toBe(false);
    expect(authorizationMatchesSecret(null, 'cron-secret')).toBe(false);
  });

  it('lets cron and admins sync any brand, and a founder only their own', () => {
    expect(
      mayTriggerBrandSync({ via: 'cron', role: null, ownBrandId: null, targetBrandId: 'brand-2' })
    ).toBe(true);
    expect(
      mayTriggerBrandSync({ via: 'session', role: 'admin', ownBrandId: null, targetBrandId: 'brand-2' })
    ).toBe(true);
    expect(
      mayTriggerBrandSync({ via: 'session', role: 'admin', ownBrandId: null, targetBrandId: null })
    ).toBe(true);
    expect(
      mayTriggerBrandSync({
        via: 'session',
        role: 'founder',
        ownBrandId: 'brand-1',
        targetBrandId: 'brand-1',
      })
    ).toBe(true);
    expect(
      mayTriggerBrandSync({
        via: 'session',
        role: 'founder',
        ownBrandId: 'brand-1',
        targetBrandId: 'brand-2',
      })
    ).toBe(false);
    expect(
      mayTriggerBrandSync({ via: 'session', role: 'founder', ownBrandId: null, targetBrandId: 'brand-1' })
    ).toBe(false);
    expect(
      mayTriggerBrandSync({
        via: 'session',
        role: 'strategist',
        ownBrandId: 'brand-1',
        targetBrandId: 'brand-1',
      })
    ).toBe(false);
  });
});
