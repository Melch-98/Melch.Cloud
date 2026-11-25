import { shopDayRangeIso } from '@/lib/bfcm/calendar';
import { backfillBrandOrders, backfillCursorKey } from '@/lib/shopify/order-backfill';
import { rebuildDailyPnlFromStoredOrders } from '@/lib/shopify/rebuild-daily-pnl';
import { resolveOrderConnection } from '@/lib/shopify/order-connection';
import { resolveShopIanaTimeZone } from '@/lib/shopify/shop-timezone';
import {
  bfcmPnlPendingKey,
  bfcmPullStartedKey,
  lastYearBfcmBackfillAction,
  lastYearBfcmOrderRange,
  type BfcmBackfillReason,
} from '@/lib/shopify/bfcm-order-backfill';

type QueryError = { message: string } | null;
type QueryResult = { data: unknown; error: QueryError };

interface Query extends PromiseLike<QueryResult> {
  select: (columns: string) => Query;
  eq: (column: string, value: string) => Query;
  is: (column: string, value: null) => Query;
  gte: (column: string, value: string) => Query;
  lte: (column: string, value: string) => Query;
  limit: (count: number) => Query;
  maybeSingle: () => Promise<QueryResult>;
  delete: () => Query;
  upsert: (
    row: { key: string; value: string; updated_at: string },
    options: { onConflict: string }
  ) => Promise<QueryResult>;
}

type SupabaseLike = { from: (table: string) => Query };

const REBUILD_MIN_MS = 20_000;

export type BfcmBackfillBrandResult = {
  brand_id: string;
  name: string;
  action: 'skip' | 'pull' | 'rebuild_only' | 'deferred';
  reason: BfcmBackfillReason | 'time_budget';
  fetched: number;
  upserted: number;
  truncated: boolean;
  warning: string | null;
  rebuilt: boolean;
  error: string | null;
};

type BrandRow = {
  id: string;
  name: string;
  shopify_store_domain: string | null;
  shopify_client_id: string | null;
  shopify_client_secret: string | null;
};

async function readSetting(supabase: SupabaseLike, key: string): Promise<string | null> {
  const { data, error } = await supabase.from('app_settings').select('value').eq('key', key).maybeSingle();
  if (error) throw new Error(error.message);
  const row = data as { value?: unknown } | null;
  return typeof row?.value === 'string' && row.value ? row.value : null;
}

async function writeSetting(supabase: SupabaseLike, key: string, value: string | null): Promise<void> {
  if (!value) {
    const { error } = await supabase.from('app_settings').delete().eq('key', key);
    if (error) console.error(`Failed to clear BFCM backfill setting: ${error.message}`);
    return;
  }
  const { error } = await supabase.from('app_settings').upsert(
    { key, value, updated_at: new Date().toISOString() },
    { onConflict: 'key' }
  );
  if (error) throw new Error(error.message);
}

async function rangeHasOrders(
  supabase: SupabaseLike,
  brandId: string,
  startDate: string,
  endDate: string,
  timeZone: string
): Promise<boolean> {
  const range = shopDayRangeIso(startDate, endDate, timeZone);
  const { data, error } = await supabase
    .from('shopify_orders')
    .select('shopify_order_id')
    .eq('brand_id', brandId)
    .gte('shopify_created_at', range.min)
    .lte('shopify_created_at', range.max)
    .limit(1);
  if (error) throw new Error(error.message);
  return Array.isArray(data) && data.length > 0;
}

/**
 * One pass over active brands for last year's Nov 15–Dec 5.
 * Stops when the deadline hits. A truncated pull keeps its cursor and the
 * next cron continues. daily_pnl is rebuilt only after the pull finishes.
 */
export async function runLastYearBfcmBackfill(
  supabase: SupabaseLike,
  now: Date,
  deadlineMs: number
): Promise<{ range: { start: string; end: string }; brands: BfcmBackfillBrandResult[] }> {
  const range = lastYearBfcmOrderRange(now);
  const { data, error } = await supabase
    .from('brands')
    .select('id, name, shopify_store_domain, shopify_client_id, shopify_client_secret')
    .is('archived_at', null);
  if (error) throw new Error(error.message);

  const brands: BfcmBackfillBrandResult[] = [];
  let deferred = false;
  for (const brand of (data || []) as BrandRow[]) {
    if (deferred || Date.now() >= deadlineMs) {
      brands.push({
        brand_id: brand.id,
        name: brand.name,
        action: 'deferred',
        reason: 'time_budget',
        fetched: 0,
        upserted: 0,
        truncated: false,
        warning: null,
        rebuilt: false,
        error: null,
      });
      deferred = true;
      continue;
    }

    const result = await runBrand(supabase, brand, range, deadlineMs);
    brands.push(result);
    if (result.reason === 'time_budget') deferred = true;
  }

  console.log(`[bfcm-backfill] ${JSON.stringify({ range, brands })}`);
  return { range, brands };
}

async function runBrand(
  supabase: SupabaseLike,
  brand: BrandRow,
  range: { start: string; end: string },
  deadlineMs: number
): Promise<BfcmBackfillBrandResult> {
  const base: BfcmBackfillBrandResult = {
    brand_id: brand.id,
    name: brand.name,
    action: 'skip',
    reason: 'not_shopify_admin',
    fetched: 0,
    upserted: 0,
    truncated: false,
    warning: null,
    rebuilt: false,
    error: null,
  };

  let connection: Awaited<ReturnType<typeof resolveOrderConnection>>;
  try {
    connection = await resolveOrderConnection(supabase, brand);
  } catch (err) {
    base.error = err instanceof Error ? err.message : 'Shopify connection failed';
    return base;
  }

  if (connection.connection === 'shopify_admin' && !connection.token) {
    base.action = 'skip';
    base.reason = 'missing_read_all_orders';
    base.error = 'Shopify Admin token is not available for this brand';
    return base;
  }

  const cursorKey = backfillCursorKey(brand.id, range.start, range.end);
  const pendingKey = bfcmPnlPendingKey(brand.id, range.start, range.end);
  const startedKey = bfcmPullStartedKey(brand.id, range.start, range.end);
  let resumeCursor = false;
  let pullStarted = false;
  let pnlPending = false;
  try {
    resumeCursor = !!(await readSetting(supabase, cursorKey));
    pullStarted = !!(await readSetting(supabase, startedKey));
    pnlPending = !!(await readSetting(supabase, pendingKey));
  } catch (err) {
    base.error = err instanceof Error ? err.message : 'Backfill state failed';
    return base;
  }

  let ordersInRange = 0;
  const scopeEligible = lastYearBfcmBackfillAction({
    connection: connection.connection,
    tokenScopes: connection.tokenScope,
    ordersInRange: 0,
    resumeCursor,
    pullStarted,
    pnlPending,
  });
  if (scopeEligible.action === 'skip') {
    base.reason = scopeEligible.reason;
    return base;
  }

  if (!resumeCursor && !pullStarted && !pnlPending) {
    try {
      const zone = await resolveShopIanaTimeZone(supabase, brand, connection.token);
      const hasOrders = await rangeHasOrders(supabase, brand.id, range.start, range.end, zone.timeZone);
      ordersInRange = hasOrders ? 1 : 0;
    } catch (err) {
      base.error = err instanceof Error ? err.message : 'Order lookup failed';
      return base;
    }
  }

  const decision = lastYearBfcmBackfillAction({
    connection: connection.connection,
    tokenScopes: connection.tokenScope,
    ordersInRange,
    resumeCursor,
    pullStarted,
    pnlPending,
  });
  base.action = decision.action === 'skip' ? 'skip' : decision.action;
  base.reason = decision.reason;
  if (decision.action === 'skip') return base;

  if (decision.action === 'pull') {
    await writeSetting(supabase, startedKey, '1');
    let truncated = true;
    let guard = 0;
    while (truncated && guard < 40) {
      if (Date.now() >= deadlineMs) {
        base.action = 'deferred';
        base.reason = 'time_budget';
        base.truncated = true;
        base.warning = 'Time budget reached. The next cron continues this range.';
        return base;
      }
      const pulled = await backfillBrandOrders(supabase, {
        brandId: brand.id,
        startDate: range.start,
        endDate: range.end,
        deadlineMs,
      });
      base.fetched += pulled.fetched;
      base.upserted += pulled.upserted;
      base.truncated = pulled.truncated;
      base.warning = pulled.warning;
      base.error = pulled.error;
      truncated = pulled.truncated;
      guard += 1;
      if (pulled.warning?.includes('read_all_orders')) {
        console.warn(`[bfcm-backfill] ${brand.name}: ${pulled.warning}`);
        return base;
      }
      if (pulled.error && !pulled.truncated) return base;
      if (pulled.done && !pulled.truncated) break;
    }
    if (base.truncated || base.error) {
      if (base.truncated) {
        base.action = 'deferred';
        base.reason = 'time_budget';
      }
      return base;
    }
  }

  if (Date.now() + REBUILD_MIN_MS >= deadlineMs) {
    await writeSetting(supabase, pendingKey, '1');
    base.action = 'deferred';
    base.reason = 'time_budget';
    base.warning = 'Orders are stored. Daily P&L rebuild waits for the next cron.';
    return base;
  }

  try {
    await writeSetting(supabase, pendingKey, '1');
    await writeSetting(supabase, startedKey, null);
    await rebuildDailyPnlFromStoredOrders(supabase, {
      brandId: brand.id,
      startDate: range.start,
      endDate: range.end,
    });
    await writeSetting(supabase, pendingKey, null);
    base.rebuilt = true;
    return base;
  } catch (err) {
    try {
      await writeSetting(supabase, pendingKey, '1');
    } catch (writeErr) {
      console.error(`[bfcm-backfill] could not remember the P&L rebuild for ${brand.name}: ${writeErr instanceof Error ? writeErr.message : 'write failed'}`);
    }
    base.error = err instanceof Error ? err.message : 'Daily P&L rebuild failed';
    base.warning = 'Orders are stored. Daily P&L rebuild waits for the next cron.';
    return base;
  }
}
