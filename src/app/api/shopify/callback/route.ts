import { NextRequest, NextResponse } from 'next/server';
import { SHOPIFY_CONFIG, isValidShopDomain } from '@/lib/shopify/config';
import { verifyOAuthHmac } from '@/lib/shopify/crypto';
import { registerWebhooks } from '@/lib/shopify/webhooks';
import { createServiceClient } from '@/lib/supabase-server';

/**
 * Shopify OAuth callback.
 *
 * Steps:
 *   1. Verify HMAC + state nonce.
 *   2. Exchange the temporary `code` for a permanent access token.
 *   3. Fetch shop info (store name, currency, owner email).
 *   4. Try to match the shop to an existing brand by shopify_store_domain.
 *   5. Upsert into shopify_stores.
 *   6. Register all webhook topics.
 *   7. Redirect the merchant to a success page.
 */
export async function GET(req: NextRequest) {
  const params = Object.fromEntries(req.nextUrl.searchParams.entries());
  const { shop, code, state } = params;

  if (!shop || !code || !state) {
    return NextResponse.json({ error: 'Missing required params' }, { status: 400 });
  }
  if (!isValidShopDomain(shop)) {
    return NextResponse.json({ error: 'Invalid shop domain' }, { status: 400 });
  }

  // 1. Verify state nonce against the cookie we set in /install.
  const cookieState = req.cookies.get('shopify_oauth_state')?.value;
  if (!cookieState || cookieState !== state) {
    return NextResponse.json({ error: 'State mismatch' }, { status: 403 });
  }

  // Verify HMAC over the rest of the query.
  if (!verifyOAuthHmac(params)) {
    return NextResponse.json({ error: 'HMAC verification failed' }, { status: 403 });
  }

  // 2. Exchange code for permanent access token.
  const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: SHOPIFY_CONFIG.apiKey,
      client_secret: SHOPIFY_CONFIG.apiSecret,
      code,
    }),
  });

  if (!tokenRes.ok) {
    const errBody = await tokenRes.text();
    return NextResponse.json(
      { error: 'Token exchange failed', detail: errBody },
      { status: 502 }
    );
  }

  const { access_token, scope } = await tokenRes.json();

  // 3. Fetch shop info.
  let shopInfo: Record<string, unknown> | null = null;
  try {
    const infoRes = await fetch(
      `https://${shop}/admin/api/${SHOPIFY_CONFIG.apiVersion}/shop.json`,
      { headers: { 'X-Shopify-Access-Token': access_token } }
    );
    if (infoRes.ok) {
      const json = await infoRes.json();
      shopInfo = json.shop ?? null;
    }
  } catch {
    // Non-fatal — continue without shop info.
  }

  // 4. Try to match an existing brand by shopify_store_domain.
  const supabase = createServiceClient();
  const { data: brand } = await supabase
    .from('brands')
    .select('id')
    .eq('shopify_store_domain', shop)
    .maybeSingle();

  // 5. Upsert into shopify_stores.
  const { error: upsertError } = await supabase
    .from('shopify_stores')
    .upsert(
      {
        brand_id: brand?.id ?? null,
        shop_domain: shop,
        access_token,
        scopes: scope,
        installed_at: new Date().toISOString(),
        uninstalled_at: null,
        shop_info: shopInfo,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'shop_domain' }
    );

  if (upsertError) {
    return NextResponse.json(
      { error: 'Failed to persist shop', detail: upsertError.message },
      { status: 500 }
    );
  }

  // 6. Register webhooks (best-effort — log failures, don't block install).
  const webhookResults = await registerWebhooks(shop, access_token);
  await supabase
    .from('shopify_stores')
    .update({ registered_webhooks: webhookResults })
    .eq('shop_domain', shop);

  // 7. Redirect the merchant into the embedded app inside Shopify admin.
  //    That loads /app in an iframe, which runs App Bridge → token
  //    exchange, which overwrites this non-expiring auth-code-grant token
  //    with an expiring offline token that the Admin API will actually
  //    accept. Without this hop, the embedded /app flow never runs.
  const shopHandle = shop.replace(/\.myshopify\.com$/, '');
  const embeddedUrl = `https://admin.shopify.com/store/${shopHandle}/apps/melch-cloud`;
  const res = NextResponse.redirect(embeddedUrl);
  res.cookies.delete('shopify_oauth_state');
  return res;
}
