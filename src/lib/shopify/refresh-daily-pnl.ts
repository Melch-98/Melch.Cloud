import { runShopifyBrandSync } from '@/lib/shopify/run-shopify-brand-sync';
import { runTripleWhaleBrandSync } from '@/lib/shopify/run-triplewhale-brand-sync';
import { normalizeShopDomain } from './config';
import { pnlPathForBrand, pnlRefreshWindow, type PnlBrand, type PnlRefreshWindow } from './pnl-targets';

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
 * Shopify-connected brands call runShopifyBrandSync. Domain-only brands call
 * runTripleWhaleBrandSync. One brand's failure does not stop the others.
 */
export async function refreshDailyPnl(
  supabase: SupabaseLike,
  now: Date = new Date()
): Promise<{ window: PnlRefreshWindow; brands: PnlRefreshResult[] }> {
  const window = pnlRefreshWindow(now);
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
  const results: PnlRefreshResult[] = [];

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
      if (!read.error) {
        console.log(`daily_pnl refreshed for ${brand.name} via ${path} (${window.startDate}..${window.endDate})`);
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
        window,
      });
    }
  }

  return { window, brands: results };
}
