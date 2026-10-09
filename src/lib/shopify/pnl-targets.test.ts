import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  PNL_CAP_DAYS,
  PNL_CHUNK_DAYS,
  pnlCatchUpWindow,
  pnlIntegritySkipReason,
  pnlPathForBrand,
  pnlRefreshWindow,
  selectPnlRefreshBrands,
  type PnlBrand,
} from './pnl-targets.ts';

const fond: PnlBrand = {
  id: 'fond',
  name: 'FOND Regenerative',
  archived_at: null,
  shopify_store_domain: 'fondbonebrothtonics.myshopify.com',
  hasClientCredentials: true,
  hasLiveAdminToken: false,
};

const jaguar: PnlBrand = {
  id: 'oj',
  name: 'Organic Jaguar',
  archived_at: null,
  shopify_store_domain: 'organicjaguar.myshopify.com',
  hasClientCredentials: false,
  hasLiveAdminToken: false,
};

const party: PnlBrand = {
  id: 'pp',
  name: 'Party Patch',
  archived_at: null,
  shopify_store_domain: null,
  hasClientCredentials: false,
  hasLiveAdminToken: false,
};

test('custom-app brands refresh Daily P&L through the Shopify sync', () => {
  assert.equal(pnlPathForBrand(fond), 'shopify');
});

test('a shop domain without Shopify credentials refreshes through Triple Whale', () => {
  assert.equal(pnlPathForBrand(jaguar), 'triple_whale');
});

test('integrity checks Shopify Admin brands and skips Triple Whale-only brands', () => {
  assert.equal(pnlIntegritySkipReason(fond), null);
  assert.equal(pnlIntegritySkipReason(jaguar), 'triple_whale');
  assert.equal(pnlIntegritySkipReason(party), 'no_shop');
  assert.equal(
    pnlIntegritySkipReason({ ...fond, archived_at: '2026-08-01T00:00:00.000Z' }),
    'archived'
  );
});

test('archived brands are skipped even when they still have Shopify credentials', () => {
  assert.equal(pnlPathForBrand({ ...fond, archived_at: '2026-08-01T00:00:00.000Z' }), 'skip');
});

test('a brand with no shop domain is skipped', () => {
  assert.equal(pnlPathForBrand(party), 'skip');
});

test('fan-out keeps FOND on Shopify, Organic Jaguar on Triple Whale, and drops archived rows', () => {
  const archived = { ...fond, id: 'old', name: 'Nimi Skincare', archived_at: '2026-08-10T00:00:00.000Z' };
  const selected = selectPnlRefreshBrands([fond, jaguar, party, archived]);
  assert.deepEqual(selected.shopify.map((brand) => brand.name), ['FOND Regenerative']);
  assert.deepEqual(selected.tripleWhale.map((brand) => brand.name), ['Organic Jaguar']);
  assert.deepEqual(
    selected.skipped.map((brand) => brand.name).sort(),
    ['Nimi Skincare', 'Party Patch']
  );
});

test('the default refresh window is the last three UTC days plus today', () => {
  const window = pnlRefreshWindow(new Date('2026-09-28T17:30:00.000Z'));
  assert.equal(window.startDate, '2026-09-25');
  assert.equal(window.endDate, '2026-09-28');
  assert.equal(window.sinceDate, '2026-09-25T00:00:00.000Z');
  assert.equal(window.untilDate, '2026-09-28T17:30:00.000Z');
  assert.equal(window.chunked, false);
});

const NOW = new Date('2026-09-28T17:30:00.000Z');

test('Organic Jaguar opens at 09-21 so 09-23 and 09-24 are refilled in this run', () => {
  const window = pnlCatchUpWindow(NOW, '2026-09-22');
  assert.equal(window.startDate, '2026-09-21');
  assert.equal(window.endDate, '2026-09-28');
  assert.equal(window.chunked, false);
  assert.equal(window.sinceDate, '2026-09-21T00:00:00.000Z');
});

test('FOND, Mintier, and Tallow each include the missing days after their newest row', () => {
  assert.equal(pnlCatchUpWindow(NOW, '2026-09-23').startDate, '2026-09-22');
  assert.equal(pnlCatchUpWindow(NOW, '2026-09-24').startDate, '2026-09-23');
  assert.equal(pnlCatchUpWindow(NOW, '2026-09-25').startDate, '2026-09-24');
  assert.equal(pnlCatchUpWindow(NOW, '2026-09-23').endDate, '2026-09-28');
});

test('a brand already current stays on the last three days plus today', () => {
  const window = pnlCatchUpWindow(NOW, '2026-09-28');
  assert.equal(window.startDate, '2026-09-25');
  assert.equal(window.endDate, '2026-09-28');
  assert.equal(window.chunked, false);
});

test('a long outage starts at the 45-day cap and syncs the oldest 10 days', () => {
  const window = pnlCatchUpWindow(NOW, '2026-01-01');
  assert.equal(PNL_CAP_DAYS, 45);
  assert.equal(PNL_CHUNK_DAYS, 10);
  assert.equal(window.startDate, '2026-08-14');
  assert.equal(window.endDate, '2026-08-23');
  assert.equal(window.chunked, true);
  assert.equal(window.untilDate, '2026-08-23T23:59:59.999Z');
});

test('the next run continues at the previous chunk end instead of repeating it', () => {
  const window = pnlCatchUpWindow(NOW, '2026-01-01', '2026-08-23');
  assert.equal(window.startDate, '2026-08-23');
  assert.equal(window.endDate, '2026-09-01');
  assert.equal(window.chunked, true);
});

test('a brand with no daily_pnl rows backfills from the 45-day cap', () => {
  const window = pnlCatchUpWindow(NOW, null);
  assert.equal(window.startDate, '2026-08-14');
  assert.equal(window.chunked, true);
});

test('Toronto days start at local midnight, not UTC midnight', () => {
  const now = new Date('2026-10-09T17:30:00.000Z');
  const window = pnlCatchUpWindow(now, '2026-10-09', null, 'America/Toronto');
  assert.equal(window.startDate, '2026-10-06');
  assert.equal(window.endDate, '2026-10-09');
  assert.equal(window.sinceDate, '2026-10-06T04:00:00.000Z');
  assert.equal(window.untilDate, '2026-10-09T17:30:00.000Z');
  assert.equal(window.chunked, false);
});

test('Chicago before local midnight is still the previous shop day', () => {
  const now = new Date('2026-10-09T04:30:00.000Z');
  const toronto = pnlCatchUpWindow(now, '2026-10-09', null, 'America/Toronto');
  const chicago = pnlCatchUpWindow(now, '2026-10-08', null, 'America/Chicago');
  const utc = pnlCatchUpWindow(now, '2026-10-09', null, 'UTC');
  assert.equal(toronto.startDate, '2026-10-06');
  assert.equal(toronto.sinceDate, '2026-10-06T04:00:00.000Z');
  assert.equal(chicago.startDate, '2026-10-05');
  assert.equal(chicago.sinceDate, '2026-10-05T05:00:00.000Z');
  assert.equal(utc.startDate, '2026-10-06');
  assert.equal(utc.sinceDate, '2026-10-06T00:00:00.000Z');
});

test('Chicago standard time uses the winter offset', () => {
  const now = new Date('2026-01-15T18:00:00.000Z');
  const window = pnlCatchUpWindow(now, '2026-01-15', null, 'America/Chicago');
  assert.equal(window.startDate, '2026-01-12');
  assert.equal(window.sinceDate, '2026-01-12T06:00:00.000Z');
});

test('a chunked Toronto window ends on the last millisecond of the shop day', () => {
  const now = new Date('2026-10-09T17:30:00.000Z');
  const window = pnlCatchUpWindow(now, '2026-01-01', null, 'America/Toronto');
  assert.equal(window.chunked, true);
  assert.equal(window.sinceDate, '2026-08-25T04:00:00.000Z');
  assert.equal(window.endDate, '2026-09-03');
  assert.equal(window.untilDate, '2026-09-04T03:59:59.999Z');
});
