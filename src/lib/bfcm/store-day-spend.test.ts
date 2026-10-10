import { describe, expect, it } from 'vitest';
import { shopTodayAndL7 } from '@/lib/bfcm/calendar';
import { googleAccountHourRows, googleStoreDayQuery } from '@/lib/bfcm/google-today';
import { l7HourlyInsightQuery } from '@/lib/bfcm/meta-insights';
import {
  accountDatesForStoreDay,
  accountHourRowsFromMeta,
  rebucketAccountHoursToStoreDay,
  storeDayAccountRange,
} from '@/lib/bfcm/store-day-spend';

const NOW = new Date('2026-10-10T05:30:00Z');
const STORE = 'America/Toronto';
const ACCOUNT = 'America/Los_Angeles';

describe('store-day spend while the ad account is still on yesterday', () => {
  it('asks only for the Los Angeles date that has started, then keeps the Toronto morning hours', () => {
    const store = shopTodayAndL7(NOW, STORE);
    const account = shopTodayAndL7(NOW, ACCOUNT);
    expect(store.today).toBe('2026-10-10');
    expect(store.hour).toBe(1);
    expect(account.today).toBe('2026-10-09');

    expect(accountDatesForStoreDay(store.today, STORE, ACCOUNT)).toEqual({
      since: '2026-10-09',
      until: '2026-10-10',
    });
    const range = storeDayAccountRange(store.today, STORE, ACCOUNT, account.today);
    expect(range).toEqual({ since: '2026-10-09', until: '2026-10-09' });

    const query = l7HourlyInsightQuery(range!.since, range!.until);
    expect(query).toContain('hourly_stats_aggregated_by_advertiser_time_zone');
    expect(query).toContain('2026-10-09');
    expect(query).not.toContain('2026-10-10');

    const rows = accountHourRowsFromMeta([
      {
        date_start: '2026-10-09',
        spend: '100',
        hourly_stats_aggregated_by_advertiser_time_zone: '20:00:00 - 20:59:59',
      },
      {
        date_start: '2026-10-09',
        spend: '10',
        hourly_stats_aggregated_by_advertiser_time_zone: '21:00:00 - 21:59:59',
      },
      {
        date_start: '2026-10-09',
        spend: '4',
        hourly_stats_aggregated_by_advertiser_time_zone: '22:00:00 - 22:59:59',
      },
    ]);
    const storeDay = rebucketAccountHoursToStoreDay({
      rows,
      storeDate: store.today,
      storeTimeZone: STORE,
      accountTimeZone: ACCOUNT,
    });
    expect(storeDay.hourly[0].spend).toBe(10);
    expect(storeDay.hourly[1].spend).toBe(4);
    expect(storeDay.hourly[2].spend).toBe(0);
    expect(storeDay.spend).toBe(14);

    let todayLine = 0;
    const cumulative = storeDay.hourly.map((point) => {
      todayLine += point.spend;
      return todayLine;
    });
    expect(cumulative[store.hour]).toBe(14);
    expect(cumulative[23]).toBe(14);
  });
});

describe('store-day spend when the clocks match', () => {
  it('keeps every hour of that date', () => {
    const range = storeDayAccountRange('2026-10-10', STORE, STORE, '2026-10-10');
    expect(range).toEqual({ since: '2026-10-10', until: '2026-10-10' });
    const storeDay = rebucketAccountHoursToStoreDay({
      rows: [
        { date: '2026-10-10', hour: 1, spend: 8 },
        { date: '2026-10-10', hour: 15, spend: 20 },
      ],
      storeDate: '2026-10-10',
      storeTimeZone: STORE,
      accountTimeZone: STORE,
    });
    expect(storeDay.hourly[1].spend).toBe(8);
    expect(storeDay.hourly[15].spend).toBe(20);
    expect(storeDay.spend).toBe(28);
  });
});

describe('Google hours inside the store day', () => {
  it('drops Los Angeles evening spend from the previous Toronto day and sums the rest', () => {
    const accountToday = shopTodayAndL7(NOW, ACCOUNT).today;
    const range = storeDayAccountRange('2026-10-10', STORE, ACCOUNT, accountToday);
    const query = googleStoreDayQuery(range!.since, range!.until);
    expect(query).toContain("segments.date BETWEEN '2026-10-09' AND '2026-10-09'");
    expect(query).toContain('segments.hour');

    const rows = googleAccountHourRows([
      { segments: { date: '2026-10-09', hour: 20 }, metrics: { costMicros: '5000000', conversionsValue: 9, conversions: 1 } },
      { segments: { date: '2026-10-09', hour: 21 }, metrics: { costMicros: '2500000', conversionsValue: 4, conversions: 1 } },
      { segments: { date: '2026-10-09', hour: 22 }, metrics: { cost_micros: 500000, conversions_value: 1, conversions: 0 } },
    ]);
    const storeDay = rebucketAccountHoursToStoreDay({
      rows,
      storeDate: '2026-10-10',
      storeTimeZone: STORE,
      accountTimeZone: ACCOUNT,
    });
    expect(storeDay.spend).toBe(3);
    expect(storeDay.conversionValue).toBe(5);
    expect(storeDay.conversions).toBe(1);
    expect(storeDay.hourly[0].spend).toBe(2.5);
    expect(storeDay.hourly[1].spend).toBe(0.5);
  });
});
