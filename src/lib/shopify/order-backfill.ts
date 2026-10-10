import { shopDayRangeIso } from '@/lib/bfcm/calendar';
import { resolveShopIanaTimeZone } from '@/lib/shopify/shop-timezone';
import { nextOrdersPage, type OrdersPageResult } from '@/lib/shopify/orders-pages';
import { upsertShopifyOrders } from '@/lib/shopify/order-sync';
import { fetchTripleWhaleOrders, tripleWhaleOrderRows } from '@/lib/shopify/triple-whale-orders';
import { resolveOrderConnection, type OrderBrand } from '@/lib/shopify/order-connection';

type SupabaseLike = { from: (table: string) => any };

const ORDERS_API_VERSION = '2024-01';
const PAGE_CAP = 80;
const UPSERT_CHUNK = 200;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const BACKFILL_MAX_DAYS = 90;
/** Custom apps without read_all_orders only see orders from the last 60 days. */
export const SHOPIFY_ORDER_READ_WINDOW_DAYS = 60;

const READ_ALL_ORDERS_WARNING =
  'Shopify returned 0 orders. start_date is older than 60 days, and a custom app without the read_all_orders scope only returns the last 60 days. This empty result is not a completed backfill.';

export type OrderBackfillInput = {
  brandId: string;
  startDate: string;
  endDate: string;
  deadlineMs: number;
};

export type OrderBackfillResult = {
  brand_id: string;
  brand_name: string;
  shop_domain: string | null;
  source: 'shopify_admin' | 'triple_whale' | null;
  start_date: string;
  end_date: string;
  time_zone: string;
  fetched: number;
  upserted: number;
  truncated: boolean;
  done: boolean;
  warning: string | null;
  error: string | null;
};

type BrandRow = OrderBrand & { name: string };

export function backfillCursorKey(brandId: string, startDate: string, endDate: string): string {
  return `shopify_order_backfill:${brandId}:${startDate}:${endDate}`;
}

export function assertBackfillRange(startDate: string, endDate: string): void {
  if (!DATE.test(startDate) || !DATE.test(endDate) || endDate < startDate) {
    throw new Error('start_date and end_date must be YYYY-MM-DD, with end_date on or after start_date');
  }
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  const days = Math.round((end - start) / 86_400_000) + 1;
  if (days > BACKFILL_MAX_DAYS) {
    throw new Error(`Date range is ${days} days. Backfill at most ${BACKFILL_MAX_DAYS} days per call.`);
  }
}

/**
 * Shopify answers an older created_at_min with an empty page when the app
 * lacks read_all_orders. That is not an empty store.
 */
export function readAllOrdersWarning(startDate: string, fetched: number, now = new Date()): string | null {
  if (fetched !== 0 || !DATE.test(startDate)) return null;
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const cutoff = todayUtc - SHOPIFY_ORDER_READ_WINDOW_DAYS * 86_400_000;
  if (!(start < cutoff)) return null;
  return READ_ALL_ORDERS_WARNING;
}

export function backfillResponseStatus(result: Pick<
  OrderBackfillResult,
  'error' | 'warning' | 'fetched' | 'upserted' | 'truncated'
>): { ok: boolean; status: number } {
  if (result.error && result.upserted === 0 && !result.truncated) {
    const status = result.error.includes('YYYY-MM-DD') || result.error.includes('No Shopify') ? 400 : 502;
    return { ok: false, status };
  }
  if (
    result.fetched === 0 &&
    result.upserted === 0 &&
    !result.truncated &&
    (result.warning?.includes('read_all_orders') ?? false)
  ) {
    return { ok: false, status: 422 };
  }
  return { ok: !result.error, status: 200 };
}

/** Only follow a Shopify orders paging URL for this shop, and never keep an access token. */
export function safeShopifyNextUrl(url: string, domain: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.hostname !== domain) return null;
    if (!parsed.pathname.includes('/orders.json')) return null;
    parsed.searchParams.delete('access_token');
    return parsed.toString();
  } catch {
    return null;
  }
}

async function readCursor(supabase: SupabaseLike, key: string): Promise<string | null> {
  const { data, error } = await supabase.from('app_settings').select('value').eq('key', key).maybeSingle();
  if (error) throw new Error(error.message);
  return typeof data?.value === 'string' && data.value ? data.value : null;
}

async function writeCursor(supabase: SupabaseLike, key: string, value: string | null): Promise<void> {
  if (!value) {
    const { error } = await supabase.from('app_settings').delete().eq('key', key);
    if (error) console.error(`Failed to clear order backfill cursor: ${error.message}`);
    return;
  }
  const { error } = await supabase.from('app_settings').upsert(
    { key, value, updated_at: new Date().toISOString() },
    { onConflict: 'key' }
  );
  if (error) throw new Error(error.message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Pull one brand's orders for a shop-local date range and upsert them.
 * Paged and resumable: a time budget or page cap stores the next Shopify URL
 * (no access token) and the same call continues. Does not rebuild daily_pnl.
 */
export async function backfillBrandOrders(
  supabase: SupabaseLike,
  input: OrderBackfillInput
): Promise<OrderBackfillResult> {
  assertBackfillRange(input.startDate, input.endDate);
  const { data: brand, error } = await supabase
    .from('brands')
    .select('id, name, shopify_store_domain, shopify_client_id, shopify_client_secret')
    .eq('id', input.brandId)
    .single();
  if (error || !brand) throw new Error('Brand not found');

  const row = brand as BrandRow;
  const connection = await resolveOrderConnection(supabase, row);
  const zone = await resolveShopIanaTimeZone(supabase, {
    id: row.id,
    shopify_store_domain: row.shopify_store_domain,
    shopify_client_id: row.shopify_client_id,
    shopify_client_secret: row.shopify_client_secret,
  }, connection.token);
  const range = shopDayRangeIso(input.startDate, input.endDate, zone.timeZone);
  const base: OrderBackfillResult = {
    brand_id: row.id,
    brand_name: row.name,
    shop_domain: connection.domain,
    source: connection.connection === 'none' ? null : connection.connection,
    start_date: input.startDate,
    end_date: input.endDate,
    time_zone: zone.timeZone,
    fetched: 0,
    upserted: 0,
    truncated: false,
    done: false,
    warning: null,
    error: null,
  };

  if (connection.connection === 'none' || !connection.domain) {
    base.error = 'No Shopify shop for this brand';
    return base;
  }

  if (connection.connection === 'triple_whale') {
    return backfillTripleWhale(supabase, base, connection.domain, input);
  }

  if (!connection.token) {
    base.error = 'Shopify Admin token is not available for this brand';
    return base;
  }

  return backfillAdmin(supabase, base, connection.domain, connection.token, range, input.deadlineMs);
}

async function backfillTripleWhale(
  supabase: SupabaseLike,
  base: OrderBackfillResult,
  domain: string,
  input: OrderBackfillInput
): Promise<OrderBackfillResult> {
  const apiKey = process.env.TRIPLEWHALE_API_KEY;
  if (!apiKey) {
    base.error = 'TRIPLEWHALE_API_KEY is not configured';
    return base;
  }
  if (Date.now() >= input.deadlineMs) {
    base.truncated = true;
    base.warning = 'Time budget was already spent. Call again to continue.';
    return base;
  }
  try {
    const orders = await fetchTripleWhaleOrders(apiKey, domain, input.startDate, input.endDate);
    const rows = tripleWhaleOrderRows(domain, base.brand_id, orders);
    base.fetched = rows.length;
    for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
      const chunk = rows.slice(i, i + UPSERT_CHUNK);
      const { error } = await supabase
        .from('shopify_orders')
        .upsert(chunk, { onConflict: 'shop_domain,shopify_order_id' });
      if (error) throw new Error(error.message);
      base.upserted += chunk.length;
    }
    base.done = true;
    base.warning = 'Triple Whale returns the whole range in one query. Call again only if this request failed.';
    return base;
  } catch (err) {
    base.error = err instanceof Error ? err.message : 'Triple Whale backfill failed';
    return base;
  }
}

async function backfillAdmin(
  supabase: SupabaseLike,
  base: OrderBackfillResult,
  domain: string,
  token: string,
  range: { min: string; max: string },
  deadlineMs: number
): Promise<OrderBackfillResult> {
  const key = backfillCursorKey(base.brand_id, base.start_date, base.end_date);
  const saved = await readCursor(supabase, key);
  const initial =
    `https://${domain}/admin/api/${ORDERS_API_VERSION}/orders.json?` +
    new URLSearchParams({
      status: 'any',
      limit: '250',
      order: 'created_at asc',
      created_at_min: range.min,
      created_at_max: range.max,
    }).toString();
  let url = saved ? safeShopifyNextUrl(saved, domain) : initial;
  if (saved && !url) {
    base.warning = 'Stored resume URL was not for this shop. Starting the range again.';
    url = initial;
  }

  const fetchPage = async (pageUrl: string): Promise<OrdersPageResult> => {
    const res = await fetch(pageUrl, {
      headers: {
        'X-Shopify-Access-Token': token,
        'Content-Type': 'application/json',
      },
    });
    return {
      ok: res.ok,
      status: res.status,
      retryAfter: res.headers.get('Retry-After'),
      link: res.headers.get('Link'),
      body: res.ok ? await res.json() : null,
    };
  };

  try {
    let pages = 0;
    while (url && pages < PAGE_CAP) {
      if (Date.now() >= deadlineMs) {
        await writeCursor(supabase, key, url);
        base.truncated = true;
        base.warning = 'Time budget reached. Call the same endpoint again to continue.';
        return base;
      }
      const page = await nextOrdersPage(url, fetchPage, sleep);
      const orders = page.orders as Record<string, unknown>[];
      base.fetched += orders.length;
      base.upserted += await upsertShopifyOrders(supabase, domain, base.brand_id, orders);
      pages += 1;
      url = page.nextUrl ? safeShopifyNextUrl(page.nextUrl, domain) : null;
    }
    if (url) {
      await writeCursor(supabase, key, url);
      base.truncated = true;
      base.warning = `Stopped after ${PAGE_CAP} pages. Call the same endpoint again to continue.`;
      return base;
    }
    await writeCursor(supabase, key, null);
    const gap = readAllOrdersWarning(base.start_date, base.fetched);
    if (gap) {
      base.done = false;
      base.warning = base.warning ? `${base.warning} ${gap}` : gap;
      return base;
    }
    base.done = true;
    return base;
  } catch (err) {
    base.error = err instanceof Error ? err.message : 'Shopify backfill failed';
    base.warning = 'Nothing new was marked complete. Call the same endpoint again to retry this page.';
    return base;
  }
}
