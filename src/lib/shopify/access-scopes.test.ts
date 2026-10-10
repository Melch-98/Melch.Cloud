import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  fetchGrantedScopeHandles,
  handlesFromAccessScopes,
  hasReadAllOrdersScope,
  logGrantedScopeHandles,
} from './access-scopes.ts';

test('scope handles come from access_scopes and read_all_orders is a handle match', () => {
  const handles = handlesFromAccessScopes({
    access_scopes: [{ handle: 'read_orders' }, { handle: ' read_all_orders ' }, { handle: '' }, {}],
  });
  assert.deepEqual(handles, ['read_orders', 'read_all_orders']);
  assert.equal(hasReadAllOrdersScope('read_orders, read_all_orders'), true);
  assert.equal(hasReadAllOrdersScope('read_orders,read_products'), false);
  assert.deepEqual(handlesFromAccessScopes({}), []);
});

test('access scope lookup sends the token as a header and logs handles only', async () => {
  const token = 'shpat_should_not_appear';
  const logs: string[] = [];
  const warnings: string[] = [];
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalFetch = globalThis.fetch;
  console.log = ((msg?: unknown) => {
    logs.push(String(msg));
  }) as typeof console.log;
  console.warn = ((msg?: unknown) => {
    warnings.push(String(msg));
  }) as typeof console.warn;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    assert.equal(String(url), 'https://mintier.myshopify.com/admin/oauth/access_scopes.json');
    assert.equal(String(url).includes(token), false);
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('X-Shopify-Access-Token'), token);
    return new Response(
      JSON.stringify({
        access_scopes: [{ handle: 'read_orders' }, { handle: 'read_all_orders' }],
      }),
      { status: 200 }
    );
  }) as typeof fetch;

  try {
    const handles = await fetchGrantedScopeHandles('mintier.myshopify.com', token);
    assert.deepEqual(handles, ['read_orders', 'read_all_orders']);
    await logGrantedScopeHandles('Mintier', 'mintier.myshopify.com', token);
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    globalThis.fetch = originalFetch;
  }

  assert.equal(logs.length, 1);
  assert.equal(logs[0], 'Shopify granted scopes for Mintier (mintier.myshopify.com): read_orders,read_all_orders');
  assert.equal(logs[0].includes(token), false);
  assert.equal(warnings.length, 0);
});
