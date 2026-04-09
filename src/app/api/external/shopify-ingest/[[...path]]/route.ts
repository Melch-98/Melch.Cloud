import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

/**
 * POST /api/external/shopify-ingest/<sub-path>
 *
 * Receives forwarded Shopify data from our Gadget connector
 * (melch-shopify-connector.gadget.app) and writes it into Supabase.
 *
 * Auth: requires `Authorization: Bearer ${MELCH_GADGET_SECRET}`.
 *
 * Sub-paths handled (mirrors api/lib/forwardToMelch.ts in the Gadget app):
 *   /shop-installed   { shopId, shopDomain, shopName, email, installedAt }
 *   /shop-uninstalled { shopId, shopDomain, uninstalledAt }
 *   /order            { event, shopId, orderId, order }
 *   /product          { event, shopId, productId, product }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { path?: string[] } }
) {
  // ── Auth ────────────────────────────────────────────────
  const expected = process.env.MELCH_GADGET_SECRET;
  if (!expected) {
    console.error('[shopify-ingest] MELCH_GADGET_SECRET is not configured');
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }
  const authHeader = req.headers.get('authorization') || '';
  if (authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ── Parse body ──────────────────────────────────────────
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Determine the sub-path. Prefer the URL segment; fall back to a `path`
  // field in the body for clients that POST to the bare endpoint.
  const segments = params.path ?? [];
  const subPath = '/' + (segments.join('/') || String(body.path ?? '').replace(/^\/+/, ''));
  const event = typeof body.event === 'string' ? body.event : undefined;
  const shopDomain = typeof body.shopDomain === 'string' ? body.shopDomain : undefined;
  const shopId = body.shopId;

  console.log('[shopify-ingest] received', { subPath, event, shopDomain, shopId });

  const supabase = createServiceClient();

  try {
    switch (subPath) {
      case '/shop-installed': {
        const { shopName, email, installedAt } = body as {
          shopName?: string;
          email?: string;
          installedAt?: string;
        };
        if (!shopDomain) {
          return NextResponse.json({ error: 'Missing shopDomain' }, { status: 400 });
        }
        // Link to an existing brand by shopify_store_domain (mirrors token-exchange).
        const { data: brand } = await supabase
          .from('brands')
          .select('id')
          .eq('shopify_store_domain', shopDomain)
          .maybeSingle();

        const { error } = await supabase
          .from('shopify_stores')
          .upsert(
            {
              brand_id: brand?.id ?? null,
              shop_domain: shopDomain,
              access_token: 'gadget-managed',
              scopes: 'gadget-managed',
              installed_at: installedAt ?? new Date().toISOString(),
              uninstalled_at: null,
              shop_info: { shopId, shopName, email, source: 'gadget' },
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'shop_domain' }
          );
        if (error) throw error;
        return NextResponse.json({ ok: true });
      }

      case '/shop-uninstalled': {
        if (!shopDomain) {
          return NextResponse.json({ error: 'Missing shopDomain' }, { status: 400 });
        }
        const { uninstalledAt } = body as { uninstalledAt?: string };
        const { error } = await supabase
          .from('shopify_stores')
          .update({
            uninstalled_at: uninstalledAt ?? new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('shop_domain', shopDomain);
        if (error) throw error;
        return NextResponse.json({ ok: true });
      }

      case '/order': {
        const order = (body.order ?? {}) as Record<string, unknown>;
        const orderShopDomain =
          shopDomain ?? (typeof order.shop_domain === 'string' ? order.shop_domain : undefined);
        if (!orderShopDomain) {
          return NextResponse.json({ error: 'Missing shopDomain' }, { status: 400 });
        }
        const shopifyOrderId = Number(body.orderId ?? order.id);
        if (!Number.isFinite(shopifyOrderId)) {
          return NextResponse.json({ error: 'Missing orderId' }, { status: 400 });
        }

        const { data: store } = await supabase
          .from('shopify_stores')
          .select('brand_id')
          .eq('shop_domain', orderShopDomain)
          .maybeSingle();

        const row = {
          shop_domain: orderShopDomain,
          brand_id: store?.brand_id ?? null,
          shopify_order_id: shopifyOrderId,
          order_number: order.name != null ? String(order.name) : null,
          email: typeof order.email === 'string' ? order.email : null,
          total_price: order.total_price != null ? Number(order.total_price) : null,
          subtotal_price: order.subtotal_price != null ? Number(order.subtotal_price) : null,
          total_tax: order.total_tax != null ? Number(order.total_tax) : null,
          total_discounts: order.total_discounts != null ? Number(order.total_discounts) : null,
          currency: typeof order.currency === 'string' ? order.currency : null,
          financial_status:
            typeof order.financial_status === 'string' ? order.financial_status : null,
          fulfillment_status:
            typeof order.fulfillment_status === 'string' ? order.fulfillment_status : null,
          customer_id:
            order.customer && typeof (order.customer as { id?: unknown }).id === 'number'
              ? ((order.customer as { id: number }).id as number)
              : null,
          line_items: (order.line_items as unknown) ?? null,
          shipping_address: (order.shipping_address as unknown) ?? null,
          billing_address: (order.billing_address as unknown) ?? null,
          source_name: typeof order.source_name === 'string' ? order.source_name : null,
          landing_site: typeof order.landing_site === 'string' ? order.landing_site : null,
          referring_site: typeof order.referring_site === 'string' ? order.referring_site : null,
          shopify_created_at:
            typeof order.created_at === 'string' ? order.created_at : null,
          shopify_updated_at:
            typeof order.updated_at === 'string' ? order.updated_at : null,
          raw: order,
          updated_at: new Date().toISOString(),
        };

        // No unique constraint on (shop_domain, shopify_order_id) yet, so
        // do a manual upsert: look up existing row, then update or insert.
        const { data: existing, error: lookupErr } = await supabase
          .from('shopify_orders')
          .select('id')
          .eq('shop_domain', orderShopDomain)
          .eq('shopify_order_id', shopifyOrderId)
          .maybeSingle();
        if (lookupErr) throw lookupErr;

        if (existing?.id) {
          const { error } = await supabase
            .from('shopify_orders')
            .update(row)
            .eq('id', existing.id);
          if (error) throw error;
        } else {
          const { error } = await supabase.from('shopify_orders').insert(row);
          if (error) throw error;
        }
        return NextResponse.json({ ok: true });
      }

      case '/product': {
        // TODO: persist products once a shopify_products table exists.
        // For now, log and ack so shop install/uninstall + orders work end-to-end.
        console.log('[shopify-ingest] product event (not persisted)', {
          event,
          shopDomain,
          productId: body.productId,
        });
        return NextResponse.json({ ok: true, persisted: false });
      }

      default:
        return NextResponse.json({ error: `Unknown path: ${subPath}` }, { status: 400 });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[shopify-ingest] db error', { subPath, event, shopDomain, error: message });
    return NextResponse.json({ error: 'Persistence failed' }, { status: 500 });
  }
}
