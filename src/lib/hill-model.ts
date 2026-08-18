// ─── Hill Saturation Model — shared by efficiency curve + forecast pages ───
//
// Fits a Hill curve  rev = V·sʰ / (Kʰ + sʰ)  to (blended ad spend → nc_revenue)
// and finds the optimal spend level for a given business goal.
//
// Single source of truth. If you change the math here, both the Marginal
// Efficiency Curve page and the Forecast page's model section update together.

export interface DailyPoint {
  date: string;
  spend: number;
  rev: number;
  ncRev: number;
  orders: number;
  daysBack: number;
}

export interface HillFit {
  V: number;
  K: number;
  h: number;
  r2: number;
}

export interface GoalDef {
  key: string;
  label: string;
  desc: string;
  tooltip: string;
}

// ─── Hill Model Math ────────────────────────────────────────────

export function hillRev(s: number, V: number, K: number, h: number): number {
  if (s <= 0) return 0;
  return (V * Math.pow(s, h)) / (Math.pow(K, h) + Math.pow(s, h));
}

export function hillMargRoas(s: number, V: number, K: number, h: number): number {
  if (s <= 0) return Infinity;
  const sh = Math.pow(s, h), Kh = Math.pow(K, h);
  return (V * h * Kh * Math.pow(s, h - 1)) / Math.pow(Kh + sh, 2);
}

// ─── Hill Curve Fitting (two-pass grid search) ──────────────────

export const MIN_DATA_POINTS = 14;

export function fitHillCurve(dailyPoints: DailyPoint[], halfLifeDays: number): HillFit {
  if (dailyPoints.length < MIN_DATA_POINTS) return { V: 1, K: 1, h: 1, r2: 0 };

  // Aggregate daily points into weekly buckets. Meta re-optimizes within a
  // single day, so daily spend-vs-revenue is dominated by intra-day noise;
  // weekly buckets recover the underlying saturation curve (audit 2.3).
  const buckets = new Map<number, { spend: number; rev: number; orders: number; daysBack: number }>();
  for (const p of dailyPoints) {
    const wk = Math.floor(p.daysBack / 7);
    const b = buckets.get(wk);
    if (b) {
      b.spend += p.spend;
      b.rev += p.rev;
      b.orders += p.orders;
      b.daysBack = Math.min(b.daysBack, p.daysBack);
    } else {
      buckets.set(wk, { spend: p.spend, rev: p.rev, orders: p.orders, daysBack: p.daysBack });
    }
  }
  const points: DailyPoint[] = Array.from(buckets.values())
    .sort((a, b) => a.daysBack - b.daysBack)
    .map(b => ({ date: '', spend: b.spend, rev: b.rev, ncRev: b.rev, orders: b.orders, daysBack: b.daysBack }));
  if (points.length < 6) return { V: 1, K: 1, h: 1, r2: 0 };

  const maxS = Math.max(...points.map(p => p.spend));
  const maxR = Math.max(...points.map(p => p.rev));
  if (maxS === 0 || maxR === 0) return { V: 1, K: 1, h: 1, r2: 0 };

  const weights = points.map(p => Math.pow(0.5, p.daysBack / halfLifeDays));

  function sse(V: number, K: number, h: number) {
    let s = 0, tw = 0;
    for (let i = 0; i < points.length; i++) {
      const pred = hillRev(points[i].spend, V, K, h);
      const err = points[i].rev - pred;
      s += weights[i] * err * err;
      tw += weights[i];
    }
    return s / tw;
  }

  // Coarse grid
  let bestV = 1, bestK = 1, bestH = 1, bestSSE = Infinity;
  for (let vi = 1; vi <= 16; vi++) {
    const V = maxR * 0.5 * vi;
    for (let ki = 1; ki <= 16; ki++) {
      const K = maxS * 0.1 * ki;
      for (let hi = 1; hi <= 8; hi++) {
        const h = 0.3 + hi * 0.3;
        const e = sse(V, K, h);
        if (e < bestSSE) { bestSSE = e; bestV = V; bestK = K; bestH = h; }
      }
    }
  }

  // Fine grid around best
  const fV = bestV, fK = bestK, fH = bestH;
  const vStep = maxR * 0.5 * 0.8;
  const kStep = maxS * 0.1 * 0.8;
  for (let vi = -5; vi <= 5; vi++) {
    const V = Math.max(1, fV + vi * vStep / 5);
    for (let ki = -5; ki <= 5; ki++) {
      const K = Math.max(1, fK + ki * kStep / 5);
      for (let hi = -3; hi <= 3; hi++) {
        const h = Math.max(0.3, fH + hi * 0.1);
        const e = sse(V, K, h);
        if (e < bestSSE) { bestSSE = e; bestV = V; bestK = K; bestH = h; }
      }
    }
  }

  // R²
  let ssTot = 0, ssRes = 0;
  const wSum = weights.reduce((a, b) => a + b, 0);
  const meanR = points.reduce((s, p, i) => s + weights[i] * p.rev, 0) / wSum;
  for (let i = 0; i < points.length; i++) {
    const pred = hillRev(points[i].spend, bestV, bestK, bestH);
    ssRes += weights[i] * (points[i].rev - pred) ** 2;
    ssTot += weights[i] * (points[i].rev - meanR) ** 2;
  }
  const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot;

  // Buckets aggregate ~7 days of spend/revenue, so V and K come out in WEEKLY
  // units. Rescale to daily so downstream code that treats the curve as
  // "daily spend → daily revenue" gets correct magnitudes. The Hill curve is
  // scale-equivariant (hillRev(s/7, V/7, K/7, h) = hillRev(s, V, K, h)/7), so
  // V/7 and K/7 fit the daily points exactly and R² is unchanged.
  return { V: bestV / 7, K: bestK / 7, h: bestH, r2 };
}

// ─── Optimal Spend Finder ───────────────────────────────────────

// Search is capped at this multiple of the observed max daily spend so a weak
// fit can never recommend spending far beyond what the data supports.
export const MAX_SPEND_EXTRAPOLATION_MULT = 3;

export const GOALS: GoalDef[] = [
  { key: 'maxCM', label: 'Max CM Today', desc: 'Maximize contribution margin today',
    tooltip: 'Finds the spend level where each additional dollar costs more than the gross profit it generates. Best for brands optimizing short-term profitability.' },
  { key: 'max3m', label: 'Max 3m CM', desc: 'Max CM with 3-month LTV',
    tooltip: 'Accounts for repeat purchases over 3 months, so it recommends spending more aggressively since each customer is worth more than their first order.' },
  { key: 'max6m', label: 'Max 6m CM', desc: 'Max CM with 6-month LTV',
    tooltip: 'Uses 6-month customer lifetime value. Higher LTV means you can afford higher CPAs, pushing the optimal spend up.' },
  { key: 'max12m', label: 'Max 12m CM', desc: 'Max CM with 12-month LTV',
    tooltip: 'Most aggressive — uses full 12-month LTV. Good for brands with strong retention and repeat purchase rates.' },
  { key: 'targetRoas', label: 'Target ROAS', desc: 'Spend to target ROAS',
    tooltip: 'Finds the maximum spend level where overall ROAS stays at or above your target. Useful for maintaining a specific efficiency floor.' },
];

export interface Params {
  vc: number; nc: number; l3: number; l6: number; l12: number;
  hl: number; tr: number; curSpend: number;
  merchantFeePct: number;   // % of revenue (merchant/processing fees)
  fulfillmentPerOrder: number; // $/order fulfillment cost
  dateRange: '30d' | '90d' | '180d' | '365d' | 'all';
}

export function findOptimalSpend(
  V: number, K: number, h: number,
  goal: string, params: Params, effMargin: number,
  maxObservedSpend?: number
): number {
  // Clamp the search ceiling so the recommendation can't extrapolate far
  // beyond the observed spend range (defaults to V·2 when no bound is given).
  const cap = maxObservedSpend && maxObservedSpend > 0
    ? maxObservedSpend * MAX_SPEND_EXTRAPOLATION_MULT
    : V * 2;
  const maxSearch = Math.min(V * 2, cap);
  const steps = 500;

  function cmAt(s: number, ltvMult: number) {
    const rev = hillRev(s, V, K, h);
    return rev * effMargin * ltvMult - s;
  }

  function bruteMax(fn: (s: number) => number) {
    let bestS = 0, bestVal = -Infinity;
    for (let i = 1; i <= steps; i++) {
      const s = maxSearch * i / steps;
      const v = fn(s);
      if (v > bestVal) { bestVal = v; bestS = s; }
    }
    return bestS;
  }

  switch (goal) {
    case 'maxCM': return bruteMax(s => cmAt(s, 1));
    case 'max3m': return bruteMax(s => cmAt(s, params.l3));
    case 'max6m': return bruteMax(s => cmAt(s, params.l6));
    case 'max12m': return bruteMax(s => cmAt(s, params.l12));
    case 'targetRoas': {
      for (let i = 1; i <= steps; i++) {
        const s = maxSearch * i / steps;
        const rev = hillRev(s, V, K, h);
        if (s > 0 && rev / s <= params.tr) return s;
      }
      return maxSearch;
    }
    default: return bruteMax(s => cmAt(s, 1));
  }
}

// Effective margin matching the P&L's kbContribution: subtract merchant fee
// (% of revenue) and fulfillment ($/order ÷ AOV). AOV = nc_revenue / nc_orders.
export function computeEffMargin(
  grossMarginPct: number,
  merchantFeePct: number,
  fulfillmentPerOrder: number,
  aov: number
): number {
  const grossMargin = grossMarginPct / 100;
  const fulfillmentRate = aov > 0 ? fulfillmentPerOrder / aov : 0;
  return grossMargin - merchantFeePct / 100 - fulfillmentRate;
}
