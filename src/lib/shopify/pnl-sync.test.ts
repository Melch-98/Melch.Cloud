import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aggregateOrdersByDay, type PnlShopifyOrder } from './pnl-days.ts';
import { pnlCatchUpWindow } from './pnl-targets.ts';
import {
  coveredShopDays,
  isGrossMismatch,
  isShopDayFullyCovered,
  lastCompleteShopDays,
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
