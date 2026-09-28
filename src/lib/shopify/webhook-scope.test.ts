import assert from 'node:assert/strict';
import { test } from 'node:test';
import { missingScopesFromShopifyBody, scopeErrorMessage } from './webhook-scope.ts';

test('names read_orders from the REST merchant-approval error', () => {
  const body = {
    errors: '[API] This action requires merchant approval for read_orders scope.',
  };
  assert.deepEqual(missingScopesFromShopifyBody(body), ['read_orders']);
  const message = scopeErrorMessage(['read_orders'], 403, body);
  assert.match(message, /missing the read_orders scope/);
});

test('names write_webhooks from a GraphQL access-denied error', () => {
  const body = {
    errors: [
      {
        message:
          'Access denied for webhookSubscriptionCreate field. Required access: `write_webhooks` access scope.',
      },
    ],
  };
  assert.deepEqual(missingScopesFromShopifyBody(body), ['write_webhooks']);
});

test('does not invent a scope for an unrelated 422', () => {
  const body = { errors: { address: ['for this topic has already been taken'] } };
  assert.deepEqual(missingScopesFromShopifyBody(body), []);
  const message = scopeErrorMessage([], 403, body);
  assert.match(message, /did not name a scope/);
});
