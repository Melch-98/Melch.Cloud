import { describe, expect, it } from 'vitest';
import { shopTodayAndL7, bfcmWindow } from '@/lib/bfcm/calendar';
import {
  averageHourlySpend,
  clampMetaRange,
  insightUrl,
  l7HourlyInsightQuery,
  metaHistoryRanges,
  parseHourlySpendRows,
  stripAccessToken,
} from '@/lib/bfcm/meta-insights';

describe('Meta L7 hourly request', () => {
  it('covers the seven days in one ranged call and keeps the token out of the URL', () => {
    const query = l7HourlyInsightQuery('2026-11-19', '2026-11-25');
    const url = insightUrl('act_123', query);
    expect(url).toContain('time_increment=1');
    expect(url).toContain('breakdowns=hourly_stats_aggregated_by_advertiser_time_zone');
    expect(url).toContain('2026-11-19');
    expect(url).toContain('2026-11-25');
    expect(url).not.toContain('access_token');
    expect(url.match(/insights\?/g)).toHaveLength(1);
  });

  it('strips access_token from a paging URL', () => {
    const clean = stripAccessToken(
      'https://graph.facebook.com/v21.0/act_1/insights?limit=500&access_token=secret-token&after=abc'
    );
    expect(clean).not.toContain('secret-token');
    expect(clean).not.toContain('access_token');
    expect(clean).toContain('after=abc');
  });

  it('splits one ranged payload back into per-day hours', () => {
    const parsed = parseHourlySpendRows([
      {
        date_start: '2026-11-19',
        spend: '10',
        hourly_stats_aggregated_by_advertiser_time_zone: '01:00:00 - 01:59:59',
      },
      {
        date_start: '2026-11-20',
        spend: '4',
        hourly_stats_aggregated_by_advertiser_time_zone: '01:00:00 - 01:59:59',
      },
    ]);
    expect(parsed.get('2026-11-19')?.[1].spend).toBe(10);
    expect(parsed.get('2026-11-20')?.[1].spend).toBe(4);
    const avg = averageHourlySpend([parsed.get('2026-11-19')!, parsed.get('2026-11-20')!]);
    expect(avg[1].spend).toBe(7);
  });
});

describe('Meta time_range against the ad account clock', () => {
  it('does not ask Chicago for the UTC date after 7pm CT', () => {
    const now = new Date('2026-10-10T00:43:00Z');
    const accountToday = shopTodayAndL7(now, 'America/Chicago').today;
    const utc = shopTodayAndL7(now, 'UTC');
    expect(accountToday).toBe('2026-10-09');
    expect(utc.today).toBe('2026-10-10');
    expect(clampMetaRange(utc.today, utc.today, accountToday)).toBeNull();
    expect(clampMetaRange(utc.l7[0], utc.today, accountToday)).toEqual({
      since: '2026-10-03',
      until: '2026-10-09',
    });
  });

  it('skips a future BFCM window and clamps one that has already started', () => {
    const window = bfcmWindow(2026);
    expect(window.start).toBe('2026-11-23');
    expect(window.end).toBe('2026-11-30');
    expect(clampMetaRange(window.start, window.end, '2026-10-09')).toBeNull();
    expect(clampMetaRange(window.start, window.end, '2026-11-27')).toEqual({
      since: '2026-11-23',
      until: '2026-11-27',
    });
    const lastYear = bfcmWindow(2025);
    expect(clampMetaRange(lastYear.start, lastYear.end, '2026-10-09')).toEqual({
      since: lastYear.start,
      until: lastYear.end,
    });
  });

  it('omits the this-year window from the history calls while the window is still ahead', () => {
    const now = new Date('2026-10-10T00:43:00Z');
    const account = shopTodayAndL7(now, 'America/Chicago');
    const window = bfcmWindow(2026);
    const lastYear = bfcmWindow(2025);
    const ranges = metaHistoryRanges({
      accountToday: account.today,
      l7Since: account.l7[0],
      l7Until: account.l7[account.l7.length - 1],
      lastYearStart: lastYear.start,
      lastYearEnd: lastYear.end,
      thisYearStart: window.start,
      thisYearEnd: window.end,
      sameDay: '2025-10-10',
    });
    expect(ranges.map((range) => range.name)).toEqual(['l7', 'lastYearWindow', 'sameDay']);
    expect(ranges.find((range) => range.name === 'thisYearWindow')).toBeUndefined();
    expect(ranges.every((range) => range.since <= account.today && range.until <= account.today)).toBe(true);
  });
});
