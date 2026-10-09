import { addCalendarDays, usableTimeZone, ymdInTimeZone, zonedMidnight } from './shop-time.ts';

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

function parseDay(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return match ? match[1] : null;
}

/** Last 3 shop-local calendar days plus today, so late edits and refunds settle. */
export function pnlRefreshWindow(now: Date, timeZone: string = 'UTC'): PnlRefreshWindow {
  return pnlCatchUpWindow(now, ymdInTimeZone(now, timeZone), null, timeZone);
}

/**
 * Per-brand Daily P&L window, in the shop's IANA timezone (UTC when unknown).
 * Starts at local midnight of the earlier of (today minus 3) and (newest
 * daily_pnl date minus 1), and never earlier than today minus 45. A resume
 * date, saved when a previous run stopped mid-catch-up, continues from there
 * instead of repeating the oldest days. At most PNL_CHUNK_DAYS are included;
 * the rest waits for the next run. No stored rows backfills from the 45-day cap.
 * sinceDate is that local midnight. A chunked untilDate is the last millisecond
 * of endDate in the shop zone, so the end day is complete. An open window runs
 * through now; the in-progress local day is not a full day.
 */
export function pnlCatchUpWindow(
  now: Date,
  newestDate: string | null,
  resumeDate?: string | null,
  timeZone: string = 'UTC'
): PnlRefreshWindow {
  const zone = usableTimeZone(timeZone);
  const today = ymdInTimeZone(now, zone);
  const recentStart = addCalendarDays(today, -PNL_RECENT_DAYS);
  const capStart = addCalendarDays(today, -PNL_CAP_DAYS);
  const newest = parseDay(newestDate);

  let start = recentStart;
  if (newest) {
    const fromNewest = addCalendarDays(newest, -1);
    if (fromNewest < recentStart) start = fromNewest;
  } else if (newestDate === null) {
    start = capStart;
  }
  if (start < capStart) start = capStart;

  const resume = parseDay(resumeDate);
  if (resume && resume > start && resume <= today) start = resume;

  const chunkEnd = addCalendarDays(start, PNL_CHUNK_DAYS - 1);
  const end = chunkEnd < today ? chunkEnd : today;
  const chunked = end < today;
  const since = zonedMidnight(start, zone);
  const until = chunked ? new Date(zonedMidnight(addCalendarDays(end, 1), zone).getTime() - 1) : now;
  return {
    startDate: start,
    endDate: end,
    sinceDate: since.toISOString(),
    untilDate: until.toISOString(),
    chunked,
  };
}
