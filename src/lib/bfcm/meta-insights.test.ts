import { describe, expect, it } from 'vitest';
import {
  averageHourlySpend,
  insightUrl,
  l7HourlyInsightQuery,
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
