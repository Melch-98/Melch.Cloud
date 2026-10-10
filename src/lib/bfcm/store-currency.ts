import { normalizeCurrencyCode, resolveReportingCurrency, toReportingCurrency } from '@/lib/currency';

/**
 * Store currency for the command center.
 * Active brands have no shopify_stores row, so shop_info is empty and the old
 * resolver fell through to USD. Daily P&L already tags daily_pnl.currency with
 * the Shopify settlement currency (Mintier USD, Tallow Twins CAD).
 */
export function resolveBfcmStoreCurrency(input: {
  pnlCurrency?: string | null;
  shopCurrency?: string | null;
}): { code: string; source: 'daily_pnl' | 'shop' | 'default_usd' } {
  const tagged = (input.pnlCurrency || '').trim();
  if (tagged) return { code: normalizeCurrencyCode(tagged), source: 'daily_pnl' };
  const resolved = resolveReportingCurrency({ shopCurrency: input.shopCurrency });
  if (resolved.source === 'shop') return { code: resolved.code, source: 'shop' };
  return { code: 'USD', source: 'default_usd' };
}

/** AUTO displays the store currency. An explicit ISO code still overrides it. */
export function resolveBfcmDisplayCurrency(input: { requested: string; storeCurrency: string }): string {
  return resolveReportingCurrency({
    override: input.requested,
    shopCurrency: input.storeCurrency,
  }).code;
}

export interface PacingMoneyInput {
  storeCurrency: string;
  displayCurrency: string;
  metaCurrency: string | null;
  googleCurrency: string | null;
  fxRates: Record<string, number>;
  /** Shopify gross already in the store currency: today, L7 daily average, same-day last year. */
  todayRevenue: number;
  todayNcRevenue: number;
  l7Revenue: number;
  sameDayRevenue: number;
  /** Live ad-account spend, still in each account's currency. */
  metaSpend: number;
  googleSpend: number;
  /** daily_pnl figures, already converted into the store currency at sync. */
  amerNcRevenue: number;
  amerMetaSpend: number;
  amerGoogleSpend: number;
  amerOtherSpend: number;
}

export interface PacingMoney {
  todayRevenue: number;
  todayNcRevenue: number;
  l7Revenue: number;
  sameDayRevenue: number;
  metaSpend: number;
  googleSpend: number;
  amerNcRevenue: number;
  amerMetaSpend: number;
  amerGoogleSpend: number;
  amerOtherSpend: number;
}

/**
 * Sales and the aMER strip move from the store currency into the display currency.
 * Live Meta and Google spend move from their own account currencies.
 */
export function pacingDisplayFigures(input: PacingMoneyInput): PacingMoney {
  const display = input.displayCurrency;
  const rates = input.fxRates;
  const fromStore = (amount: number) => toReportingCurrency(amount, input.storeCurrency, display, rates);
  const fromAccount = (amount: number, account: string | null) =>
    toReportingCurrency(amount, account || input.storeCurrency, display, rates);
  return {
    todayRevenue: fromStore(input.todayRevenue),
    todayNcRevenue: fromStore(input.todayNcRevenue),
    l7Revenue: fromStore(input.l7Revenue),
    sameDayRevenue: fromStore(input.sameDayRevenue),
    metaSpend: fromAccount(input.metaSpend, input.metaCurrency),
    googleSpend: fromAccount(input.googleSpend, input.googleCurrency),
    amerNcRevenue: fromStore(input.amerNcRevenue),
    amerMetaSpend: fromStore(input.amerMetaSpend),
    amerGoogleSpend: fromStore(input.amerGoogleSpend),
    amerOtherSpend: fromStore(input.amerOtherSpend),
  };
}
