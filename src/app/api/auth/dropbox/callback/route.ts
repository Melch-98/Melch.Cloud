import { NextRequest, NextResponse } from 'next/server';
import { requireAdminActor } from '@/lib/admin-actor';
import { verifyDropboxOAuthState } from '@/lib/dropbox-oauth-state';
import { exchangeDropboxCode, getDropboxAccountEmail } from '@/lib/dropbox';
import { createServiceClient } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

function dropboxRedirect(origin: string, query: string) {
  const res = NextResponse.redirect(`${origin}/admin/dropbox?${query}`);
  res.cookies.delete('dbx_oauth_state');
  return res;
}

/**
 * GET /api/auth/dropbox/callback
 * Dropbox redirects here after consent with ?code=...&state=...
 * A signed-in admin and a valid state for that admin are required before
 * the code is exchanged. The refresh token is stored on integrations.service = dropbox.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const admin = await requireAdminActor({
    authorization: req.headers.get('authorization'),
    cookies: req.cookies.getAll(),
  });
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }

  const code = url.searchParams.get('code');
  const state = verifyDropboxOAuthState(url.searchParams.get('state'));
  if (!state.ok || state.userId !== admin.userId) {
    return dropboxRedirect(url.origin, 'error=invalid_state');
  }

  const error = url.searchParams.get('error');
  if (error) {
    return dropboxRedirect(url.origin, `error=${encodeURIComponent(error)}`);
  }
  if (!code) {
    return dropboxRedirect(url.origin, 'error=missing_code');
  }

  const redirectUri = `${url.origin}/api/auth/dropbox/callback`;

  try {
    console.log('[dropbox-callback] exchanging code');
    const tokens = await exchangeDropboxCode(code, redirectUri);
    console.log('[dropbox-callback] token exchange ok, has_refresh:', !!tokens.refresh_token, 'expires_in:', tokens.expires_in);

    let email: string | null = null;
    try {
      email = await getDropboxAccountEmail(tokens.access_token);
      console.log('[dropbox-callback] email:', email);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'email lookup failed';
      console.error('[dropbox-callback] email fetch failed (non-fatal):', message);
    }
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    const supabase = createServiceClient();
    const payload: {
      service: string;
      access_token: string;
      access_token_expires_at: string;
      account_email: string | null;
      updated_at: string;
      refresh_token?: string;
    } = {
      service: 'dropbox',
      access_token: tokens.access_token,
      access_token_expires_at: expiresAt,
      account_email: email,
      updated_at: new Date().toISOString(),
    };
    // only overwrite refresh_token if Dropbox returned one (re-consent may omit it)
    if (tokens.refresh_token) {
      payload.refresh_token = tokens.refresh_token;
    }

    const { error: upsertError } = await supabase
      .from('integrations')
      .upsert(payload, { onConflict: 'service' });

    if (upsertError) {
      console.error('[dropbox-callback] upsert error:', upsertError);
      return dropboxRedirect(url.origin, `error=${encodeURIComponent('db_upsert: ' + upsertError.message)}`);
    }

    console.log('[dropbox-callback] success');
    return dropboxRedirect(url.origin, 'connected=1');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'exchange_failed';
    console.error('[dropbox-callback] fatal:', message);
    return dropboxRedirect(url.origin, `error=${encodeURIComponent(message || 'exchange_failed')}`);
  }
}
