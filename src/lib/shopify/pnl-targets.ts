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
  /** This run stops before today. The next run continues at endDate. */
  chunked: boolean;
};

/** Late edits and refunds are always inside this many days, including today. */
export const PNL_RECENT_DAYS = 3;
/** One run will not look further back than this. */
export const PNL_CAP_DAYS = 45;
/**
 * Oldest-first slice for one run. The live gap (Organic Jaguar 09-21 through
 * 09-28) fits in one slice. A longer outage continues on the next run.
 */
export const PNL_CHUNK_DAYS = 10;

function utcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function addUtcDays(day: Date, days: number): Date {
  const next = new Date(day);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function formatUtcDay(day: Date): string {
  return day.toISOString().slice(0, 10);
}

function parseUtcDay(value: string | null | undefined): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  const parsed = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Last 3 UTC calendar days plus today, so late edits and refunds settle. */
export function pnlRefreshWindow(now: Date): PnlRefreshWindow {
  return pnlCatchUpWindow(now, formatUtcDay(utcDay(now)));
}

/**
 * Per-brand Daily P&L window.
 * Starts at the earlier of (today minus 3) and (newest daily_pnl date minus 1),
 * and never earlier than today minus 45. A resume date, saved when a previous
 * run stopped mid-catch-up, continues from there instead of repeating the
 * oldest days. At most PNL_CHUNK_DAYS are included; the rest waits for the
 * next run. No stored rows backfills from the 45-day cap.
 */
export function pnlCatchUpWindow(
  now: Date,
  newestDate: string | null,
  resumeDate?: string | null
): PnlRefreshWindow {
  const today = utcDay(now);
  const recentStart = addUtcDays(today, -PNL_RECENT_DAYS);
  const capStart = addUtcDays(today, -PNL_CAP_DAYS);
  const newest = parseUtcDay(newestDate);

  let start = recentStart;
  if (newest) {
    const fromNewest = addUtcDays(newest, -1);
    if (fromNewest < recentStart) start = fromNewest;
  } else if (newestDate === null) {
    start = capStart;
  }
  if (start < capStart) start = capStart;

  const resume = parseUtcDay(resumeDate);
  if (resume && resume > start && resume <= today) start = resume;

  const chunkEnd = addUtcDays(start, PNL_CHUNK_DAYS - 1);
  const end = chunkEnd < today ? chunkEnd : today;
  const chunked = end < today;
  const startDate = formatUtcDay(start);
  const endDate = formatUtcDay(end);
  return {
    startDate,
    endDate,
    sinceDate: `${startDate}T00:00:00.000Z`,
    untilDate: chunked ? `${endDate}T23:59:59.999Z` : now.toISOString(),
    chunked,
  };
}
