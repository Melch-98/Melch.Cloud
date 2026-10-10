import { describe, expect, it } from 'vitest';
import { accessTokenFromSupabaseCookies } from '@/lib/supabase-session-cookie';

const URL = 'https://example.supabase.co';

function sessionCookie(token: string) {
  const stored = `base64-${Buffer.from(JSON.stringify({ access_token: token })).toString('base64url')}`;
  return { name: 'sb-example-auth-token', value: stored };
}

describe('accessTokenFromSupabaseCookies', () => {
  it('reads a base64url session cookie', () => {
    expect(accessTokenFromSupabaseCookies([sessionCookie('good')], URL)).toBe('good');
  });

  it('joins chunked cookies when the base name is absent', () => {
    const full = sessionCookie('chunked-token').value;
    const mid = Math.floor(full.length / 2);
    expect(
      accessTokenFromSupabaseCookies(
        [
          { name: 'sb-example-auth-token.1', value: full.slice(mid) },
          { name: 'sb-example-auth-token.0', value: full.slice(0, mid) },
        ],
        URL
      )
    ).toBe('chunked-token');
  });

  it('prefers the unchunked cookie and falls back to a raw JWT', () => {
    const jwt = 'aaa.bbb.ccc';
    expect(
      accessTokenFromSupabaseCookies(
        [
          { name: 'sb-example-auth-token.0', value: 'ignored' },
          sessionCookie('whole'),
        ],
        URL
      )
    ).toBe('whole');
    expect(accessTokenFromSupabaseCookies([{ name: 'sb-access-token', value: jwt }], URL)).toBe(jwt);
  });

  it('reads a JSON session and a JSON token array', () => {
    expect(
      accessTokenFromSupabaseCookies(
        [{ name: 'sb-example-auth-token', value: JSON.stringify({ access_token: 'json-token' }) }],
        URL
      )
    ).toBe('json-token');
    expect(
      accessTokenFromSupabaseCookies(
        [{ name: 'sb-example-auth-token', value: JSON.stringify(['array-token', 'refresh']) }],
        URL
      )
    ).toBe('array-token');
  });

  it('returns null for a missing or garbage cookie', () => {
    expect(accessTokenFromSupabaseCookies([], URL)).toBeNull();
    expect(
      accessTokenFromSupabaseCookies([{ name: 'sb-example-auth-token', value: 'not-a-session' }], URL)
    ).toBeNull();
  });
});
