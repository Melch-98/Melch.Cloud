export type PnlPath = 'shopify' | 'triple_whale' | 'skip';

export type PnlBrand = {
  id: string;
  name: string;
  archived_at: string | null;
  shopify_store_domain: string | null;
  hasClientCredentials: boolean;
  hasLiveAdminToken: boolean;
};

/**
 * Which Daily P&L route can refresh this brand.
 * Shopify Admin credentials use /api/shopify-sync. A shop domain with neither
 * a custom app nor a live install token is Organic Jaguar's Triple Whale path.
 */
export function pnlPathForBrand(brand: PnlBrand): PnlPath {
  if (brand.archived_at) return 'skip';
  const domain = brand.shopify_store_domain?.trim() || null;
  if (!domain) return 'skip';
  if (brand.hasClientCredentials || brand.hasLiveAdminToken) return 'shopify';
  return 'triple_whale';
}

export function selectPnlRefreshBrands(brands: PnlBrand[]): {
  shopify: PnlBrand[];
  tripleWhale: PnlBrand[];
  skipped: PnlBrand[];
} {
  const shopify: PnlBrand[] = [];
  const tripleWhale: PnlBrand[] = [];
  const skipped: PnlBrand[] = [];
  for (const brand of brands) {
    const path = pnlPathForBrand(brand);
    if (path === 'shopify') shopify.push(brand);
    else if (path === 'triple_whale') tripleWhale.push(brand);
    else skipped.push(brand);
  }
  return { shopify, tripleWhale, skipped };
}

export type PnlRefreshWindow = {
  startDate: string;
  endDate: string;
  sinceDate: string;
  untilDate: string;
};

/** Last 3 UTC calendar days plus today, so late edits and refunds settle. */
export function pnlRefreshWindow(now: Date): PnlRefreshWindow {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 3);
  const startDate = start.toISOString().slice(0, 10);
  const endDate = end.toISOString().slice(0, 10);
  return {
    startDate,
    endDate,
    sinceDate: `${startDate}T00:00:00.000Z`,
    untilDate: now.toISOString(),
  };
}
