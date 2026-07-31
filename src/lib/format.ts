// ─── Currency-aware formatters ──────────────────────────────────
// The app serves brands whose Meta ad accounts run in different
// currencies (USD, CAD, ...). Every analytics page previously
// hardcoded "$" — this factory builds formatters for the account's
// actual currency (returned by /api/meta-insights as `currency`).

export interface Fmt {
  /** Full currency, 2 decimals: CA$1,234.56 */
  currencyFull: (v: number) => string;
  /** Compact currency: CA$1.2k above 1000, else full */
  currency: (v: number) => string;
  /** Compact above 10k (used in dense tables) */
  currencyShort: (v: number) => string;
  /** Percentage with 2 decimals from a 0-100 value: 1.23% */
  pct: (v: number) => string;
  /** Ratio multiple: 2.41 */
  x: (v: number) => string;
  /** Compact number: 1.2k */
  num: (v: number) => string;
  /** Full number, no decimals: 1,234 */
  numFull: (v: number) => string;
  /** Percentage from a 0-1 ratio, 0 decimals: 42% */
  pctRatio: (v: number) => string;
  /** Percentage from a 0-1 ratio, 2 decimals: 42.31% */
  pctRatioDetail: (v: number) => string;
  /** The currency symbol in use (e.g. "$", "CA$") */
  symbol: string;
  /** ISO currency code in use */
  code: string;
}

function symbolFor(code: string): string {
  try {
    const parts = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: code,
    }).formatToParts(1);
    return parts.find((p) => p.type === 'currency')?.value ?? '$';
  } catch {
    return '$';
  }
}

export function makeFmt(currencyCode?: string | null): Fmt {
  const code = (currencyCode || 'USD').toUpperCase();
  let full: Intl.NumberFormat;
  try {
    full = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  } catch {
    full = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  const symbol = symbolFor(code);

  const currencyFull = (v: number) => full.format(v);

  return {
    currencyFull,
    currency: (v: number) =>
      v >= 1000 ? `${symbol}${(v / 1000).toFixed(1)}k` : currencyFull(v),
    currencyShort: (v: number) =>
      v >= 10000 ? `${symbol}${(v / 1000).toFixed(1)}k` : currencyFull(v),
    pct: (v: number) => `${v.toFixed(2)}%`,
    x: (v: number) => v.toFixed(2),
    num: (v: number) =>
      v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v)),
    numFull: (v: number) =>
      v.toLocaleString('en-US', { maximumFractionDigits: 0 }),
    pctRatio: (v: number) => `${(v * 100).toFixed(0)}%`,
    pctRatioDetail: (v: number) => `${(v * 100).toFixed(2)}%`,
    symbol,
    code,
  };
}

/** Default USD formatters for initial render before the API responds. */
export const DEFAULT_FMT: Fmt = makeFmt('USD');
