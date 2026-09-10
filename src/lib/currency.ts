/**
 * Shared reporting-currency + FX helpers.
 *
 * Model: one reporting currency per brand = Shopify/store settlement currency.
 * Meta/Google spend in a different native currency is converted into reporting
 * before MER / aMER / CM (and before persistence into daily_pnl when syncing).
 *
 * FX source: open.er-api.com USD pivot (same as BFCM / Geo). rates[cur] =
 * units of `cur` per 1 USD. value_reporting = value_native * rates[reporting] / rates[native].
 */

export const STATIC_FX_FALLBACK: Record<string, number> = {
  USD: 1,
  CAD: 1.38,
  GBP: 0.73,
  EUR: 0.86,
  AUD: 1.55,
  NZD: 1.7,
};

const FX_CACHE: { rates: Record<string, number>; ts: number } = { rates: {}, ts: 0 };
const FX_TTL_MS = 60 * 60 * 1000;

export function normalizeCurrencyCode(code?: string | null): string {
  const c = (code || '').trim().toUpperCase();
  if (!c || c.length !== 3) return 'USD';
  return c;
}

/** Fetch USD-pivot FX rates (cached 1h). Never throws — falls back to static. */
export async function getFxRates(): Promise<Record<string, number>> {
  if (Date.now() - FX_CACHE.ts < FX_TTL_MS && Object.keys(FX_CACHE.rates).length > 0) {
    return FX_CACHE.rates;
  }
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD');
    if (res.ok) {
      const d = (await res.json()) as { rates?: Record<string, number> };
      if (d?.rates && typeof d.rates.USD === 'number') {
        FX_CACHE.rates = d.rates;
        FX_CACHE.ts = Date.now();
        return FX_CACHE.rates;
      }
    }
  } catch {
    /* static fallback */
  }
  FX_CACHE.rates = { ...STATIC_FX_FALLBACK };
  FX_CACHE.ts = Date.now();
  return FX_CACHE.rates;
}

/**
 * Convert an amount from `native` currency into `reporting` currency.
 * If either rate is missing, returns the original amount (safe no-op).
 */
export function toReportingCurrency(
  amount: number,
  native: string | null | undefined,
  reporting: string | null | undefined,
  rates: Record<string, number>
): number {
  const from = normalizeCurrencyCode(native);
  const to = normalizeCurrencyCode(reporting);
  if (!Number.isFinite(amount) || from === to) return amount;
  const rNative = rates[from];
  const rBase = rates[to];
  if (!rNative || !rBase) return amount;
  return amount * (rBase / rNative);
}

/** Alias used by geo/BFCM naming. */
export const toBase = toReportingCurrency;

export interface ReportingCurrencySources {
  /** Shopify Admin shop.currency / shop_info.currency */
  shopCurrency?: string | null;
  /** Currencies observed on orders (majority wins) */
  orderCurrencies?: Array<string | null | undefined>;
  /** Optional overrides / fallbacks */
  metaCurrency?: string | null;
  googleCurrency?: string | null;
  /** Explicit override (e.g. query param) — only used when valid */
  override?: string | null;
}

/**
 * Resolve one reporting currency for a brand without inventing values.
 * Priority: override → shop settlement → majority order currency → Meta → Google → USD.
 */
export function resolveReportingCurrency(sources: ReportingCurrencySources): {
  code: string;
  source: 'override' | 'shop' | 'orders' | 'meta' | 'google' | 'default_usd';
} {
  const override = sources.override ? normalizeCurrencyCode(sources.override) : '';
  if (sources.override && sources.override.toUpperCase() !== 'AUTO' && override) {
    return { code: override, source: 'override' };
  }

  if (sources.shopCurrency) {
    return { code: normalizeCurrencyCode(sources.shopCurrency), source: 'shop' };
  }

  const counts = new Map<string, number>();
  for (const raw of sources.orderCurrencies || []) {
    if (!raw) continue;
    const c = normalizeCurrencyCode(raw);
    counts.set(c, (counts.get(c) || 0) + 1);
  }
  if (counts.size > 0) {
    let best = 'USD';
    let n = -1;
    Array.from(counts.entries()).forEach(([c, count]) => {
      if (count > n) {
        best = c;
        n = count;
      }
    });
    return { code: best, source: 'orders' };
  }

  if (sources.metaCurrency) {
    return { code: normalizeCurrencyCode(sources.metaCurrency), source: 'meta' };
  }
  if (sources.googleCurrency) {
    return { code: normalizeCurrencyCode(sources.googleCurrency), source: 'google' };
  }

  return { code: 'USD', source: 'default_usd' };
}

/** Extract currency from Shopify shop_info JSON (shop.json shape). */
export function currencyFromShopInfo(shopInfo: unknown): string | null {
  if (!shopInfo || typeof shopInfo !== 'object') return null;
  const s = shopInfo as Record<string, unknown>;
  const cur = s.currency ?? s.currencyCode ?? s.currency_code;
  if (typeof cur === 'string' && cur.trim()) return normalizeCurrencyCode(cur);
  return null;
}
