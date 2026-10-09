import { runShopifyBrandSync } from '@/lib/shopify/run-shopify-brand-sync';
import { runTripleWhaleBrandSync } from '@/lib/shopify/run-triplewhale-brand-sync';
import { clearCatchUpCursor, loadCatchUpCursors, saveCatchUpCursor } from './catchup-cursor';
import { normalizeShopDomain } from './config';
import { pnlCatchUpWindow, pnlPathForBrand, type PnlBrand, type PnlRefreshWindow } from './pnl-targets';
import { resolveShopIanaTimeZone } from './shop-timezone';

const PNL_CURSOR_PREFIX = 'shopify_pnl_catchup:';
/** Stop starting brands after this so the order pull still fits in the 300s cron. */
export const PNL_BUDGET_MS = 200_000;

type SupabaseLike = { from: (table: string) => any };

type BrandRow = {
  id: string;
  name: string;
  archived_at: string | null;
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

export type PnlRefreshResult = {
  brand_id: string;
  name: string;
  path: 'shopify' | 'triple_whale' | 'skip';
  ok: boolean;
  skipped: boolean;
  status: number | null;
  error: string | null;
  deferred: boolean;
  window: PnlRefreshWindow;
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
    archived_at: brand.archived_at,
    shopify_store_domain: domain,
    hasClientCredentials: !!(brand.shopify_client_id && brand.shopify_client_secret && domain),
    hasLiveAdminToken: liveAdminToken(store, domain),
  };
}

async function newestPnlDate(supabase: SupabaseLike, brandId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('daily_pnl')
    .select('date')
    .eq('brand_id', brandId)
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const date = data?.date;
  return typeof date === 'string' ? date : null;
}

async function readJson(response: Response): Promise<{ status: number; error: string | null }> {
  let body: { error?: unknown; details?: unknown } = {};
  try {
    body = (await response.json()) as { error?: unknown; details?: unknown };
  } catch {
    body = {};
  }
  const error =
    response.ok
      ? null
      : [body.error, body.details].filter((part) => typeof part === 'string' && part).join(': ') ||
        `Sync failed (${response.status})`;
  return { status: response.status, error };
}

/**
 * Refreshes daily_pnl for every non-archived brand the manual sync routes can serve.
 * The window is the shop's IANA calendar. It starts at local midnight of the
 * earlier of (today minus 3) and (newest row minus 1), capped at 45 days, and
 * is sliced to 10 days so a long gap continues next run. UTC is the fallback
 * when the shop zone cannot be read.
 * Shopify-connected brands call runShopifyBrandSync. Domain-only brands call
 * runTripleWhaleBrandSync. One brand's failure does not stop the others.
 * Brands not started before deadlineMs are deferred, not failed.
 */
export async function refreshDailyPnl(
  supabase: SupabaseLike,
  now: Date = new Date(),
  deadlineMs?: number
): Promise<{ brands: PnlRefreshResult[] }> {
  const { data: brandRows, error: brandError } = await supabase
    .from('brands')
    .select('id, name, archived_at, shopify_store_domain, shopify_client_id, shopify_client_secret')
    .is('archived_at', null);
  if (brandError) throw new Error(brandError.message);

  const { data: storeRows, error: storeError } = await supabase
    .from('shopify_stores')
    .select('brand_id, shop_domain, access_token, uninstalled_at');
  if (storeError) throw new Error(storeError.message);

  const stores = (storeRows || []) as StoreRow[];
  const cursors = await loadCatchUpCursors(supabase, PNL_CURSOR_PREFIX);
  const results: PnlRefreshResult[] = [];
  const pending: Array<{ brand: PnlBrand; path: 'shopify' | 'triple_whale'; window: PnlRefreshWindow }> = [];

  for (const row of (brandRows || []) as BrandRow[]) {
    const brand = asPnlBrand({ ...row, archived_at: null }, stores);
    const path = pnlPathForBrand(brand);
    if (path === 'skip') {
      results.push({
        brand_id: brand.id,
        name: brand.name,
        path,
        ok: true,
        skipped: true,
        status: null,
        error: null,
        deferred: false,
        window: pnlCatchUpWindow(now, formatToday(now)),
      });
      continue;
    }
    const newest = await newestPnlDate(supabase, brand.id);
    const zone = await resolveShopIanaTimeZone(supabase, {
      id: brand.id,
      name: brand.name,
      shopify_store_domain: brand.shopify_store_domain,
      shopify_client_id: row.shopify_client_id,
      shopify_client_secret: row.shopify_client_secret,
    });
    pending.push({
      brand,
      path,
      window: pnlCatchUpWindow(now, newest, cursors.get(brand.id) ?? null, zone.timeZone),
    });
  }

  pending.sort((a, b) => a.window.startDate.localeCompare(b.window.startDate));

  for (const item of pending) {
    const { brand, path, window } = item;
    if (deadlineMs !== undefined && Date.now() >= deadlineMs) {
      console.log(`daily_pnl deferred for ${brand.name}; next run continues ${window.startDate}..${window.endDate}`);
      results.push({
        brand_id: brand.id,
        name: brand.name,
        path,
        ok: true,
        skipped: false,
        status: null,
        error: null,
        deferred: true,
        window,
      });
      continue;
    }

    try {
      const response =
        path === 'shopify'
          ? await runShopifyBrandSync(supabase, {
              brand_id: brand.id,
              since_date: window.sinceDate,
              until_date: window.untilDate,
            })
          : await runTripleWhaleBrandSync(supabase, {
              brandId: brand.id,
              startDate: window.startDate,
              endDate: window.endDate,
            });
      const read = await readJson(response);
      if (response.ok) {
        if (window.chunked) await saveCatchUpCursor(supabase, PNL_CURSOR_PREFIX, brand.id, window.endDate);
        else await clearCatchUpCursor(supabase, PNL_CURSOR_PREFIX, brand.id);
        console.log(
          `daily_pnl refreshed for ${brand.name} via ${path} (${window.startDate}..${window.endDate}${window.chunked ? ', more remains' : ''})`
        );
      } else {
        console.error(`daily_pnl refresh failed for ${brand.name} via ${path}: ${read.error}`);
      }
      results.push({
        brand_id: brand.id,
        name: brand.name,
        path,
        ok: response.ok,
        skipped: false,
        status: read.status,
        error: read.error,
        deferred: false,
        window,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Daily P&L refresh failed';
      console.error(`daily_pnl refresh failed for ${brand.name}: ${message}`);
      results.push({
        brand_id: brand.id,
        name: brand.name,
        path,
        ok: false,
        skipped: false,
        status: null,
        error: message,
        deferred: false,
        window,
      });
    }
  }

  return { brands: results };
}

function formatToday(now: Date): string {
  return now.toISOString().slice(0, 10);
}
