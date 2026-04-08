import { NextRequest, NextResponse } from 'next/server';
import { SHOPIFY_CONFIG, assertShopifyConfig, isValidShopDomain } from '@/lib/shopify/config';
import { generateNonce } from '@/lib/shopify/crypto';

/**
 * Kicks off the Shopify OAuth install flow.
 *
 * Usage: https://melch.cloud/api/shopify/install?shop=tallowtwins.myshopify.com
 *
 * Redirects the merchant to Shopify's authorize page. After they
 * approve scopes, Shopify redirects back to /api/shopify/callback.
 */
export async function GET(req: NextRequest) {
  assertShopifyConfig();

  const shop = req.nextUrl.searchParams.get('shop');
  if (!shop || !isValidShopDomain(shop)) {
    return NextResponse.json(
      { error: 'Missing or invalid `shop` parameter. Expected: <name>.myshopify.com' },
      { status: 400 }
    );
  }

  const nonce = generateNonce();
  const redirectUri = `${SHOPIFY_CONFIG.appUrl}/api/shopify/callback`;

  const authorizeUrl =
    `https://${shop}/admin/oauth/authorize` +
    `?client_id=${encodeURIComponent(SHOPIFY_CONFIG.apiKey)}` +
    `&scope=${encodeURIComponent(SHOPIFY_CONFIG.scopes)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${encodeURIComponent(nonce)}`;

  const res = NextResponse.redirect(authorizeUrl);

  // Store nonce in a short-lived signed cookie so we can verify it on callback.
  res.cookies.set('shopify_oauth_state', nonce, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 60 * 10, // 10 minutes
    path: '/',
  });

  return res;
}
