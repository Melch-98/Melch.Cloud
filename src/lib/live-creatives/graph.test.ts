import { describe, expect, it } from 'vitest';
import { brandBudgetOpen, metaGraphGet, stripAccessToken } from '@/lib/live-creatives/graph';

describe('metaGraphGet', () => {
  it('sends the token as a header and strips it from the URL', async () => {
    let seenUrl = '';
    let seenAuth = '';
    const body = await metaGraphGet(
      'https://graph.facebook.com/v21.0/act_1/ads?limit=1&access_token=meta-token-should-not-leak',
      'meta-token-should-not-leak',
      async (url, init) => {
        seenUrl = url;
        seenAuth = new Headers(init?.headers).get('authorization') || '';
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      },
    );
    expect(body).toEqual({ data: [] });
    expect(seenUrl).not.toContain('access_token');
    expect(seenUrl).not.toContain('meta-token-should-not-leak');
    expect(seenAuth).toBe('Bearer meta-token-should-not-leak');
    expect(stripAccessToken(seenUrl)).toBe(seenUrl);
  });

  it('does not return a token that Meta echoed in an error', async () => {
    await expect(metaGraphGet(
      'https://graph.facebook.com/v21.0/act_1/ads',
      'meta-token-should-not-leak',
      async () => new Response(JSON.stringify({
        error: { message: 'Invalid access_token=meta-token-should-not-leak' },
      }), { status: 400 }),
    )).rejects.toThrow(/access_token=\(redacted\)/);
  });
});

describe('brandBudgetOpen', () => {
  it('closes the run when the reserve is gone', () => {
    expect(brandBudgetOpen(0, 1_000, 240_000)).toBe(true);
    expect(brandBudgetOpen(0, 230_000, 240_000)).toBe(false);
  });
});
