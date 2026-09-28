import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getCachedPnl, setCachedPnl } from '@/lib/redis';
import { currencyFromShopInfo, normalizeCurrencyCode } from '@/lib/currency';
import {
  resolveBrandReportingCurrency,
  runShopifyBrandSync,
  type ShopifyPnlSyncInput,
} from '@/lib/shopify/run-shopify-brand-sync';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // Shopify pagination + customer enrichment + ad spend sync

export async function POST(request: NextRequest) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Auth check — admin only
  const authHeader = request.headers.get('authorization');
  if (!authHeader) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const token = authHeader.replace('Bearer ', '');
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from('users_profile')
    .select('role')
    .eq('id', user.id)
    .single();

  if (!profile || !['admin', 'founder'].includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden — admin/founder only' }, { status: 403 });
  }

  let body: ShopifyPnlSyncInput = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  return runShopifyBrandSync(supabase, body);
}

// ─── GET handler — fetch synced daily_pnl data ─────────────────

export async function GET(request: NextRequest) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Auth check
  const authHeader = request.headers.get('authorization');
  if (!authHeader) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const token = authHeader.replace('Bearer ', '');
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from('users_profile')
    .select('role, brand_id')
    .eq('id', user.id)
    .single();

  if (!profile || !['admin', 'strategist', 'founder'].includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const brandId = searchParams.get('brand_id');
  const year = searchParams.get('year') || new Date().getFullYear().toString();

  if (!brandId) {
    return NextResponse.json({ error: 'brand_id is required' }, { status: 400 });
  }

  // Strategists and founders can only see their own brand
  if (['strategist', 'founder'].includes(profile.role) && profile.brand_id !== brandId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    // ── Try cache first (60s TTL) ──
    const cached = await getCachedPnl(brandId, year);
    if (cached) {
      return NextResponse.json(cached, {
        headers: { 'X-Cache': 'HIT' },
      });
    }

    const { data: rows, error } = await supabase
      .from('daily_pnl')
      .select('*')
      .eq('brand_id', brandId)
      .gte('date', `${year}-01-01`)
      .lte('date', `${year}-12-31`)
      .order('date', { ascending: false });

    if (error) {
      return NextResponse.json({ error: 'Failed to fetch data', details: error.message }, { status: 500 });
    }

    // Also get brand's Shopify connection status. A brand is "connected" if
    // it has either (a) a live public-app OAuth install in shopify_stores, or
    // (b) custom-distribution client credentials on the brand row.
    const { data: brand } = await supabase
      .from('brands')
      .select('shopify_store_domain, shopify_client_id, gross_margin_pct, meta_ad_account_id, google_ads_customer_id')
      .eq('id', brandId)
      .single();

    let hasOauthInstall = false;
    let shopInfo: unknown = null;
    if (brand?.shopify_store_domain) {
      const { data: storeRow } = await supabase
        .from('shopify_stores')
        .select('access_token, uninstalled_at, shop_info')
        .eq('shop_domain', brand.shopify_store_domain)
        .maybeSingle();
      hasOauthInstall = !!(storeRow?.access_token && !storeRow.uninstalled_at);
      shopInfo = storeRow?.shop_info ?? null;
    }

    // Get last synced timestamp
    const lastSyncedRow = (rows && rows.length > 0)
      ? rows.reduce((latest: any, r: any) => (!latest || r.synced_at > latest.synced_at) ? r : latest, null)
      : null;

    // Reporting currency: prefer tagged daily_pnl.currency, else shop_info / orders.
    const taggedCurrency = (rows || []).find((r: any) => r.currency)?.currency as string | undefined;
    const reporting = taggedCurrency
      ? { code: normalizeCurrencyCode(taggedCurrency), source: 'daily_pnl' as const }
      : await resolveBrandReportingCurrency(
          supabase,
          { id: brandId, shopify_store_domain: brand?.shopify_store_domain },
          [],
          null,
          null
        );

    const payload = {
      rows: rows || [],
      shopify_connected: !!(
        brand?.shopify_store_domain && (hasOauthInstall || brand.shopify_client_id)
      ),
      gross_margin_pct: brand?.gross_margin_pct || 62,
      last_synced_at: lastSyncedRow?.synced_at || null,
      reporting_currency: reporting.code,
      reporting_currency_source: reporting.source,
      shop_currency: currencyFromShopInfo(shopInfo),
    };

    // Fire-and-forget cache write
    await setCachedPnl(brandId, year, payload, 60);

    return NextResponse.json(payload, {
      headers: { 'X-Cache': 'MISS' },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
