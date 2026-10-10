import { afterEach, describe, expect, it } from 'vitest';
import {
  DROPBOX_OAUTH_STATE_TTL_MS,
  signDropboxOAuthState,
  verifyDropboxOAuthState,
} from '@/lib/dropbox-oauth-state';

describe('dropbox oauth state', () => {
  afterEach(() => {
    delete process.env.DROPBOX_APP_SECRET;
  });

  it('signs a state that verifies for the same admin', () => {
    process.env.DROPBOX_APP_SECRET = 'dropbox-secret';
    const now = 1_700_000_000_000;
    const state = signDropboxOAuthState('admin-1', now);
    expect(state).toBeTruthy();
    expect(verifyDropboxOAuthState(state, now + 1000)).toEqual({ ok: true, userId: 'admin-1' });
  });

  it('rejects a missing secret, a tampered body, a bad signature, and an expired state', () => {
    expect(signDropboxOAuthState('admin-1')).toBeNull();
    expect(verifyDropboxOAuthState('anything')).toEqual({ ok: false, reason: 'unsigned' });

    process.env.DROPBOX_APP_SECRET = 'dropbox-secret';
    const now = 1_700_000_000_000;
    const state = signDropboxOAuthState('admin-1', now)!;
    const [body, signature] = state.split('.');
    const flipped = `${body.slice(0, -1)}${body.endsWith('a') ? 'b' : 'a'}.${signature}`;
    expect(verifyDropboxOAuthState(flipped, now).ok).toBe(false);

    expect(verifyDropboxOAuthState(`${body}.not-the-signature`, now)).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
    expect(verifyDropboxOAuthState(null, now)).toEqual({ ok: false, reason: 'missing' });
    expect(verifyDropboxOAuthState(state, now + DROPBOX_OAUTH_STATE_TTL_MS)).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it('rejects a state signed with a different secret', () => {
    process.env.DROPBOX_APP_SECRET = 'one';
    const state = signDropboxOAuthState('admin-1')!;
    process.env.DROPBOX_APP_SECRET = 'two';
    expect(verifyDropboxOAuthState(state)).toEqual({ ok: false, reason: 'bad_signature' });
  });
});
