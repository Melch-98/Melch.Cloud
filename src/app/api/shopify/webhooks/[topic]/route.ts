import { NextRequest, NextResponse } from 'next/server';
import { SHOPIFY_CONFIG } from '@/lib/shopify/config';
import { loadBrandClientSecrets } from '@/lib/shopify/brand-secrets';
import { authorizeShopifyWebhook } from '@/lib/shopify/webhook-hmac';
import { dispatchShopifyWebhook } from '@/lib/shopify/webhook-handlers';
import { createServiceClient } from '@/lib/supabase-server';

/**
 * Single webhook receiver for all Shopify topics.
 *
 * Path is /api/shopify/webhooks/<topic-with-dashes>
 * (e.g. orders/create → /api/shopify/webhooks/orders-create)
 *
 * Steps:
 *   1. Read raw body (required for HMAC verification)
 *   2. Verify X-Shopify-Hmac-Sha256 with the Melch.Cloud app secret, or with the
 *      custom-app secret stored on brands for X-Shopify-Shop-Domain.
 *      Unsigned or unverified payloads are rejected.
 *   3. Upsert orders/create, orders/updated, and orders/cancelled in this request.
 *      The conflict key is shop_domain + shopify_order_id.
 *   4. For app/uninstalled, mark the store inactive once.
 *   5. Return 200. Shopify retries on non-2xx. The 2h order cron reconciles.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { topic: string } }
) {
  const rawBody = await req.text();
  const hmacHeader = req.headers.get('x-shopify-hmac-sha256');
  const shop = req.headers.get('x-shopify-shop-domain') || '';
  const topicHeader = req.headers.get('x-shopify-topic') || params.topic.replace('-', '/');

  const auth = await authorizeShopifyWebhook({
    rawBody,
    hmacHeader,
    shopDomain: shop,
    appSecret: SHOPIFY_CONFIG.apiSecret,
    loadBrandSecrets: loadBrandClientSecrets,
  });
  if (!auth.ok) {
    if (auth.reason === 'lookup_failed') {
      console.error('[shopify-webhook] brand secret lookup failed', shop);
      return NextResponse.json({ error: 'Webhook verification failed' }, { status: 500 });
    }
    return NextResponse.json({ error: 'Invalid HMAC' }, { status: 401 });
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  try {
    await dispatchShopifyWebhook({
      supabase: createServiceClient(),
      topic: topicHeader,
      shop,
      payload,
    });
  } catch (err) {
    console.error('[shopify-webhook] handling failed', err);
    const message = err instanceof Error ? err.message : 'Webhook handling failed';
    const safe = message.startsWith('Server config error') ? message : 'Webhook handling failed';
    return NextResponse.json({ error: safe }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
