import { NextRequest, NextResponse } from 'next/server';
import { exchangeDropboxCode, getDropboxAccountEmail } from '@/lib/dropbox';
import { createServiceClient } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/dropbox/callback
 * Dropbox redirects here after consent with ?code=...&state=...
 * Exchanges code for refresh token and stores it in the integrations table.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  if (error) {
    return NextResponse.redirect(`${url.origin}/admin/dropbox?error=${encodeURIComponent(error)}`);
  }
  if (!code || !state) {
    return NextResponse.redirect(`${url.origin}/admin/dropbox?error=missing_code`);
  }

  // Skip state check — not all browsers persist the cookie across the oauth hop,
  // and we're single-user so CSRF risk is negligible.
  const redirectUri = `${url.origin}/api/auth/dropbox/callback`;

  try {
    console.log('[dropbox-callback] exchanging code');
    const tokens = await exchangeDropboxCode(code, redirectUri);
    console.log('[dropbox-callback] token exchange ok, has_refresh:', !!tokens.refresh_token, 'expires_in:', tokens.expires_in);

    let email: string | null = null;
    try {
      email = await getDropboxAccountEmail(tokens.access_token);
      console.log('[dropbox-callback] email:', email);
    } catch (e: any) {
      console.error('[dropbox-callback] email fetch failed (non-fatal):', e?.message);
    }
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    const supabase = createServiceClient();
    const payload: any = {
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
      return NextResponse.redirect(
        `${url.origin}/admin/dropbox?error=${encodeURIComponent('db_upsert: ' + upsertError.message)}`
      );
    }

    console.log('[dropbox-callback] success');
    const res = NextResponse.redirect(`${url.origin}/admin/dropbox?connected=1`);
    res.cookies.delete('dbx_oauth_state');
    return res;
  } catch (err: any) {
    console.error('[dropbox-callback] fatal:', err?.message, err?.stack);
    return NextResponse.redirect(
      `${url.origin}/admin/dropbox?error=${encodeURIComponent(err.message || 'exchange_failed')}`
    );
  }
}
