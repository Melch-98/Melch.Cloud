import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyShopifyConnection } from './brand-connection.ts';

test('custom-app brands use the Shopify Admin connection', () => {
  assert.equal(
    classifyShopifyConnection({
      domain: 'fondbonebrothtonics.myshopify.com',
      hasClientCredentials: true,
      hasLiveAdminToken: false,
    }),
    'shopify_admin'
  );
});

test('a shop domain without Shopify credentials is Triple Whale only', () => {
  assert.equal(
    classifyShopifyConnection({
      domain: 'organicjaguar.myshopify.com',
      hasClientCredentials: false,
      hasLiveAdminToken: false,
    }),
    'triple_whale'
  );
});

test('a brand with no shop domain is not connected', () => {
  assert.equal(
    classifyShopifyConnection({
      domain: null,
      hasClientCredentials: false,
      hasLiveAdminToken: false,
    }),
    'none'
  );
});

test('a live install token is Shopify Admin even without custom-app credentials', () => {
  assert.equal(
    classifyShopifyConnection({
      domain: 'installed.myshopify.com',
      hasClientCredentials: false,
      hasLiveAdminToken: true,
    }),
    'shopify_admin'
  );
});
