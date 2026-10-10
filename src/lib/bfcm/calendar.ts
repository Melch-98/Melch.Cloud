import {
  addCalendarDays,
  usableTimeZone,
  ymdInTimeZone,
  zonedMidnight,
} from '@/lib/shopify/shop-time';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function utcWeekday(ymd: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!match) throw new Error(`Invalid date: ${ymd}`);
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))).getUTCDay();
}

export function weekdayName(ymd: string): string {
  return WEEKDAYS[utcWeekday(ymd)];
}

export function daysBetween(start: string, end: string): number {
  const a = Date.parse(`${start}T00:00:00Z`);
  const b = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) throw new Error('Invalid date');
  return Math.round((b - a) / 86_400_000);
}

/** Fourth Thursday of November. */
export function thanksgivingDate(year: number): string {
  let seen = 0;
  for (let day = 1; day <= 30; day += 1) {
    const ymd = `${year}-11-${String(day).padStart(2, '0')}`;
    if (utcWeekday(ymd) === 4) {
      seen += 1;
      if (seen === 4) return ymd;
    }
  }
  throw new Error(`No Thanksgiving in ${year}`);
}

export interface BfcmDay {
  date: string;
  dayLabel: string;
  offsetFromBlackFriday: number;
}

export interface BfcmWindow {
  start: string;
  end: string;
  thanksgiving: string;
  blackFriday: string;
  cyberMonday: string;
  days: BfcmDay[];
}

function eventLabel(date: string, thanksgiving: string): string {
  if (date === thanksgiving) return 'Thanksgiving';
  if (date === addCalendarDays(thanksgiving, 1)) return 'Black Friday';
  if (date === addCalendarDays(thanksgiving, 4)) return 'Cyber Monday';
  return weekdayName(date);
}

/** Monday before Thanksgiving through Cyber Monday. */
export function bfcmWindow(year: number): BfcmWindow {
  const thanksgiving = thanksgivingDate(year);
  const blackFriday = addCalendarDays(thanksgiving, 1);
  const start = addCalendarDays(thanksgiving, -3);
  const end = addCalendarDays(thanksgiving, 4);
  const days: BfcmDay[] = [];
  for (let date = start; date <= end; date = addCalendarDays(date, 1)) {
    days.push({
      date,
      dayLabel: eventLabel(date, thanksgiving),
      offsetFromBlackFriday: daysBetween(blackFriday, date),
    });
  }
  return { start, end, thanksgiving, blackFriday, cyberMonday: end, days };
}

export type LastYearRule = 'bfcm_event' | 'minus_364';

export interface LastYearAlignment {
  date: string;
  rule: LastYearRule;
  inWindow: boolean;
  dayLabel: string;
  offsetFromBlackFriday: number | null;
}

/**
 * Inside the BFCM window, align by offset from Black Friday
 * (2026-11-27 ↔ 2025-11-28, 2026-11-30 ↔ 2025-12-01).
 * Outside the window, compare to the same weekday: date minus 364 days.
 */
export function alignLastYear(date: string): LastYearAlignment {
  const year = Number(date.slice(0, 4));
  const current = bfcmWindow(year);
  if (date >= current.start && date <= current.end) {
    const offset = daysBetween(current.blackFriday, date);
    const last = bfcmWindow(year - 1);
    const aligned = addCalendarDays(last.blackFriday, offset);
    return {
      date: aligned,
      rule: 'bfcm_event',
      inWindow: true,
      dayLabel: eventLabel(aligned, last.thanksgiving),
      offsetFromBlackFriday: offset,
    };
  }
  const aligned = addCalendarDays(date, -364);
  return {
    date: aligned,
    rule: 'minus_364',
    inWindow: false,
    dayLabel: weekdayName(aligned),
    offsetFromBlackFriday: null,
  };
}

export type LastYearSalesStatus = 'ok' | 'no_last_year_data';

/** A comparison day before the first stored order is missing history, not a zero. */
export function lastYearSalesStatus(
  comparisonDate: string,
  earliestOrderDay: string | null | undefined
): LastYearSalesStatus {
  if (!earliestOrderDay) return 'no_last_year_data';
  if (comparisonDate < earliestOrderDay) return 'no_last_year_data';
  return 'ok';
}

export interface ZonedClock {
  ymd: string;
  hour: number;
  minute: number;
}

/** Shop-local calendar date and clock. Hour 24 from Intl is midnight. */
export function zonedClock(date: Date, timeZone: string): ZonedClock {
  const zone = usableTimeZone(timeZone);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '0';
  let hour = Number(get('hour'));
  if (hour === 24) hour = 0;
  const ymd = `${get('year')}-${get('month')}-${get('day')}`;
  return { ymd, hour, minute: Number(get('minute')) };
}

export function shopTodayAndL7(
  now: Date,
  timeZone: string
): { today: string; l7: string[]; hour: number; minute: number } {
  const clock = zonedClock(now, timeZone);
  const l7: string[] = [];
  for (let i = 7; i >= 1; i -= 1) l7.push(addCalendarDays(clock.ymd, -i));
  return { today: clock.ymd, l7, hour: clock.hour, minute: clock.minute };
}

/** Inclusive shop-local start through the last millisecond of the end date. */
export function shopDayRangeIso(
  startYmd: string,
  endYmd: string,
  timeZone: string
): { min: string; max: string } {
  const min = zonedMidnight(startYmd, timeZone).toISOString();
  const maxMs = zonedMidnight(addCalendarDays(endYmd, 1), timeZone).getTime() - 1;
  return { min, max: new Date(maxMs).toISOString() };
}

export function shopHour(iso: string, timeZone: string): { ymd: string; hour: number } | null {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  const clock = zonedClock(parsed, timeZone);
  if (ymdInTimeZone(parsed, timeZone) !== clock.ymd) return null;
  return { ymd: clock.ymd, hour: clock.hour };
}

export type OrderFeed = 'realtime' | 'cron_2h' | 'triple_whale' | 'none';

export function orderFeed(input: {
  connection: 'shopify_admin' | 'triple_whale' | 'none';
  webhooksOk: boolean;
}): { feed: OrderFeed; label: string } {
  if (input.connection === 'triple_whale') {
    return { feed: 'triple_whale', label: 'Triple Whale (~5h lag)' };
  }
  if (input.connection === 'none') return { feed: 'none', label: 'No order feed' };
  if (input.webhooksOk) return { feed: 'realtime', label: 'Real-time webhooks' };
  return { feed: 'cron_2h', label: '2-hour sync' };
}
