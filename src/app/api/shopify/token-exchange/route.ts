import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { SHOPIFY_CONFIG, assertShopifyConfig, isValidShopDomain } from '@/lib/shopify/config';
import { createServiceClient } from '@/lib/supabase-server';
import { registerWebhooks } from '@/lib/shopify/webhooks';

export const dynamic = 'force-dynamic';

/**
 * POST /api/shopify/token-exchange
 * Body: { shop: string, id_token: string }
 *
 * Swaps a Shopify-issued session token (id_token JWT) for an expiring
 * offline access token via the token-exchange grant. This is the current
 * Shopify-recommended auth path for embedded apps and the only way to
 * receive tokens that the Admin API will accept.
 */
export async function POST(req: NextRequest) {
  assertShopifyConfig();

  let body: { shop?: string; id_token?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { shop, id_token } = body;
  if (!shop || !id_token) {
    return NextResponse.json({ error: 'Missing shop or id_token' }, { status: 400 });
  }
  if (!isValidShopDomain(shop)) {
    return NextResponse.json({ error: 'Invalid shop domain' }, { status: 400 });
  }

  // Verify the id_token JWT was signed by Shopify with our app secret.
  // Shopify signs session tokens with HS256 using the app's client secret.
  const verified = verifySessionTokenHs256(id_token, SHOPIFY_CONFIG.apiSecret, shop);
  if (!verified.ok) {
    return NextResponse.json({ error: 'Session token verification failed', detail: verified.reason }, { status: 403 });
  }

  // Token exchange: swap id_token for a long-lived offline access token.
  const exchangeRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: SHOPIFY_CONFIG.apiKey,
      client_secret: SHOPIFY_CONFIG.apiSecret,
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token: id_token,
      subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
      requested_token_type: 'urn:shopify:params:oauth:token-type:offline-access-token',
    }),
  });

  if (!exchangeRes.ok) {
    const errBody = await exchangeRes.text();
    return NextResponse.json(
      { error: 'Token exchange failed', detail: errBody },
      { status: 502 }
    );
  }

  const { access_token, scope } = (await exchangeRes.json()) as {
    access_token: string;
    scope: string;
  };

  // Fetch shop info for the store card.
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
    /* non-fatal */
  }

  // Link to an existing brand by shopify_store_domain.
  const supabase = createServiceClient();
  const { data: brand } = await supabase
    .from('brands')
    .select('id')
    .eq('shopify_store_domain', shop)
    .maybeSingle();

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

  // Register webhooks best-effort.
  try {
    const webhookResults = await registerWebhooks(shop, access_token);
    await supabase
      .from('shopify_stores')
      .update({ registered_webhooks: webhookResults })
      .eq('shop_domain', shop);
  } catch {
    /* non-fatal */
  }

  return NextResponse.json({ ok: true });
}

// ─── Session token (JWT) verification ──────────────────────────────

/**
 * Verifies a Shopify-issued session token (id_token). The token is a JWT
 * signed by Shopify with HS256 using the app's client secret. We verify
 * the signature, the `aud` claim (= our client id), and the `dest` claim
 * (= the shop that initiated the session).
 */
function verifySessionTokenHs256(
  token: string,
  secret: string,
  shop: string
): { ok: true } | { ok: false; reason: string } {
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed jwt' };
  const [headerB64, payloadB64, signatureB64] = parts;

  const signingInput = `${headerB64}.${payloadB64}`;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(signingInput)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  if (expected !== signatureB64) {
    return { ok: false, reason: 'signature mismatch' };
  }

  let payload: Record<string, unknown>;
  try {
    const json = Buffer.from(payloadB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    payload = JSON.parse(json);
  } catch {
    return { ok: false, reason: 'malformed payload' };
  }

  const now = Math.floor(Date.now() / 1000);
  const exp = typeof payload.exp === 'number' ? payload.exp : 0;
  const nbf = typeof payload.nbf === 'number' ? payload.nbf : 0;
  if (exp && now > exp) return { ok: false, reason: 'token expired' };
  if (nbf && now < nbf - 5) return { ok: false, reason: 'token not yet valid' };

  if (payload.aud !== SHOPIFY_CONFIG.apiKey) {
    return { ok: false, reason: 'audience mismatch' };
  }

  const dest = typeof payload.dest === 'string' ? payload.dest : '';
  // dest looks like https://{shop}.myshopify.com
  if (!dest.includes(shop)) {
    return { ok: false, reason: 'dest mismatch' };
  }

  return { ok: true };
}
