import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pnlPathForBrand, pnlRefreshWindow, selectPnlRefreshBrands, type PnlBrand } from './pnl-targets.ts';

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

test('the refresh window is the last three UTC days plus today', () => {
  const window = pnlRefreshWindow(new Date('2026-09-28T17:30:00.000Z'));
  assert.equal(window.startDate, '2026-09-25');
  assert.equal(window.endDate, '2026-09-28');
  assert.equal(window.sinceDate, '2026-09-25T00:00:00.000Z');
  assert.equal(window.untilDate, '2026-09-28T17:30:00.000Z');
});
