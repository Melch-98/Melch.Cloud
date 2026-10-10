import { normalizeShopDomain } from '@/lib/shopify/config';
import { pnlIntegritySkipReason, type PnlBrand, type PnlIntegritySkipReason } from '@/lib/shopify/pnl-targets';
import { resolveShopIanaTimeZone } from '@/lib/shopify/shop-timezone';
import {
  isGrossMismatch,
  lastCompleteShopDays,
  pnlIntegrityBudgetRemains,
  PNL_INTEGRITY_DAYS,
  PNL_INTEGRITY_THRESHOLD,
  shopLocalDay,
  zonedMidnight,
  addCalendarDays,
} from '@/lib/shopify/shop-time';

type SupabaseLike = { from: (table: string) => any };

export const PNL_INTEGRITY_KEY = 'daily_pnl_integrity';

export type PnlIntegrityMismatch = {
  brand_id: string;
  brand_name: string;
  date: string;
  timezone: string;
  pnl_gross: number | null;
  orders_gross: number;
  delta_pct: number | null;
};

export type PnlIntegritySkip = {
  brand_id: string;
  brand_name: string;
  reason: PnlIntegritySkipReason | 'time_budget';
};

export type PnlIntegrityReport = {
  checked_at: string;
  window_days: number;
  threshold: number;
  brands_checked: number;
  brands_skipped: PnlIntegritySkip[];
  time_budget: boolean;
  mismatches: PnlIntegrityMismatch[];
};

type BrandRow = {
  id: string;
  name: string;
  shopify_store_domain: string | null;
  shopify_client_id: string | null;
  shopify_client_secret: string | null;
};

type StoreRow = {
  brand_id: string | null;
  shop_domain: string;
  access_token: string | null;
  uninstalled_at: string | null;
};

function liveAdminToken(store: StoreRow | undefined, domain: string | null): boolean {
  if (!domain || !store) return false;
  if (normalizeShopDomain(store.shop_domain) !== domain) return false;
  if (!store.access_token || store.uninstalled_at) return false;
  return store.access_token !== 'gadget-managed';
}

function asPnlBrand(brand: BrandRow, stores: StoreRow[]): PnlBrand {
  const domain = normalizeShopDomain(brand.shopify_store_domain);
  const store =
    stores.find((row) => domain && normalizeShopDomain(row.shop_domain) === domain) ||
    stores.find((row) => row.brand_id === brand.id);
  return {
    id: brand.id,
    name: brand.name,
    archived_at: null,
    shopify_store_domain: domain,
    hasClientCredentials: !!(brand.shopify_client_id && brand.shopify_client_secret && domain),
    hasLiveAdminToken: liveAdminToken(store, domain),
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function orderGross(subtotal: unknown, discounts: unknown): number {
  return (Number(subtotal) || 0) + (Number(discounts) || 0);
}

async function loadOrderGrossByDay(
  supabase: SupabaseLike,
  brandId: string,
  sinceIso: string,
  untilIso: string,
  timeZone: string
): Promise<Map<string, number>> {
  const totals = new Map<string, number>();
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await supabase
      .from('shopify_orders')
      .select('shopify_order_id, shopify_created_at, subtotal_price, total_discounts, financial_status')
      .eq('brand_id', brandId)
      .gte('shopify_created_at', sinceIso)
      .lt('shopify_created_at', untilIso)
      .order('shopify_order_id', { ascending: true })
      .range(from, from + page - 1);
    if (error) throw new Error(error.message);
    const rows = (data || []) as Array<{
      shopify_created_at?: string | null;
      subtotal_price?: string | number | null;
      total_discounts?: string | number | null;
      financial_status?: string | null;
    }>;
    for (const row of rows) {
      if (row.financial_status === 'voided' || !row.shopify_created_at) continue;
      const day = shopLocalDay(row.shopify_created_at, timeZone);
      totals.set(day, (totals.get(day) || 0) + orderGross(row.subtotal_price, row.total_discounts));
    }
    if (rows.length < page) break;
  }
  return totals;
}

/**
 * Compare daily_pnl.gross_sales to shopify_orders gross for the last 14 complete
 * shop-local days. Gross is subtotal + discounts, voided orders excluded — the
 * same basis as the Daily P&L order aggregation. Mismatches over 2% are logged
 * and stored on app_settings.daily_pnl_integrity for a later alert.
 *
 * Triple Whale-only brands are skipped: their orders are not Shopify Admin
 * gross. When deadlineMs is set, a brand is not started once that instant has
 * passed, and the partial report is still saved.
 */
export async function checkDailyPnlIntegrity(
  supabase: SupabaseLike,
  now: Date = new Date(),
  deadlineMs?: number
): Promise<PnlIntegrityReport> {
  const { data: brandRows, error: brandError } = await supabase
    .from('brands')
    .select('id, name, shopify_store_domain, shopify_client_id, shopify_client_secret')
    .is('archived_at', null);
  if (brandError) throw new Error(brandError.message);

  const { data: storeRows, error: storeError } = await supabase
    .from('shopify_stores')
    .select('brand_id, shop_domain, access_token, uninstalled_at');
  if (storeError) throw new Error(storeError.message);
  const stores = (storeRows || []) as StoreRow[];

  const mismatches: PnlIntegrityMismatch[] = [];
  const brandsSkipped: PnlIntegritySkip[] = [];
  let brandsChecked = 0;
  let timeBudget = false;

  for (const brand of (brandRows || []) as BrandRow[]) {
    const pnlBrand = asPnlBrand(brand, stores);
    const skipReason = pnlIntegritySkipReason(pnlBrand);
    if (skipReason) {
      brandsSkipped.push({ brand_id: brand.id, brand_name: brand.name, reason: skipReason });
      continue;
    }
    if (timeBudget || (deadlineMs !== undefined && !pnlIntegrityBudgetRemains(Date.now(), deadlineMs))) {
      timeBudget = true;
      brandsSkipped.push({ brand_id: brand.id, brand_name: brand.name, reason: 'time_budget' });
      continue;
    }
    brandsChecked += 1;
    const zone = await resolveShopIanaTimeZone(supabase, brand);
    const { start, end } = lastCompleteShopDays(now, zone.timeZone);
    const sinceIso = zonedMidnight(start, zone.timeZone).toISOString();
    const untilIso = zonedMidnight(addCalendarDays(end, 1), zone.timeZone).toISOString();

    const [ordersByDay, pnlResult] = await Promise.all([
      loadOrderGrossByDay(supabase, brand.id, sinceIso, untilIso, zone.timeZone),
      supabase
        .from('daily_pnl')
        .select('date, gross_sales')
        .eq('brand_id', brand.id)
        .gte('date', start)
        .lte('date', end),
    ]);
    if (pnlResult.error) throw new Error(pnlResult.error.message);

    const pnlByDay = new Map<string, number>();
    for (const row of (pnlResult.data || []) as Array<{ date?: string; gross_sales?: number | string | null }>) {
      if (!row.date) continue;
      pnlByDay.set(row.date.slice(0, 10), round2(Number(row.gross_sales) || 0));
    }

    const days = new Set<string>([...ordersByDay.keys(), ...pnlByDay.keys()]);
    for (const date of Array.from(days).sort()) {
      if (date < start || date > end) continue;
      const ordersGross = round2(ordersByDay.get(date) || 0);
      const pnlGross = pnlByDay.has(date) ? pnlByDay.get(date)! : null;
      if (!isGrossMismatch(pnlGross, ordersGross)) continue;
      const deltaPct =
        ordersGross === 0 || pnlGross == null
          ? null
          : Math.round((Math.abs(pnlGross - ordersGross) / Math.abs(ordersGross)) * 10000) / 10000;
      const mismatch: PnlIntegrityMismatch = {
        brand_id: brand.id,
        brand_name: brand.name,
        date,
        timezone: zone.timeZone,
        pnl_gross: pnlGross,
        orders_gross: ordersGross,
        delta_pct: deltaPct,
      };
      mismatches.push(mismatch);
      console.error(
        `daily_pnl integrity mismatch ${brand.name} ${date}: pnl ${pnlGross ?? 'missing'} vs orders ${ordersGross}` +
          (deltaPct == null ? '' : ` (${(deltaPct * 100).toFixed(1)}%)`)
      );
    }
  }

  const report: PnlIntegrityReport = {
    checked_at: now.toISOString(),
    window_days: PNL_INTEGRITY_DAYS,
    threshold: PNL_INTEGRITY_THRESHOLD,
    brands_checked: brandsChecked,
    brands_skipped: brandsSkipped,
    time_budget: timeBudget,
    mismatches,
  };

  const { error: saveError } = await supabase.from('app_settings').upsert(
    {
      key: PNL_INTEGRITY_KEY,
      value: JSON.stringify(report),
      updated_at: now.toISOString(),
    },
    { onConflict: 'key' }
  );
  if (saveError) console.error(`Failed to store daily_pnl integrity: ${saveError.message}`);
  else if (timeBudget) {
    console.log(
      `daily_pnl integrity stopped; under 20s remain before the cron limit (${brandsChecked} brands checked)`
    );
  } else if (mismatches.length === 0) {
    console.log(`daily_pnl integrity ok (${brandsChecked} brands, last ${PNL_INTEGRITY_DAYS} shop-local days)`);
  }

  return report;
}
