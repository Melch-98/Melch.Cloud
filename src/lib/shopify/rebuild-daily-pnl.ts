import { acquireSyncLock, invalidatePnlCache, releaseSyncLock } from '@/lib/redis';
import { getFxRates } from '@/lib/currency';
import { fetchDailyAdSpend } from '@/lib/shopify/fetch-ad-spend';
import { buildFullCoveredDayRows, coveredDaysWithinStoredHistory } from '@/lib/shopify/pnl-covered-days';
import { aggregateOrdersByDay, type PnlShopifyOrder } from '@/lib/shopify/pnl-days';
import { resolveShopIanaTimeZone } from '@/lib/shopify/shop-timezone';
import {
  addCalendarDays,
  fullyCoveredShopDays,
  isShopDayFullyCovered,
  shopLocalDay,
  ymdInTimeZone,
  zonedMidnight,
} from '@/lib/shopify/shop-time';
import { upsertDailyPnl } from '@/lib/shopify/upsert-daily-pnl';
import { exchangeClientCredentials } from '@/lib/shopify/client-credentials';
import { normalizeShopDomain } from '@/lib/shopify/config';
import {
  convertSpendMap,
  enrichCustomerOrderCounts,
  fetchGoogleAccountCurrency,
  fetchMetaAccountCurrency,
  resolveBrandReportingCurrency,
} from '@/lib/shopify/run-shopify-brand-sync';

type SupabaseLike = { from: (table: string) => any };

export type RebuildDailyPnlInput = {
  brandId: string;
  startDate: string;
  endDate: string;
  now?: Date;
};

export type RebuildDailyPnlResult = {
  brand_id: string;
  brand_name: string;
  timezone: string;
  timezone_source: string;
  start_date: string;
  end_date: string;
  orders_read: number;
  days_written: number;
  partial_days_skipped: string[];
  history_days_skipped: string[];
  meta_spend_days: number;
  google_spend_days: number;
  ad_spend_errors: string[];
};

type BrandRow = {
  id: string;
  name: string;
  shopify_store_domain: string | null;
  shopify_client_id: string | null;
  shopify_client_secret: string | null;
  meta_ad_account_id: string | null;
  google_ads_customer_id: string | null;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

async function adminToken(supabase: SupabaseLike, brand: BrandRow): Promise<string | null> {
  const domain = normalizeShopDomain(brand.shopify_store_domain);
  if (!domain) return null;
  const { data: storeRow } = await supabase
    .from('shopify_stores')
    .select('access_token, uninstalled_at')
    .eq('shop_domain', domain)
    .maybeSingle();
  if (
    storeRow?.access_token &&
    storeRow.access_token !== 'gadget-managed' &&
    !storeRow.uninstalled_at
  ) {
    return storeRow.access_token as string;
  }
  if (!brand.shopify_client_id || !brand.shopify_client_secret) return null;
  const exchanged = await exchangeClientCredentials(domain, brand.shopify_client_id, brand.shopify_client_secret);
  return exchanged.accessToken;
}

function storedOrder(row: Record<string, unknown>): PnlShopifyOrder | null {
  const raw = row.raw;
  if (raw && typeof raw === 'object' && typeof (raw as { created_at?: unknown }).created_at === 'string') {
    return raw as PnlShopifyOrder;
  }
  const createdAt = row.shopify_created_at;
  const id = Number(row.shopify_order_id);
  if (typeof createdAt !== 'string' || !Number.isFinite(id)) return null;
  const customerId = row.customer_id == null ? null : Number(row.customer_id);
  return {
    id,
    created_at: createdAt,
    financial_status: typeof row.financial_status === 'string' ? row.financial_status : 'paid',
    subtotal_price: String(row.subtotal_price ?? 0),
    total_discounts: String(row.total_discounts ?? 0),
    total_tax: String(row.total_tax ?? 0),
    shipping_lines: [],
    refunds: [],
    customer: customerId && Number.isFinite(customerId) ? { id: customerId, orders_count: 0 } : null,
  };
}

async function loadStoredOrders(
  supabase: SupabaseLike,
  brandId: string,
  sinceIso: string,
  untilIso: string
): Promise<PnlShopifyOrder[]> {
  const orders: PnlShopifyOrder[] = [];
  const page = 200;
  for (let from = 0; ; from += page) {
    const { data, error } = await supabase
      .from('shopify_orders')
      .select(
        'shopify_order_id, shopify_created_at, subtotal_price, total_discounts, total_tax, financial_status, customer_id, raw'
      )
      .eq('brand_id', brandId)
      .gte('shopify_created_at', sinceIso)
      .lt('shopify_created_at', untilIso)
      .order('shopify_order_id', { ascending: true })
      .range(from, from + page - 1);
    if (error) throw new Error(error.message);
    const rows = (data || []) as Array<Record<string, unknown>>;
    for (const row of rows) {
      const order = storedOrder(row);
      if (order) orders.push(order);
    }
    if (rows.length < page) break;
  }
  return orders;
}

/** Shop-local day of the brand's earliest stored order, or null when none exist. */
async function earliestStoredOrderDay(
  supabase: SupabaseLike,
  brandId: string,
  timeZone: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from('shopify_orders')
    .select('shopify_created_at')
    .eq('brand_id', brandId)
    .not('shopify_created_at', 'is', null)
    .order('shopify_created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const createdAt = (data as { shopify_created_at?: string | null } | null)?.shopify_created_at;
  if (!createdAt) return null;
  return shopLocalDay(createdAt, timeZone);
}

/**
 * Rebuild daily_pnl for one brand from shopify_orders already stored, plus the
 * same Meta and Google spend fetch the live sync uses. Does not pull orders
 * from Shopify again. NC/RC still goes through aggregateOrdersByDay, including
 * the lifetime-count enrichment when an Admin token is available.
 * The in-progress shop-local day is not written. Days before the brand's
 * earliest stored shopify_orders.shopify_created_at are not zero-filled.
 */
export async function rebuildDailyPnlFromStoredOrders(
  supabase: SupabaseLike,
  input: RebuildDailyPnlInput
): Promise<RebuildDailyPnlResult> {
  const startDate = input.startDate;
  const requestedEnd = input.endDate;
  if (!DATE.test(startDate) || !DATE.test(requestedEnd) || requestedEnd < startDate) {
    throw new Error('start_date and end_date must be YYYY-MM-DD, with end_date on or after start_date');
  }

  const { data: brand, error: brandError } = await supabase
    .from('brands')
    .select(
      'id, name, shopify_store_domain, shopify_client_id, shopify_client_secret, meta_ad_account_id, google_ads_customer_id'
    )
    .eq('id', input.brandId)
    .single();
  if (brandError || !brand) throw new Error('Brand not found');
  const row = brand as BrandRow;
  if (!row.shopify_store_domain) throw new Error('Brand has no shopify_store_domain');

  const gotLock = await acquireSyncLock(row.id, 360);
  if (!gotLock) throw new Error('A sync is already running for this brand. Wait for it to finish.');

  try {
    const now = input.now ?? new Date();
    const token = await adminToken(supabase, row).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : 'Shopify token exchange failed';
      console.warn(`Rebuild token failed for ${row.name}: ${message}`);
      return null;
    });
    const zone = await resolveShopIanaTimeZone(supabase, row, token);
    const timeZone = zone.timeZone;
    const today = ymdInTimeZone(now, timeZone);
    const endDate = requestedEnd < today ? requestedEnd : today;
    const sinceIso = zonedMidnight(startDate, timeZone).toISOString();
    const queryUntil = zonedMidnight(addCalendarDays(endDate, 1), timeZone).toISOString();
    const untilIso = endDate === today ? now.toISOString() : new Date(Date.parse(queryUntil) - 1).toISOString();

    const orders = await loadStoredOrders(supabase, row.id, sinceIso, queryUntil);
    const earliestDay = await earliestStoredOrderDay(supabase, row.id, timeZone);
    const domain = normalizeShopDomain(row.shopify_store_domain);
    if (token && domain) {
      try {
        await enrichCustomerOrderCounts(domain, token, orders);
      } catch (err) {
        console.error('Customer enrichment failed (non-fatal):', err);
      }
    }

    const dayBuckets = aggregateOrdersByDay(orders, timeZone);
    const spend = await fetchDailyAdSpend(supabase, row, startDate, endDate);
    const metaToken = process.env.META_ACCESS_TOKEN || '';
    let pipeboardToken = process.env.PIPEBOARD_API_TOKEN || '';
    if (!pipeboardToken) {
      const { data: settings } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', 'pipeboard_api_token')
        .single();
      pipeboardToken = settings?.value || '';
    }
    const [metaCurrency, googleCurrency, fxRates] = await Promise.all([
      fetchMetaAccountCurrency(row.meta_ad_account_id, metaToken),
      fetchGoogleAccountCurrency(row.google_ads_customer_id, pipeboardToken),
      getFxRates(),
    ]);
    const reporting = await resolveBrandReportingCurrency(
      supabase,
      row,
      orders.map((order) => (order as PnlShopifyOrder & { currency?: string }).currency),
      metaCurrency,
      googleCurrency
    );
    const dailyMeta = convertSpendMap(spend.meta, metaCurrency || reporting.code, reporting.code, fxRates);
    const dailyGoogle = convertSpendMap(spend.google, googleCurrency || reporting.code, reporting.code, fxRates);

    const history = coveredDaysWithinStoredHistory(
      fullyCoveredShopDays(sinceIso, untilIso, timeZone),
      earliestDay
    );
    const allRows = buildFullCoveredDayRows({
      brandId: row.id,
      currency: reporting.code,
      syncedAt: now.toISOString(),
      coveredDays: history.write,
      buckets: dayBuckets,
      meta: { ok: spend.metaOk, byDay: dailyMeta },
      google: { ok: spend.googleOk, byDay: dailyGoogle },
    });
    if (allRows.length > 0) {
      const { error } = await upsertDailyPnl(supabase, allRows);
      if (error) throw new Error(error.message || 'Failed to save daily_pnl');
    }
    await invalidatePnlCache(row.id);

    const partialDaysSkipped = [];
    if (requestedEnd >= today && !isShopDayFullyCovered(today, sinceIso, untilIso, timeZone)) {
      partialDaysSkipped.push(today);
    }

    return {
      brand_id: row.id,
      brand_name: row.name,
      timezone: timeZone,
      timezone_source: zone.source,
      start_date: startDate,
      end_date: requestedEnd,
      orders_read: orders.length,
      days_written: allRows.length,
      partial_days_skipped: partialDaysSkipped,
      history_days_skipped: history.skipped,
      meta_spend_days: allRows.filter((entry) => entry.meta_spend != null).length,
      google_spend_days: allRows.filter((entry) => entry.google_spend != null).length,
      ad_spend_errors: spend.errors,
    };
  } finally {
    await releaseSyncLock(row.id);
  }
}
