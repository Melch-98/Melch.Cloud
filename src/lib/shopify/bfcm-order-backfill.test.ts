import { describe, expect, it } from 'vitest';
import {
  lastYearBfcmBackfillAction,
  lastYearBfcmOrderRange,
} from '@/lib/shopify/bfcm-order-backfill';

describe('last year BFCM order range', () => {
  it('is Nov 15 through Dec 5 of the previous year', () => {
    expect(lastYearBfcmOrderRange(new Date('2026-11-25T15:00:00Z'))).toEqual({
      year: 2025,
      start: '2025-11-15',
      end: '2025-12-05',
    });
    expect(lastYearBfcmOrderRange(new Date('2027-01-02T03:00:00Z')).year).toBe(2026);
  });
});

describe('last year BFCM backfill eligibility', () => {
  const empty = { ordersInRange: 0, resumeCursor: false, pullStarted: false, pnlPending: false };

  it('pulls a Shopify Admin brand with read_all_orders and no orders in the range', () => {
    expect(lastYearBfcmBackfillAction({
      connection: 'shopify_admin',
      tokenScopes: 'read_orders,read_all_orders',
      ...empty,
    })).toEqual({ action: 'pull', reason: 'empty_range' });
  });

  it('skips Tallow and Mintier when the token lacks read_all_orders', () => {
    expect(lastYearBfcmBackfillAction({
      connection: 'shopify_admin',
      tokenScopes: 'read_orders,read_products',
      ...empty,
    })).toEqual({ action: 'skip', reason: 'missing_read_all_orders' });
    expect(lastYearBfcmBackfillAction({
      connection: 'shopify_admin',
      tokenScopes: 'read_orders',
      ordersInRange: 40,
      resumeCursor: false,
      pullStarted: false,
      pnlPending: false,
    })).toEqual({ action: 'skip', reason: 'missing_read_all_orders' });
  });

  it('skips a range that already has orders, and still resumes a truncated pull', () => {
    expect(lastYearBfcmBackfillAction({
      connection: 'shopify_admin',
      tokenScopes: 'read_all_orders',
      ordersInRange: 3,
      resumeCursor: false,
      pullStarted: false,
      pnlPending: false,
    })).toEqual({ action: 'skip', reason: 'range_has_orders' });
    expect(lastYearBfcmBackfillAction({
      connection: 'shopify_admin',
      tokenScopes: 'read_all_orders',
      ordersInRange: 3,
      resumeCursor: true,
      pullStarted: false,
      pnlPending: false,
    })).toEqual({ action: 'pull', reason: 'resume' });
    expect(lastYearBfcmBackfillAction({
      connection: 'shopify_admin',
      tokenScopes: 'read_all_orders',
      ordersInRange: 3,
      resumeCursor: false,
      pullStarted: true,
      pnlPending: false,
    })).toEqual({ action: 'pull', reason: 'resume' });
  });

  it('rebuilds daily_pnl when the pull finished and the rebuild was deferred', () => {
    expect(lastYearBfcmBackfillAction({
      connection: 'shopify_admin',
      tokenScopes: 'read_all_orders',
      ordersInRange: 12,
      resumeCursor: false,
      pullStarted: false,
      pnlPending: true,
    })).toEqual({ action: 'rebuild_only', reason: 'pnl_pending' });
  });

  it('skips Triple Whale and brands with no Shopify store', () => {
    expect(lastYearBfcmBackfillAction({
      connection: 'triple_whale',
      tokenScopes: '',
      ...empty,
    })).toEqual({ action: 'skip', reason: 'not_shopify_admin' });
    expect(lastYearBfcmBackfillAction({
      connection: 'none',
      tokenScopes: 'read_all_orders',
      ...empty,
    })).toEqual({ action: 'skip', reason: 'not_shopify_admin' });
  });
});
