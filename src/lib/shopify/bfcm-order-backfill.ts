import { hasReadAllOrdersScope } from '@/lib/shopify/access-scopes';

export const LAST_YEAR_BFCM_ORDER_START = '11-15';
export const LAST_YEAR_BFCM_ORDER_END = '12-05';

export type BfcmBackfillAction = 'skip' | 'pull' | 'rebuild_only';

export type BfcmBackfillReason =
  | 'not_shopify_admin'
  | 'missing_read_all_orders'
  | 'range_has_orders'
  | 'resume'
  | 'empty_range'
  | 'pnl_pending';

/**
 * Last year's BFCM order window: Nov 15 through Dec 5 of the previous UTC year.
 * The shop timezone is applied when the range is queried, not here.
 */
export function lastYearBfcmOrderRange(now: Date): { year: number; start: string; end: string } {
  const year = now.getUTCFullYear() - 1;
  return {
    year,
    start: `${year}-${LAST_YEAR_BFCM_ORDER_START}`,
    end: `${year}-${LAST_YEAR_BFCM_ORDER_END}`,
  };
}

export function bfcmPnlPendingKey(brandId: string, startDate: string, endDate: string): string {
  return `bfcm_ly_pnl_pending:${brandId}:${startDate}:${endDate}`;
}

export function bfcmPullStartedKey(brandId: string, startDate: string, endDate: string): string {
  return `bfcm_ly_pull:${brandId}:${startDate}:${endDate}`;
}

/**
 * Who gets the one-time last-year pull.
 * A Shopify Admin token without read_all_orders is skipped even when the range
 * is empty (Mintier already has CSV rows; Tallow has neither the scope nor a full year).
 * A resume cursor, an interrupted pull, or a finished pull waiting on daily_pnl
 * is not treated as "already has orders".
 */
export function lastYearBfcmBackfillAction(input: {
  connection: 'shopify_admin' | 'triple_whale' | 'none';
  tokenScopes: string;
  ordersInRange: number;
  resumeCursor: boolean;
  pullStarted: boolean;
  pnlPending: boolean;
}): { action: BfcmBackfillAction; reason: BfcmBackfillReason } {
  if (input.connection !== 'shopify_admin') {
    return { action: 'skip', reason: 'not_shopify_admin' };
  }
  if (!hasReadAllOrdersScope(input.tokenScopes)) {
    return { action: 'skip', reason: 'missing_read_all_orders' };
  }
  if (input.pnlPending) return { action: 'rebuild_only', reason: 'pnl_pending' };
  if (input.resumeCursor || input.pullStarted) return { action: 'pull', reason: 'resume' };
  if (input.ordersInRange > 0) return { action: 'skip', reason: 'range_has_orders' };
  return { action: 'pull', reason: 'empty_range' };
}
