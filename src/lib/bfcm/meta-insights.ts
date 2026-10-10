export interface HourlySpend {
  hour: number;
  spend: number;
}

export interface MetaDateRange {
  since: string;
  until: string;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Meta reads time_range in the ad account timezone and rejects a since that
 * is still in the future there. Clamp until to account-local today. Skip the
 * call when since is after that day or the range is empty.
 */
export function clampMetaRange(since: string, until: string, accountToday: string): MetaDateRange | null {
  if (!DAY.test(since) || !DAY.test(until) || !DAY.test(accountToday) || since > until) return null;
  if (since > accountToday) return null;
  const cappedUntil = until > accountToday ? accountToday : until;
  if (since > cappedUntil) return null;
  return { since, until: cappedUntil };
}

/** History ranges that are safe to send. A future BFCM window is omitted. */
export function metaHistoryRanges(input: {
  accountToday: string;
  l7Since: string;
  l7Until: string;
  lastYearStart: string;
  lastYearEnd: string;
  thisYearStart: string;
  thisYearEnd: string;
  sameDay: string;
}): { name: string; since: string; until: string }[] {
  const candidates: { name: string; since: string; until: string }[] = [
    { name: 'l7', since: input.l7Since, until: input.l7Until },
    { name: 'lastYearWindow', since: input.lastYearStart, until: input.lastYearEnd },
    { name: 'thisYearWindow', since: input.thisYearStart, until: input.thisYearEnd },
    { name: 'sameDay', since: input.sameDay, until: input.sameDay },
  ];
  const kept: { name: string; since: string; until: string }[] = [];
  for (const candidate of candidates) {
    const clamped = clampMetaRange(candidate.since, candidate.until, input.accountToday);
    if (clamped) kept.push({ name: candidate.name, since: clamped.since, until: clamped.until });
  }
  return kept;
}

const META_GRAPH = 'https://graph.facebook.com/v21.0';

/** One insights request for every L7 day, with an hourly breakdown and a daily increment. */
export function l7HourlyInsightQuery(since: string, until: string): string {
  const timeRange = JSON.stringify({ since, until });
  return [
    'level=account',
    `time_range=${encodeURIComponent(timeRange)}`,
    'time_increment=1',
    'breakdowns=hourly_stats_aggregated_by_advertiser_time_zone',
    'fields=spend',
    'limit=500',
  ].join('&');
}

export function insightUrl(adAccountId: string, query: string): string {
  const account = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
  return `${META_GRAPH}/${account}/insights?${query}`;
}

/** Drop access_token so a Graph paging URL can be retried with the Authorization header. */
export function stripAccessToken(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.delete('access_token');
    return parsed.toString();
  } catch {
    return url.replace(/([?&])access_token=[^&]*&?/g, '$1').replace(/[?&]$/, '');
  }
}

export function parseHourLabel(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{1,2}):/.exec(value);
  if (!match) return null;
  const hour = parseInt(match[1], 10);
  if (hour < 0 || hour > 23) return null;
  return hour;
}

export function emptyHourlySpend(): HourlySpend[] {
  return Array.from({ length: 24 }, (_, hour) => ({ hour, spend: 0 }));
}

/** Rows from one ranged hourly insights call, keyed by date_start. */
export function parseHourlySpendRows(rows: unknown[]): Map<string, HourlySpend[]> {
  const map = new Map<string, HourlySpend[]>();
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const record = row as {
      date_start?: unknown;
      spend?: unknown;
      hourly_stats_aggregated_by_advertiser_time_zone?: unknown;
    };
    const date = typeof record.date_start === 'string' ? record.date_start : '';
    const hour = parseHourLabel(record.hourly_stats_aggregated_by_advertiser_time_zone);
    if (!date || hour == null) continue;
    let hours = map.get(date);
    if (!hours) {
      hours = emptyHourlySpend();
      map.set(date, hours);
    }
    hours[hour].spend += Number(record.spend || 0);
  }
  return map;
}

/** Average only days that had spend, matching the previous L7 spend baseline. */
export function averageHourlySpend(days: HourlySpend[][]): HourlySpend[] {
  const active = days.filter((day) => day.reduce((sum, point) => sum + point.spend, 0) > 0);
  const n = active.length;
  return Array.from({ length: 24 }, (_, hour) => ({
    hour,
    spend: n === 0 ? 0 : active.reduce((sum, day) => sum + (day[hour]?.spend || 0), 0) / n,
  }));
}

export async function metaGet(url: string, token: string): Promise<any> {
  const clean = stripAccessToken(url);
  const res = await fetch(clean, { headers: { Authorization: `Bearer ${token}` } });
  const json = (await res.json().catch(() => ({}))) as { error?: { message?: string }; paging?: { next?: string } };
  if (!res.ok || json?.error) {
    throw new Error(json?.error?.message || `Meta HTTP ${res.status}`);
  }
  return json;
}

export async function metaCollect(url: string, token: string): Promise<any[]> {
  const rows: any[] = [];
  let next: string | null = url;
  for (let page = 0; page < 8 && next; page += 1) {
    const json = await metaGet(next, token);
    if (Array.isArray(json?.data)) rows.push(...json.data);
    next = typeof json?.paging?.next === 'string' ? stripAccessToken(json.paging.next) : null;
  }
  return rows;
}
