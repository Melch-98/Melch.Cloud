import assert from 'node:assert/strict';
import crypto from 'crypto';
import { test } from 'node:test';
import { authorizeShopifyWebhook, hmacMatchesSecret } from './webhook-hmac.ts';

function sign(body: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(body, 'utf8').digest('base64');
}

test('accepts a payload signed with the brand custom-app secret', async () => {
  const body = '{"id":1001}';
  const header = sign(body, 'brand-secret');
  const result = await authorizeShopifyWebhook({
    rawBody: body,
    hmacHeader: header,
    shopDomain: 'tallow-twins.myshopify.com',
    appSecret: 'melch-secret',
    loadBrandSecrets: async () => ['brand-secret'],
  });
  assert.deepEqual(result, { ok: true, via: 'brand' });
});

test('rejects a payload signed with a different secret', async () => {
  const body = '{"id":1001}';
  const header = sign(body, 'attacker-secret');
  const result = await authorizeShopifyWebhook({
    rawBody: body,
    hmacHeader: header,
    shopDomain: 'mintier.myshopify.com',
    appSecret: 'melch-secret',
    loadBrandSecrets: async () => ['brand-secret'],
  });
  assert.deepEqual(result, { ok: false, reason: 'invalid_hmac' });
  assert.equal(hmacMatchesSecret(body, header, 'brand-secret'), false);
  assert.equal(hmacMatchesSecret(body, header, 'melch-secret'), false);
});

test('rejects an unsigned payload without reading brand secrets', async () => {
  let lookedUp = false;
  const result = await authorizeShopifyWebhook({
    rawBody: '{}',
    hmacHeader: null,
    shopDomain: 'tallow-twins.myshopify.com',
    appSecret: 'melch-secret',
    loadBrandSecrets: async () => {
      lookedUp = true;
      return ['brand-secret'];
    },
  });
  assert.deepEqual(result, { ok: false, reason: 'missing_hmac' });
  assert.equal(lookedUp, false);
});

test('accepts the Melch.Cloud app secret without a brand lookup', async () => {
  const body = '{"id":2}';
  let lookedUp = false;
  const result = await authorizeShopifyWebhook({
    rawBody: body,
    hmacHeader: sign(body, 'melch-secret'),
    shopDomain: 'installed-store.myshopify.com',
    appSecret: 'melch-secret',
    loadBrandSecrets: async () => {
      lookedUp = true;
      return [];
    },
  });
  assert.deepEqual(result, { ok: true, via: 'app' });
  assert.equal(lookedUp, false);
});

test('does not accept the payload when the brand secret lookup fails', async () => {
  const body = '{"id":3}';
  const result = await authorizeShopifyWebhook({
    rawBody: body,
    hmacHeader: sign(body, 'brand-secret'),
    shopDomain: 'tallow-twins.myshopify.com',
    appSecret: 'melch-secret',
    loadBrandSecrets: async () => {
      throw new Error('database unavailable');
    },
  });
  assert.deepEqual(result, { ok: false, reason: 'lookup_failed' });
});

test('ignores empty secrets', () => {
  const body = '{"id":4}';
  const header = sign(body, 'brand-secret');
  assert.equal(hmacMatchesSecret(body, header, ''), false);
  assert.equal(hmacMatchesSecret(body, header, null), false);
  assert.equal(hmacMatchesSecret(body, '', 'brand-secret'), false);
});
