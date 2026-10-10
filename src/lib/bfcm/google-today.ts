/** One shop-local day of Google Ads cost and conversion value from GAQL rows. */

export interface GoogleTodayMetrics {
  spend: number;
  conversionValue: number;
  conversions: number;
}

export function sumGoogleToday(rows: unknown[]): GoogleTodayMetrics {
  let spend = 0;
  let conversionValue = 0;
  let conversions = 0;
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const metrics = (row as { metrics?: Record<string, unknown> }).metrics || {};
    const micros = Number(metrics.costMicros ?? metrics.cost_micros ?? 0);
    spend += (Number.isFinite(micros) ? micros : 0) / 1_000_000;
    const value = Number(metrics.conversionsValue ?? metrics.conversions_value ?? 0);
    const count = Number(metrics.conversions ?? 0);
    if (Number.isFinite(value)) conversionValue += value;
    if (Number.isFinite(count)) conversions += count;
  }
  return { spend, conversionValue, conversions };
}

export function googleTodayQuery(day: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('Invalid Google date');
  return [
    'SELECT metrics.cost_micros, metrics.conversions_value, metrics.conversions',
    'FROM campaign',
    `WHERE segments.date = '${day}'`,
  ].join(' ');
}

/** Hourly cost for the account dates that overlap the store day. segments.hour is the account clock. */
export function googleStoreDayQuery(since: string, until: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since) || !/^\d{4}-\d{2}-\d{2}$/.test(until)) {
    throw new Error('Invalid Google date');
  }
  return [
    'SELECT segments.date, segments.hour, metrics.cost_micros, metrics.conversions_value, metrics.conversions',
    'FROM campaign',
    `WHERE segments.date BETWEEN '${since}' AND '${until}'`,
  ].join(' ');
}

export function googleAccountHourRows(rows: unknown[]): {
  date: string;
  hour: number;
  spend: number;
  conversionValue: number;
  conversions: number;
}[] {
  const hours = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const segments = (row as { segments?: Record<string, unknown> }).segments || {};
    const date = typeof segments.date === 'string' ? segments.date.slice(0, 10) : '';
    const hour = Number(segments.hour);
    if (!date || !Number.isInteger(hour)) continue;
    const metrics = (row as { metrics?: Record<string, unknown> }).metrics || {};
    const micros = Number(metrics.costMicros ?? metrics.cost_micros ?? 0);
    const value = Number(metrics.conversionsValue ?? metrics.conversions_value ?? 0);
    const count = Number(metrics.conversions ?? 0);
    hours.push({
      date,
      hour,
      spend: (Number.isFinite(micros) ? micros : 0) / 1_000_000,
      conversionValue: Number.isFinite(value) ? value : 0,
      conversions: Number.isFinite(count) ? count : 0,
    });
  }
  return hours;
}
