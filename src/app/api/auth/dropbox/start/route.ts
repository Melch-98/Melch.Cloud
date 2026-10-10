import { NextRequest, NextResponse } from 'next/server';
import { requireAdminActor } from '@/lib/admin-actor';
import { buildDropboxAuthUrl } from '@/lib/dropbox';
import { signDropboxOAuthState } from '@/lib/dropbox-oauth-state';

export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/dropbox/start
 * Starts Dropbox OAuth for a signed-in admin and redirects to the consent screen.
 * `state` is an HMAC bound to that admin.
 */
export async function GET(req: NextRequest) {
  const admin = await requireAdminActor({
    authorization: req.headers.get('authorization'),
    cookies: req.cookies.getAll(),
  });
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }

  const state = signDropboxOAuthState(admin.userId);
  if (!state) {
    return NextResponse.json({ error: 'DROPBOX_APP_SECRET is not set' }, { status: 500 });
  }

  const origin = new URL(req.url).origin;
  const redirectUri = `${origin}/api/auth/dropbox/callback`;
  return NextResponse.redirect(buildDropboxAuthUrl(redirectUri, state));
}
