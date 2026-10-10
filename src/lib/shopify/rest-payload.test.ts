import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shopifyOrderToRow } from './order-row.ts';
import { readShopifyAmount, shopifyProductTags, shopifyProductsFromPayload } from './rest-payload.ts';

test('flat money wins and a missing flat field falls back to shop_money', () => {
  assert.equal(readShopifyAmount('398.00', { shop_money: { amount: '141.99' } }), 398);
  assert.equal(readShopifyAmount(20, { shop_money: { amount: '1.00' } }), 20);
  assert.equal(readShopifyAmount(undefined, { shop_money: { amount: '12.50' } }), 12.5);
  assert.equal(readShopifyAmount('0.00', { shop_money: { amount: '9.00' } }), 0);
  assert.equal(readShopifyAmount(null, null), null);
});

test('order rows keep 2026-04 money whether it is a string, a number, or only a set', () => {
  const row = shopifyOrderToRow('mintier.myshopify.com', 'brand-1', {
    id: 9,
    name: '#1001',
    subtotal_price_set: { shop_money: { amount: '12.50', currency_code: 'USD' } },
    total_price: 20,
    total_discounts: '1.25',
    total_tax_set: { shop_money: { amount: '0.80' } },
  });
  assert.equal(row.subtotal_price, 12.5);
  assert.equal(row.total_price, 20);
  assert.equal(row.total_discounts, 1.25);
  assert.equal(row.total_tax, 0.8);
  assert.equal(row.order_number, '#1001');
});

test('a products page is the products array and a missing list is empty', () => {
  assert.equal(shopifyProductsFromPayload({ products: [{ id: 1 }] }).length, 1);
  assert.deepEqual(shopifyProductsFromPayload({}), []);
  assert.deepEqual(shopifyProductsFromPayload(null), []);
});

test('product tags stay a comma-space split and also accept an array', () => {
  assert.deepEqual(shopifyProductTags('Emotive, Flash Memory, MP3, Music'), [
    'Emotive',
    'Flash Memory',
    'MP3',
    'Music',
  ]);
  assert.deepEqual(shopifyProductTags(''), []);
  assert.deepEqual(shopifyProductTags(['Barnes & Noble', "John's Fav"]), ['Barnes & Noble', "John's Fav"]);
  assert.deepEqual(shopifyProductTags(null), []);
});
