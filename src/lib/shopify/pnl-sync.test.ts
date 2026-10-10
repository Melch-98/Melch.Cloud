import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readGoogleSpend, readMetaSpend } from './fetch-ad-spend.ts';
import { aggregateOrdersByDay, type DayBucket, type PnlShopifyOrder } from './pnl-days.ts';
import {
  buildFullCoveredDayRows,
  buildSpendOnlyCoveredDayRows,
  coveredDaysWithinStoredHistory,
  ZERO_DAY_BUCKET,
} from './pnl-covered-days.ts';
import { pnlCatchUpWindow } from './pnl-targets.ts';
import {
  coveredShopDays,
  fullyCoveredShopDays,
  isGrossMismatch,
  isShopDayFullyCovered,
  lastCompleteShopDays,
  pnlIntegrityBudgetRemains,
  pnlIntegrityDeadline,
  shopLocalDay,
} from './shop-time.ts';
import { spendFields, upsertDailyPnl } from './upsert-daily-pnl.ts';

function order(id: number, createdAt: string, subtotal: string): PnlShopifyOrder {
  return {
    id,
    created_at: createdAt,
    financial_status: 'paid',
    subtotal_price: subtotal,
    total_discounts: '0',
    total_tax: '0',
    shipping_lines: [],
    refunds: [],
    customer: null,
  };
}

test('order timestamps bucket on the shop-local date in Toronto, Chicago, and UTC', () => {
  const stamp = '2026-10-02T00:30:00Z';
  assert.equal(shopLocalDay(stamp, 'UTC'), '2026-10-02');
  assert.equal(shopLocalDay(stamp, 'America/Toronto'), '2026-10-01');
  assert.equal(shopLocalDay(stamp, 'America/Chicago'), '2026-10-01');

  const buckets = aggregateOrdersByDay(
    [
      order(1, '2026-10-01T21:00:00-04:00', '100.00'),
      order(2, '2026-10-02T00:30:00Z', '40.00'),
      order(3, '2026-10-02T10:00:00-05:00', '25.00'),
    ],
    'America/Toronto'
  );
  assert.equal(buckets.get('2026-10-01')?.gross_sales, 140);
  assert.equal(buckets.get('2026-10-02')?.gross_sales, 25);

  const chicago = aggregateOrdersByDay([order(3, '2026-10-02T10:00:00-05:00', '25.00')], 'America/Chicago');
  assert.equal(chicago.has('2026-10-02'), true);

  const utc = aggregateOrdersByDay([order(2, '2026-10-02T00:30:00Z', '40.00')], 'UTC');
  assert.equal(utc.has('2026-10-02'), true);
  assert.equal(utc.has('2026-10-01'), false);
});

test('a UTC-midnight window does not write the partial Toronto edge day', () => {
  const since = '2026-10-02T00:00:00.000Z';
  const until = '2026-10-05T17:00:00.000Z';
  const buckets = aggregateOrdersByDay(
    [
      order(1, '2026-10-01T21:00:00-04:00', '442.04'),
      order(2, '2026-10-02T11:00:00-04:00', '3061.00'),
      order(3, '2026-10-05T12:00:00-04:00', '80.00'),
    ],
    'America/Toronto'
  );
  const written = coveredShopDays(buckets.keys(), since, until, 'America/Toronto');
  assert.deepEqual(written, ['2026-10-02']);
  assert.equal(buckets.has('2026-10-01'), true);
  assert.equal(isShopDayFullyCovered('2026-10-01', since, until, 'America/Toronto'), false);
  assert.equal(isShopDayFullyCovered('2026-10-05', since, until, 'America/Toronto'), false);
});

test('the shop-local catch-up window writes complete days and skips today', () => {
  const now = new Date('2026-10-05T17:00:00.000Z');
  const toronto = pnlCatchUpWindow(now, '2026-10-05', null, 'America/Toronto');
  assert.equal(isShopDayFullyCovered('2026-10-02', toronto.sinceDate, toronto.untilDate, 'America/Toronto'), true);
  assert.equal(isShopDayFullyCovered('2026-10-04', toronto.sinceDate, toronto.untilDate, 'America/Toronto'), true);
  assert.equal(isShopDayFullyCovered('2026-10-05', toronto.sinceDate, toronto.untilDate, 'America/Toronto'), false);

  const chicago = pnlCatchUpWindow(now, '2026-10-05', null, 'America/Chicago');
  assert.equal(isShopDayFullyCovered(chicago.startDate, chicago.sinceDate, chicago.untilDate, 'America/Chicago'), true);
  assert.equal(isShopDayFullyCovered('2026-10-05', chicago.sinceDate, chicago.untilDate, 'America/Chicago'), false);

  const utc = pnlCatchUpWindow(now, '2026-10-05', null, 'UTC');
  assert.equal(isShopDayFullyCovered('2026-10-02', utc.sinceDate, utc.untilDate, 'UTC'), true);
  assert.equal(isShopDayFullyCovered('2026-10-05', utc.sinceDate, utc.untilDate, 'UTC'), false);
});

test('daily_pnl upsert does not null columns the payload omits', async () => {
  const seen: Array<{ rows: Array<Record<string, unknown>>; options: { defaultToNull?: boolean; onConflict?: string } }> = [];
  const supabase = {
    from() {
      return {
        upsert(rows: Array<Record<string, unknown>>, options: { defaultToNull?: boolean; onConflict?: string }) {
          seen.push({ rows, options });
          return { error: null };
        },
      };
    },
  };
  const row = {
    brand_id: 'brand',
    date: '2026-10-01',
    gross_sales: 3061,
    ...spendFields('2026-10-01', new Map(), new Map()),
  };
  assert.equal('meta_spend' in row, false);
  assert.equal('google_spend' in row, false);
  const result = await upsertDailyPnl(supabase, [row]);
  assert.equal(result.error, null);
  assert.equal(seen[0].options.onConflict, 'brand_id,date');
  assert.equal(seen[0].options.defaultToNull, false);
});

test('the spend path still writes meta_spend and google_spend', async () => {
  const seen: Array<Array<Record<string, unknown>>> = [];
  const supabase = {
    from() {
      return {
        upsert(rows: Array<Record<string, unknown>>) {
          seen.push(rows);
          return { error: null };
        },
      };
    },
  };
  const meta = new Map([['2026-10-02', 12.5]]);
  const google = new Map([['2026-10-02', 3.25]]);
  const row = {
    brand_id: 'brand',
    date: '2026-10-02',
    gross_sales: 100,
    ...spendFields('2026-10-02', meta, google),
  };
  await upsertDailyPnl(supabase, [row]);
  assert.equal(seen[0][0].meta_spend, 12.5);
  assert.equal(seen[0][0].google_spend, 3.25);
});

test('a missing currency column retries without nulling spend', async () => {
  const seen: Array<{ rows: Array<Record<string, unknown>>; options: { defaultToNull?: boolean } }> = [];
  let calls = 0;
  const supabase = {
    from() {
      return {
        upsert(rows: Array<Record<string, unknown>>, options: { defaultToNull?: boolean }) {
          seen.push({ rows, options });
          calls += 1;
          if (calls === 1) return { error: { message: 'column "currency" of relation daily_pnl does not exist' } };
          return { error: null };
        },
      };
    },
  };
  const result = await upsertDailyPnl(supabase, [
    { brand_id: 'brand', date: '2026-10-02', currency: 'USD', gross_sales: 10, meta_spend: 4 },
  ]);
  assert.equal(result.error, null);
  assert.equal(seen[1].rows[0].currency, undefined);
  assert.equal(seen[1].rows[0].meta_spend, 4);
  assert.equal(seen[0].options.defaultToNull, false);
  assert.equal(seen[1].options.defaultToNull, false);
});

function bucket(gross: number, extra: Partial<DayBucket> = {}): DayBucket {
  return { ...ZERO_DAY_BUCKET, gross_sales: gross, nc_orders: gross > 0 ? 1 : 0, nc_revenue: gross, ...extra };
}

test('every fully covered day is written, with zeros when that day has no orders', () => {
  const since = '2026-10-02T04:00:00.000Z';
  const until = '2026-10-05T17:00:00.000Z';
  const days = fullyCoveredShopDays(since, until, 'America/Toronto');
  assert.deepEqual(days, ['2026-10-02', '2026-10-03', '2026-10-04']);
  assert.equal(fullyCoveredShopDays('2026-10-02T12:00:00.000Z', until, 'America/Toronto').includes('2026-10-02'), false);

  const buckets = new Map<string, DayBucket>([
    ['2026-10-02', bucket(3061)],
    ['2026-10-03', bucket(0, { refunds: -12.5 })],
  ]);
  const rows = buildFullCoveredDayRows({
    brandId: 'mintier',
    currency: 'USD',
    syncedAt: '2026-10-05T17:00:00.000Z',
    coveredDays: days,
    buckets,
    meta: { ok: true, byDay: new Map([['2026-10-02', 12.5]]) },
    google: { ok: true, byDay: new Map([['2026-10-04', 3.25]]) },
  });

  assert.equal(rows.length, 3);
  assert.equal(rows[0].gross_sales, 3061);
  assert.equal(rows[0].meta_spend, 12.5);
  assert.equal(rows[0].google_spend, 0);
  assert.equal(rows[1].gross_sales, 0);
  assert.equal(rows[1].nc_orders, 0);
  assert.equal(rows[1].refunds, -12.5);
  assert.equal(rows[1].meta_spend, 0);
  assert.equal(rows[1].google_spend, 0);
  assert.equal(rows[2].gross_sales, 0);
  assert.equal(rows[2].meta_spend, 0);
  assert.equal(rows[2].google_spend, 3.25);
  assert.equal(rows.some((row) => row.date === '2026-10-05'), false);
});

test('a failed spend fetch does not write zero over a covered day', () => {
  const rows = buildFullCoveredDayRows({
    brandId: 'mintier',
    currency: 'USD',
    syncedAt: '2026-10-05T17:00:00.000Z',
    coveredDays: ['2026-10-02', '2026-10-03'],
    buckets: new Map([['2026-10-02', bucket(100)]]),
    meta: { ok: false, byDay: new Map([['2026-10-02', 99]]) },
    google: { ok: true, byDay: new Map() },
  });
  assert.equal('meta_spend' in rows[0], false);
  assert.equal('meta_spend' in rows[1], false);
  assert.equal(rows[0].google_spend, 0);
  assert.equal(rows[1].google_spend, 0);
  assert.equal(rows[1].gross_sales, 0);

  const spendOnly = buildSpendOnlyCoveredDayRows({
    brandId: 'mintier',
    currency: 'USD',
    syncedAt: '2026-10-05T17:00:00.000Z',
    coveredDays: ['2026-10-02'],
    meta: { ok: true, byDay: new Map() },
    google: { ok: false, byDay: new Map() },
  });
  assert.equal(spendOnly.length, 1);
  assert.equal(spendOnly[0].meta_spend, 0);
  assert.equal('google_spend' in spendOnly[0], false);
  assert.equal('gross_sales' in spendOnly[0], false);

  const neither = buildSpendOnlyCoveredDayRows({
    brandId: 'mintier',
    currency: 'USD',
    syncedAt: '2026-10-05T17:00:00.000Z',
    coveredDays: ['2026-10-02'],
    meta: { ok: false, byDay: new Map() },
    google: { ok: false, byDay: new Map() },
  });
  assert.deepEqual(neither, []);
});

test('an empty successful spend payload is zero, and an error payload is not', () => {
  const googleEmpty = readGoogleSpend({ results: [] });
  assert.equal(googleEmpty.ok, true);
  assert.equal(googleEmpty.byDay.size, 0);
  const googleZeroCost = readGoogleSpend([
    { segments: { date: '2026-10-02' }, metrics: { costMicros: '0' } },
  ]);
  assert.equal(googleZeroCost.ok, true);
  assert.equal(googleZeroCost.byDay.has('2026-10-02'), false);
  assert.equal(readGoogleSpend({ error: 'nope' }).ok, false);

  const metaEmpty = readMetaSpend(true, { data: [] });
  assert.equal(metaEmpty.ok, true);
  assert.equal(metaEmpty.byDay.size, 0);
  assert.equal(readMetaSpend(true, { error: { message: 'Invalid OAuth access token' } }).ok, false);
  assert.equal(readMetaSpend(false, { data: [] }).ok, false);
  assert.equal(readMetaSpend(true, { data: [], paging: { next: 'https://graph.facebook.com/next' } }).ok, false);
});

test('a rebuild does not zero-fill days before the earliest stored order', () => {
  const covered = ['2026-09-20', '2026-09-21', '2026-09-25', '2026-09-26'];
  const beforeHistory = coveredDaysWithinStoredHistory(covered, '2026-09-25');
  assert.deepEqual(beforeHistory.write, ['2026-09-25', '2026-09-26']);
  assert.deepEqual(beforeHistory.skipped, ['2026-09-20', '2026-09-21']);

  const noOrders = coveredDaysWithinStoredHistory(covered, null);
  assert.deepEqual(noOrders.write, []);
  assert.deepEqual(noOrders.skipped, covered);

  const historyAlreadyOpen = coveredDaysWithinStoredHistory(covered, '2026-09-01');
  assert.deepEqual(historyAlreadyOpen.write, covered);
  assert.deepEqual(historyAlreadyOpen.skipped, []);
});

test('integrity does not start when under 20 seconds remain before the 300s cron limit', () => {
  const started = 1_000_000;
  const deadline = pnlIntegrityDeadline(started);
  assert.equal(deadline, started + 300_000 - 20_000);
  assert.equal(pnlIntegrityBudgetRemains(deadline, deadline), false);
  assert.equal(pnlIntegrityBudgetRemains(deadline + 5_000, deadline), false);
  assert.equal(pnlIntegrityBudgetRemains(deadline - 1, deadline), true);
});

test('integrity flags gross gaps over 2 percent and ignores the open shop day', () => {
  assert.equal(isGrossMismatch(442.04, 3061), true);
  assert.equal(isGrossMismatch(100, 101), false);
  assert.equal(isGrossMismatch(100, 103), true);
  assert.equal(isGrossMismatch(100, 102), false);
  assert.equal(isGrossMismatch(0, 0), false);
  assert.equal(isGrossMismatch(null, 0), false);
  assert.equal(isGrossMismatch(null, 25), true);

  const toronto = lastCompleteShopDays(new Date('2026-10-09T17:30:00.000Z'), 'America/Toronto');
  assert.deepEqual(toronto, { start: '2026-09-25', end: '2026-10-08' });
  const chicago = lastCompleteShopDays(new Date('2026-10-09T04:30:00.000Z'), 'America/Chicago');
  assert.deepEqual(chicago, { start: '2026-09-24', end: '2026-10-07' });
  const utc = lastCompleteShopDays(new Date('2026-10-09T04:30:00.000Z'), 'UTC');
  assert.deepEqual(utc, { start: '2026-09-25', end: '2026-10-08' });
});
