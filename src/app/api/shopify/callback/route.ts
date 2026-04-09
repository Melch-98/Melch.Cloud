import { NextRequest, NextResponse } from 'next/server';
import { isValidShopDomain } from '@/lib/shopify/config';
import { verifyOAuthHmac } from '@/lib/shopify/crypto';

/**
 * Shopify OAuth callback.
 *
 * Under managed install + token exchange (use_legacy_install_flow = false),
 * this endpoint must NOT perform an auth-code grant. Shopify no longer
 * accepts the non-expiring tokens that grant produces.
 *
 * Its only job is to verify the request came from Shopify and bounce the
 * merchant into the embedded admin, where /app loads in an iframe and
 * runs the App Bridge → /api/shopify/token-exchange flow.
 */
export async function GET(req: NextRequest) {
  const params = Object.fromEntries(req.nextUrl.searchParams.entries());
  const { shop, state } = params;

  if (!shop) {
    return NextResponse.json({ error: 'Missing shop' }, { status: 400 });
  }
  if (!isValidShopDomain(shop)) {
    return NextResponse.json({ error: 'Invalid shop domain' }, { status: 400 });
  }

  const cookieState = req.cookies.get('shopify_oauth_state')?.value;
  if (state && (!cookieState || cookieState !== state)) {
    return NextResponse.json({ error: 'State mismatch' }, { status: 403 });
  }

  if (!verifyOAuthHmac(params)) {
    return NextResponse.json({ error: 'HMAC verification failed' }, { status: 403 });
  }

  const shopHandle = shop.replace(/\.myshopify\.com$/, '');
  const embeddedUrl = `https://admin.shopify.com/store/${shopHandle}/apps/melch-cloud`;
  const res = NextResponse.redirect(embeddedUrl);
  res.cookies.delete('shopify_oauth_state');
  return res;
}
