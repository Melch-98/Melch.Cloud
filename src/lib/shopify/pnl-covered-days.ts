import type { DayBucket } from './pnl-days.ts';
import { roundMoney } from './upsert-daily-pnl.ts';

export const ZERO_DAY_BUCKET: DayBucket = {
  nc_orders: 0,
  nc_revenue: 0,
  rc_orders: 0,
  rc_revenue: 0,
  gross_sales: 0,
  discounts: 0,
  refunds: 0,
  taxes: 0,
  shipping: 0,
};

/** A source that was not configured, or whose fetch failed, is ok: false. */
export type SpendSource = {
  ok: boolean;
  byDay: Map<string, number>;
};

/**
 * Write spend for a fully covered day. A successful fetch writes 0 when that
 * day is absent from the result. A failed or unattempted fetch omits the
 * column so an existing value is left alone.
 */
export function spendFieldsForCoveredDay(
  date: string,
  meta: SpendSource,
  google: SpendSource
): { meta_spend?: number; google_spend?: number } {
  return {
    ...(meta.ok ? { meta_spend: roundMoney(meta.byDay.get(date) ?? 0) } : {}),
    ...(google.ok ? { google_spend: roundMoney(google.byDay.get(date) ?? 0) } : {}),
  };
}

export function orderDerivedFields(bucket: DayBucket) {
  return {
    nc_orders: bucket.nc_orders,
    nc_revenue: roundMoney(bucket.nc_revenue),
    rc_orders: bucket.rc_orders,
    rc_revenue: roundMoney(bucket.rc_revenue),
    gross_sales: roundMoney(bucket.gross_sales),
    discounts: roundMoney(bucket.discounts),
    refunds: roundMoney(bucket.refunds),
    taxes: roundMoney(bucket.taxes),
    shipping: roundMoney(bucket.shipping),
  };
}

export type CoveredPnlRow = {
  brand_id: string;
  date: string;
  currency: string;
  synced_at: string;
  nc_orders: number;
  nc_revenue: number;
  rc_orders: number;
  rc_revenue: number;
  gross_sales: number;
  discounts: number;
  refunds: number;
  taxes: number;
  shipping: number;
  meta_spend?: number;
  google_spend?: number;
};

/**
 * One daily_pnl row per fully covered shop-local day. Days with no orders
 * still write explicit zeros. A refund-only bucket is kept.
 */
export function buildFullCoveredDayRows(input: {
  brandId: string;
  currency: string;
  syncedAt: string;
  coveredDays: string[];
  buckets: Map<string, DayBucket>;
  meta: SpendSource;
  google: SpendSource;
}): CoveredPnlRow[] {
  return input.coveredDays.map((date) => ({
    brand_id: input.brandId,
    date,
    currency: input.currency,
    synced_at: input.syncedAt,
    ...orderDerivedFields(input.buckets.get(date) ?? ZERO_DAY_BUCKET),
    ...spendFieldsForCoveredDay(date, input.meta, input.google),
  }));
}

export type SpendOnlyPnlRow = {
  brand_id: string;
  date: string;
  currency: string;
  synced_at: string;
  meta_spend?: number;
  google_spend?: number;
};

/**
 * Spend columns only. Order columns are omitted so commerce totals stay.
 * Neither source succeeding means there is nothing to write.
 */
export function buildSpendOnlyCoveredDayRows(input: {
  brandId: string;
  currency: string;
  syncedAt: string;
  coveredDays: string[];
  meta: SpendSource;
  google: SpendSource;
}): SpendOnlyPnlRow[] {
  if (!input.meta.ok && !input.google.ok) return [];
  return input.coveredDays.map((date) => ({
    brand_id: input.brandId,
    date,
    currency: input.currency,
    synced_at: input.syncedAt,
    ...spendFieldsForCoveredDay(date, input.meta, input.google),
  }));
}
