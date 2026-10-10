/** Shop-local calendar helpers. Daily P&L days follow the shop's IANA zone. */

export function isValidIanaTimeZone(timeZone: string): boolean {
  try {
    Intl.DateTimeFormat('en-US', { timeZone }).format(0);
    return true;
  } catch {
    return false;
  }
}

export function usableTimeZone(timeZone: string | null | undefined): string {
  if (timeZone && isValidIanaTimeZone(timeZone)) return timeZone;
  return 'UTC';
}

/** Calendar date in an IANA zone, YYYY-MM-DD. */
export function ymdInTimeZone(date: Date, timeZone: string): string {
  const zone = usableTimeZone(timeZone);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function addCalendarDays(ymd: string, delta: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!match) throw new Error(`Invalid shop date: ${ymd}`);
  const dt = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

function timeZoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '0';
  let hour = Number(get('hour'));
  if (hour === 24) hour = 0;
  const asUtc = Date.UTC(
    Number(get('year')),
    Number(get('month')) - 1,
    Number(get('day')),
    hour,
    Number(get('minute')),
    Number(get('second'))
  );
  return asUtc - instant.getTime();
}

/** UTC instant of a wall-clock time in an IANA zone. */
export function zonedDateTime(ymd: string, hour: number, minute: number, timeZone: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!match) throw new Error(`Invalid shop date: ${ymd}`);
  const zone = usableTimeZone(timeZone);
  const utcGuess = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    hour,
    minute,
    0
  );
  const offset = timeZoneOffsetMs(new Date(utcGuess), zone);
  let utc = utcGuess - offset;
  const offsetAtInstant = timeZoneOffsetMs(new Date(utc), zone);
  if (offsetAtInstant !== offset) utc = utcGuess - offsetAtInstant;
  return new Date(utc);
}

/** UTC instant of YYYY-MM-DD 00:00:00.000 in an IANA zone. */
export function zonedMidnight(ymd: string, timeZone: string): Date {
  return zonedDateTime(ymd, 0, 0, timeZone);
}

/** Shop-local calendar date for an order or refund timestamp. */
export function shopLocalDay(iso: string, timeZone: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso.split('T')[0] || '';
  return ymdInTimeZone(parsed, timeZone);
}

/**
 * A shop-local day is fully covered when the fetch includes that local midnight
 * and the last millisecond of that local day. The in-progress day is not.
 */
export function isShopDayFullyCovered(
  day: string,
  sinceIso: string,
  untilIso: string,
  timeZone: string
): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const since = Date.parse(sinceIso);
  const until = Date.parse(untilIso);
  if (!Number.isFinite(since) || !Number.isFinite(until)) return false;
  const zone = usableTimeZone(timeZone);
  const start = zonedMidnight(day, zone).getTime();
  const nextMidnight = zonedMidnight(addCalendarDays(day, 1), zone).getTime();
  return since <= start && until >= nextMidnight - 1;
}

/** Last complete shop-local days. Today is still open, so the window ends yesterday. */
export const PNL_INTEGRITY_DAYS = 14;
export const PNL_INTEGRITY_THRESHOLD = 0.02;

export function lastCompleteShopDays(
  now: Date,
  timeZone: string,
  days: number = PNL_INTEGRITY_DAYS
): { start: string; end: string } {
  const today = ymdInTimeZone(now, timeZone);
  const end = addCalendarDays(today, -1);
  const start = addCalendarDays(end, -(days - 1));
  return { start, end };
}

/**
 * True when stored gross and order gross differ by more than the threshold.
 * A missing P&L row counts only when the orders have gross. Equal zeros do not.
 * `>` so a difference of exactly 2% is not a mismatch.
 */
export function isGrossMismatch(
  pnlGross: number | null,
  ordersGross: number,
  threshold: number = PNL_INTEGRITY_THRESHOLD
): boolean {
  if (pnlGross == null) return ordersGross !== 0;
  if (ordersGross === 0) return pnlGross !== 0;
  return Math.abs(pnlGross - ordersGross) / Math.abs(ordersGross) > threshold;
}

export function coveredShopDays(
  days: Iterable<string>,
  sinceIso: string,
  untilIso: string,
  timeZone: string
): string[] {
  return Array.from(days)
    .filter((day) => isShopDayFullyCovered(day, sinceIso, untilIso, timeZone))
    .sort();
}

/**
 * Every shop-local day the window covers completely, including days with no
 * orders. A since instant after local midnight drops that first day. An until
 * instant before the next local midnight drops the in-progress day.
 */
export function fullyCoveredShopDays(sinceIso: string, untilIso: string, timeZone: string): string[] {
  const since = Date.parse(sinceIso);
  const until = Date.parse(untilIso);
  if (!Number.isFinite(since) || !Number.isFinite(until) || until < since) return [];
  const zone = usableTimeZone(timeZone);
  let day = ymdInTimeZone(new Date(since), zone);
  const last = ymdInTimeZone(new Date(until), zone);
  const covered: string[] = [];
  for (let i = 0; i < 800 && day <= last; i += 1) {
    if (isShopDayFullyCovered(day, sinceIso, untilIso, zone)) covered.push(day);
    day = addCalendarDays(day, 1);
  }
  return covered;
}

/** Vercel maxDuration for GET /api/cron/shopify-orders. */
export const SHOPIFY_CRON_MAX_MS = 300_000;
/** Leave this much of the cron before starting or continuing the integrity check. */
export const PNL_INTEGRITY_MIN_BUDGET_MS = 20_000;

export function pnlIntegrityDeadline(startedMs: number): number {
  return startedMs + SHOPIFY_CRON_MAX_MS - PNL_INTEGRITY_MIN_BUDGET_MS;
}

/** True while at least ~20s remain before the cron's 300s limit. */
export function pnlIntegrityBudgetRemains(nowMs: number, deadlineMs: number): boolean {
  return nowMs < deadlineMs;
}
