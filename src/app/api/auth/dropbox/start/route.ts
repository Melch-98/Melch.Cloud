import { NextRequest, NextResponse } from 'next/server';
import { buildDropboxAuthUrl } from '@/lib/dropbox';
import { randomBytes } from 'crypto';

export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/dropbox/start
 * Kicks off the Dropbox OAuth flow. Redirects to Dropbox consent.
 * Requires the caller to be signed into Melch.Cloud (admin).
 */
export async function GET(req: NextRequest) {
  const origin = new URL(req.url).origin;
  const redirectUri = `${origin}/api/auth/dropbox/callback`;
  const state = randomBytes(16).toString('hex');

  const url = buildDropboxAuthUrl(redirectUri, state);
  const res = NextResponse.redirect(url);
  res.cookies.set('dbx_oauth_state', state, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  });
  return res;
}
