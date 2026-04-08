import { NextRequest, NextResponse } from 'next/server';
import { verifyWebhookHmac } from '@/lib/shopify/crypto';
import { inngest } from '@/lib/inngest/client';
import { createServiceClient } from '@/lib/supabase-server';

/**
 * Single webhook receiver for all Shopify topics.
 *
 * Path is /api/shopify/webhooks/<topic-with-dashes>
 * (e.g. orders/create → /api/shopify/webhooks/orders-create)
 *
 * Steps:
 *   1. Read raw body (required for HMAC verification)
 *   2. Verify the X-Shopify-Hmac-Sha256 header
 *   3. Hand off to Inngest as an event (so the response is fast and retries are handled)
 *   4. For app/uninstalled, mark the store inactive immediately
 *   5. Return 200 ASAP — Shopify retries on non-2xx
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { topic: string } }
) {
  const rawBody = await req.text();
  const hmacHeader = req.headers.get('x-shopify-hmac-sha256');
  const shop = req.headers.get('x-shopify-shop-domain') || '';
  const topicHeader = req.headers.get('x-shopify-topic') || params.topic.replace('-', '/');

  if (!verifyWebhookHmac(rawBody, hmacHeader)) {
    return NextResponse.json({ error: 'Invalid HMAC' }, { status: 401 });
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Route to the appropriate Inngest event by topic.
  try {
    switch (topicHeader) {
      case 'orders/create':
        await inngest.send({
          name: 'shopify/order.created',
          data: { shop_domain: shop, order: payload },
        });
        break;
      case 'orders/updated':
        await inngest.send({
          name: 'shopify/order.updated',
          data: { shop_domain: shop, order: payload },
        });
        break;
      case 'orders/cancelled':
        await inngest.send({
          name: 'shopify/order.cancelled',
          data: { shop_domain: shop, order: payload },
        });
        break;
      case 'refunds/create':
        await inngest.send({
          name: 'shopify/refund.created',
          data: { shop_domain: shop, refund: payload },
        });
        break;
      case 'app/uninstalled': {
        await inngest.send({
          name: 'shopify/app.uninstalled',
          data: { shop_domain: shop },
        });
        // Also mark the store as uninstalled immediately so we stop using its token.
        const supabase = createServiceClient();
        await supabase
          .from('shopify_stores')
          .update({ uninstalled_at: new Date().toISOString() })
          .eq('shop_domain', shop);
        break;
      }
      // GDPR mandatory webhooks — log for compliance, no-op for now.
      case 'customers/data_request':
      case 'customers/redact':
      case 'shop/redact':
        console.log(`[shopify-gdpr] ${topicHeader} from ${shop}`, payload);
        break;
      default:
        console.warn(`[shopify-webhook] unhandled topic: ${topicHeader}`);
    }
  } catch (err) {
    console.error('[shopify-webhook] dispatch failed', err);
    // Still return 200 — we don't want Shopify to retry forever if Inngest is down.
    // Inngest events themselves will retry inside the function.
  }

  return NextResponse.json({ ok: true });
}
