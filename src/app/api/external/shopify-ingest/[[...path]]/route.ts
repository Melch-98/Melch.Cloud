import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createServiceClient } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

async function getBrandIdForShop(
  supabase: SupabaseClient,
  shopDomain: string
): Promise<string | null> {
  const { data: brand } = await supabase
    .from('brands')
    .select('id')
    .eq('shopify_store_domain', shopDomain)
    .maybeSingle();
  return (brand?.id as string | undefined) ?? null;
}

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
        const brandId = await getBrandIdForShop(supabase, shopDomain);

        const { error } = await supabase
          .from('shopify_stores')
          .upsert(
            {
              brand_id: brandId,
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
        if (!shopDomain) {
          return NextResponse.json({ error: 'Missing shopDomain' }, { status: 400 });
        }
        const shopifyOrderId = Number(body.id);
        if (!Number.isFinite(shopifyOrderId)) {
          return NextResponse.json({ error: 'Missing id' }, { status: 400 });
        }

        const brandId = await getBrandIdForShop(supabase, shopDomain);
        const customer = body.customer as { id?: unknown } | undefined;

        const row = {
          shop_domain: shopDomain,
          brand_id: brandId,
          shopify_order_id: shopifyOrderId,
          order_number: body.orderNumber ?? body.name ?? null,
          email: body.email ?? null,
          total_price: body.totalPrice ?? null,
          subtotal_price: body.subtotalPrice ?? null,
          total_tax: body.totalTax ?? null,
          total_discounts: body.totalDiscounts ?? null,
          currency: body.currency ?? null,
          financial_status: body.financialStatus ?? null,
          fulfillment_status: body.fulfillmentStatus ?? null,
          customer_id: customer?.id ?? body.customerId ?? null,
          line_items: body.lineItems ?? [],
          shipping_address: body.shippingAddress ?? null,
          billing_address: body.billingAddress ?? null,
          source_name: body.sourceName ?? null,
          landing_site: body.landingSite ?? null,
          referring_site: body.referringSite ?? null,
          shopify_created_at: body.shopifyCreatedAt ?? body.createdAt ?? null,
          shopify_updated_at: body.shopifyUpdatedAt ?? body.updatedAt ?? null,
          raw: body,
          updated_at: new Date().toISOString(),
        };

        console.log('[shopify-ingest] order upsert', {
          shop_domain: shopDomain,
          shopify_order_id: shopifyOrderId,
        });

        const { data, error } = await supabase
          .from('shopify_orders')
          .upsert(row, { onConflict: 'shop_domain,shopify_order_id' })
          .select('id')
          .maybeSingle();
        if (error) throw error;
        return NextResponse.json({ ok: true, id: data?.id });
      }

      case '/product': {
        if (!shopDomain) {
          return NextResponse.json({ error: 'Missing shopDomain' }, { status: 400 });
        }
        const shopifyProductId = Number(body.id);
        if (!Number.isFinite(shopifyProductId)) {
          return NextResponse.json({ error: 'Missing id' }, { status: 400 });
        }

        const brandId = await getBrandIdForShop(supabase, shopDomain);
        const rawTags = body.tags;
        const tags = Array.isArray(rawTags)
          ? rawTags
          : String(rawTags ?? '')
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean);

        const row = {
          shop_domain: shopDomain,
          brand_id: brandId,
          shopify_product_id: shopifyProductId,
          title: body.title ?? null,
          handle: body.handle ?? null,
          status: body.status ?? null,
          product_type: body.productType ?? null,
          vendor: body.vendor ?? null,
          tags,
          variants: body.variants ?? [],
          images: body.images ?? [],
          shopify_created_at: body.shopifyCreatedAt ?? body.createdAt ?? null,
          shopify_updated_at: body.shopifyUpdatedAt ?? body.updatedAt ?? null,
          raw: body,
          updated_at: new Date().toISOString(),
        };

        console.log('[shopify-ingest] product upsert', {
          shop_domain: shopDomain,
          shopify_product_id: shopifyProductId,
        });

        const { data, error } = await supabase
          .from('shopify_products')
          .upsert(row, { onConflict: 'shop_domain,shopify_product_id' })
          .select('id')
          .maybeSingle();
        if (error) throw error;
        return NextResponse.json({ ok: true, id: data?.id });
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
