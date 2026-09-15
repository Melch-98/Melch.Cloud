import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getFxRates, toReportingCurrency, normalizeCurrencyCode } from '@/lib/currency';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * Dashboard brand performance ticker — Melch-native source of truth.
 *
 * Reads `daily_pnl` (same table / net-revenue formula as Daily P&L & Performance),
 * excludes archived brands (`archived_at IS NULL`), and converts each brand's
 * reporting currency → USD for the cross-brand rollup table.
 *
 * Previously this route hit live Meta/Google/TW APIs. Those numbers diverged from
 * Performance (ad-platform purchase ROAS ≠ Shopify net revenue; forced USD labels
 * on CAD brands). Nick's bar: accurate Melch data or fix the widgets — keep Dashboard.
 */

interface TickerRow {
  brand_id: string;
  brand_name: string;
  channel: 'meta' | 'google';
  spend: number;
  revenue: number;
  roas: number;
  as_of_date: string;
  native_currency: string;
}

interface BrandSummary {
  brand_id: string;
  brand_name: string;
  spend: number;
  revenue: number;
  roas: number;
  meta_spend: number;
  google_spend: number;
  other_spend: number;
  channels: Array<'meta' | 'google'>;
  as_of_date: string;
  native_currency: string;
}

/** Same Shopify net as Daily P&L calcFields (taxes are pass-through, not subtracted). */
function netRevenueFromPnl(row: {
  gross_sales?: number | string | null;
  discounts?: number | string | null;
  refunds?: number | string | null;
  shipping?: number | string | null;
}): number {
  const gross = Number(row.gross_sales || 0);
  const discounts = Number(row.discounts || 0);
  const refunds = Number(row.refunds || 0);
  const shipping = Number(row.shipping || 0);
  return gross + discounts + refunds + shipping;
}

export async function GET(request: NextRequest) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const authHeader = request.headers.get('authorization');
  if (!authHeader) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from('users_profile')
    .select('role, brand_id')
    .eq('id', user.id)
    .single();

  if (!profile || !['admin', 'founder', 'strategist'].includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Active brands only — never hardcode MTE; archived_at IS NULL is the rule.
  let brandsQuery = supabase
    .from('brands')
    .select('id, name')
    .is('archived_at', null)
    .order('name');

  if (profile.role !== 'admin' && profile.brand_id) {
    brandsQuery = brandsQuery.eq('id', profile.brand_id);
  }

  const { data: brands, error: brandsError } = await brandsQuery;
  if (brandsError) {
    return NextResponse.json({ error: brandsError.message }, { status: 500 });
  }

  const brandList = brands || [];
  if (brandList.length === 0) {
    return NextResponse.json({
      rows: [] as TickerRow[],
      brands: [] as BrandSummary[],
      source: 'daily_pnl',
      display_currency: 'USD',
      lookback_days: 14,
      as_of: new Date().toISOString(),
    });
  }

  const brandIds = brandList.map((b) => b.id);
  const brandNameById = new Map(brandList.map((b) => [b.id, b.name]));

  // Look back 14 days so brands with stale sync still appear (labeled by as_of_date).
  const lookbackDays = 14;
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - lookbackDays);
  const sinceStr = since.toISOString().split('T')[0];

  const { data: pnlRows, error: pnlError } = await supabase
    .from('daily_pnl')
    .select(
      'brand_id, date, currency, gross_sales, discounts, refunds, shipping, meta_spend, google_spend, other_spend, synced_at'
    )
    .in('brand_id', brandIds)
    .gte('date', sinceStr)
    .order('date', { ascending: false });

  if (pnlError) {
    return NextResponse.json({ error: pnlError.message }, { status: 500 });
  }

  type PnlRow = {
    brand_id: string;
    date: string;
    currency: string | null;
    gross_sales: number | string | null;
    discounts: number | string | null;
    refunds: number | string | null;
    shipping: number | string | null;
    meta_spend: number | string | null;
    google_spend: number | string | null;
    other_spend: number | string | null;
    synced_at: string | null;
  };

  // Latest row per brand (query is date DESC).
  const latestByBrand = new Map<string, PnlRow>();
  for (const row of (pnlRows || []) as PnlRow[]) {
    if (!latestByBrand.has(row.brand_id)) {
      latestByBrand.set(row.brand_id, row);
    }
  }

  const fxRates = await getFxRates();
  const displayCurrency = 'USD';

  const brandSummaries: BrandSummary[] = [];
  const tickerRows: TickerRow[] = [];

  for (const brand of brandList) {
    const row = latestByBrand.get(brand.id);
    if (!row) continue;

    const native = normalizeCurrencyCode(row.currency || 'USD');
    const toUsd = (v: number) => toReportingCurrency(v, native, displayCurrency, fxRates);

    const revenueNative = netRevenueFromPnl(row);
    const metaNative = Number(row.meta_spend || 0);
    const googleNative = Number(row.google_spend || 0);
    const otherNative = Number(row.other_spend || 0);
    const spendNative = metaNative + googleNative + otherNative;

    const revenue = toUsd(revenueNative);
    const metaSpend = toUsd(metaNative);
    const googleSpend = toUsd(googleNative);
    const otherSpend = toUsd(otherNative);
    const spend = toUsd(spendNative);
    const roas = spend > 0 ? revenue / spend : 0;

    const channels: Array<'meta' | 'google'> = [];
    if (metaSpend > 0) channels.push('meta');
    if (googleSpend > 0) channels.push('google');
    // Still show brand if it has revenue/spend with only "other" or zeros for visibility
    if (channels.length === 0 && (spend > 0 || revenue > 0)) {
      // No paid-channel spend — skip channel ticker chips but keep brand summary
    }

    brandSummaries.push({
      brand_id: brand.id,
      brand_name: brandNameById.get(brand.id) || brand.name,
      spend,
      revenue,
      roas,
      meta_spend: metaSpend,
      google_spend: googleSpend,
      other_spend: otherSpend,
      channels: channels.length > 0 ? channels : [],
      as_of_date: row.date,
      native_currency: native,
    });

    // Channel ticker rows: split revenue by spend share so brandAgg sum == net revenue once.
    const paid = metaSpend + googleSpend;
    if (metaSpend > 0) {
      const share = paid > 0 ? metaSpend / paid : 1;
      const chRev = revenue * share;
      tickerRows.push({
        brand_id: brand.id,
        brand_name: brand.name,
        channel: 'meta',
        spend: metaSpend,
        revenue: chRev,
        roas: metaSpend > 0 ? chRev / metaSpend : 0,
        as_of_date: row.date,
        native_currency: native,
      });
    }
    if (googleSpend > 0) {
      const share = paid > 0 ? googleSpend / paid : 1;
      const chRev = revenue * share;
      tickerRows.push({
        brand_id: brand.id,
        brand_name: brand.name,
        channel: 'google',
        spend: googleSpend,
        revenue: chRev,
        roas: googleSpend > 0 ? chRev / googleSpend : 0,
        as_of_date: row.date,
        native_currency: native,
      });
    }
  }

  // Sort brands by spend desc (same as prior Dashboard UX)
  brandSummaries.sort((a, b) => b.spend - a.spend);
  tickerRows.sort((a, b) => b.spend - a.spend);

  const latestDate = brandSummaries.reduce<string | null>((max, b) => {
    if (!max || b.as_of_date > max) return b.as_of_date;
    return max;
  }, null);

  return NextResponse.json({
    rows: tickerRows,
    brands: brandSummaries,
    source: 'daily_pnl',
    display_currency: displayCurrency,
    lookback_days: lookbackDays,
    as_of_date: latestDate,
    as_of: new Date().toISOString(),
    brand_count_active: brandList.length,
    brand_count_with_data: brandSummaries.length,
  });
}
