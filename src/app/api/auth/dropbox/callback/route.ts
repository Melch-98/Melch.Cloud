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

  const cookieState = req.cookies.get('dbx_oauth_state')?.value;
  if (!cookieState || cookieState !== state) {
    return NextResponse.redirect(`${url.origin}/admin/dropbox?error=state_mismatch`);
  }

  const redirectUri = `${url.origin}/api/auth/dropbox/callback`;

  try {
    const tokens = await exchangeDropboxCode(code, redirectUri);
    const email = await getDropboxAccountEmail(tokens.access_token);
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    const supabase = createServiceClient();
    // upsert the single dropbox row
    await supabase
      .from('integrations')
      .upsert(
        {
          service: 'dropbox',
          refresh_token: tokens.refresh_token,
          access_token: tokens.access_token,
          access_token_expires_at: expiresAt,
          account_email: email,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'service' }
      );

    const res = NextResponse.redirect(`${url.origin}/admin/dropbox?connected=1`);
    res.cookies.delete('dbx_oauth_state');
    return res;
  } catch (err: any) {
    return NextResponse.redirect(
      `${url.origin}/admin/dropbox?error=${encodeURIComponent(err.message || 'exchange_failed')}`
    );
  }
}
