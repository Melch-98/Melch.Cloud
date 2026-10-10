import { zonedClock } from '@/lib/bfcm/calendar';
import { clampMetaRange, emptyHourlySpend, parseHourlySpendRows, type HourlySpend } from '@/lib/bfcm/meta-insights';
import { addCalendarDays, usableTimeZone, ymdInTimeZone, zonedDateTime, zonedMidnight } from '@/lib/shopify/shop-time';

export interface AccountHourRow {
  date: string;
  hour: number;
  spend: number;
  conversionValue?: number;
  conversions?: number;
}

export interface StoreDaySpend {
  hourly: HourlySpend[];
  spend: number;
  conversionValue: number;
  conversions: number;
}

/**
 * Account-local dates that overlap one store-local day.
 * Toronto is three hours ahead of Los Angeles, so a Toronto day starts on the
 * previous Los Angeles evening and ends on the next Los Angeles evening.
 */
export function accountDatesForStoreDay(
  storeDate: string,
  storeTimeZone: string,
  accountTimeZone: string
): { since: string; until: string } {
  const storeZone = usableTimeZone(storeTimeZone);
  const accountZone = usableTimeZone(accountTimeZone);
  const start = zonedMidnight(storeDate, storeZone);
  const end = new Date(zonedMidnight(addCalendarDays(storeDate, 1), storeZone).getTime() - 1);
  return {
    since: ymdInTimeZone(start, accountZone),
    until: ymdInTimeZone(end, accountZone),
  };
}

/**
 * time_range for the store day, clamped so the ad account is not asked for a
 * date that has not started there (same rule as other Meta history calls).
 */
export function storeDayAccountRange(
  storeDate: string,
  storeTimeZone: string,
  accountTimeZone: string,
  accountToday: string
): { since: string; until: string } | null {
  const overlap = accountDatesForStoreDay(storeDate, storeTimeZone, accountTimeZone);
  return clampMetaRange(overlap.since, overlap.until, accountToday);
}

/**
 * Sum advertiser-timezone hourly spend that falls inside the store-local day.
 * The chart's Today line is these 24 store-local hours. MER uses their total.
 * Hours that belong to the store's previous or next day are left out, so an
 * open account day is not paired with the next store morning.
 */
export function rebucketAccountHoursToStoreDay(input: {
  rows: AccountHourRow[];
  storeDate: string;
  storeTimeZone: string;
  accountTimeZone: string;
}): StoreDaySpend {
  const storeZone = usableTimeZone(input.storeTimeZone);
  const accountZone = usableTimeZone(input.accountTimeZone);
  const hourly = emptyHourlySpend();
  let spend = 0;
  let conversionValue = 0;
  let conversions = 0;
  for (const row of input.rows) {
    if (!Number.isInteger(row.hour) || row.hour < 0 || row.hour > 23) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date)) continue;
    const instant = zonedDateTime(row.date, row.hour, 0, accountZone);
    const clock = zonedClock(instant, storeZone);
    if (clock.ymd !== input.storeDate) continue;
    const amount = Number(row.spend);
    const safeAmount = Number.isFinite(amount) ? amount : 0;
    hourly[clock.hour].spend += safeAmount;
    spend += safeAmount;
    const value = Number(row.conversionValue);
    const count = Number(row.conversions);
    if (Number.isFinite(value)) conversionValue += value;
    if (Number.isFinite(count)) conversions += count;
  }
  return { hourly, spend, conversionValue, conversions };
}

/** Flatten a Meta hourly insights payload into account-local hour rows. */
export function accountHourRowsFromMeta(rows: unknown[]): AccountHourRow[] {
  const flat: AccountHourRow[] = [];
  for (const [date, hours] of Array.from(parseHourlySpendRows(rows))) {
    for (const point of hours) {
      if (!point.spend) continue;
      flat.push({ date, hour: point.hour, spend: point.spend });
    }
  }
  return flat;
}
