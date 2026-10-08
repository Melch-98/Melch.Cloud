import { describe, expect, it } from 'vitest';
import { parseSetPasswordLocation } from './set-password-token';

describe('parseSetPasswordLocation', () => {
  it('reads a token hash and invite type from the query string', () => {
    expect(parseSetPasswordLocation('?token_hash=abc123&type=invite', '')).toEqual({
      status: 'otp',
      tokenHash: 'abc123',
      otpType: 'invite',
    });
  });

  it('reads a recovery hash from the fragment', () => {
    expect(parseSetPasswordLocation('', '#token_hash=rec&type=recovery')).toEqual({
      status: 'otp',
      tokenHash: 'rec',
      otpType: 'recovery',
    });
  });

  it('rejects a hash that has no type', () => {
    expect(parseSetPasswordLocation('?token_hash=abc', '')).toEqual({
      status: 'error',
      message: 'This link is not valid. It is missing a token type.',
    });
  });

  it('reads a PKCE code', () => {
    expect(parseSetPasswordLocation('?code=pkce-code', '')).toEqual({
      status: 'code',
      code: 'pkce-code',
    });
  });

  it('reads an implicit session from the hash', () => {
    expect(
      parseSetPasswordLocation('', '#access_token=aaa&refresh_token=bbb&type=invite')
    ).toEqual({
      status: 'implicit',
      accessToken: 'aaa',
      refreshToken: 'bbb',
    });
  });

  it('explains an expired link', () => {
    const parsed = parseSetPasswordLocation(
      '?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
      ''
    );
    expect(parsed.status).toBe('error');
    if (parsed.status === 'error') {
      expect(parsed.message).toBe('This link has expired. Request a new one below.');
    }
  });

  it('explains any other auth error', () => {
    const parsed = parseSetPasswordLocation('', '#error=access_denied&error_description=bad%20token');
    expect(parsed).toEqual({
      status: 'error',
      message: 'This link is not valid. bad token',
    });
  });

  it('is missing when the url has no token', () => {
    expect(parseSetPasswordLocation('', '')).toEqual({ status: 'missing' });
  });
});
