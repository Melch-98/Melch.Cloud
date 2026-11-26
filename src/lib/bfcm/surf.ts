/**
 * Surf tracker view model.
 * Pure. The route and the page pass numbers they already fetched.
 * A missing source is `unavailable` or `absent`. It is never a zero.
 */

/** A settled hour started at least this many hours ago. */
export const META_SETTLE_AGE_HOURS = 3;

/**
 * Remaining Meta spend still expected, as a fraction of spend already reported.
 * Index is the hour's age. Age 0 is the open hour, age 1 is the previous hour.
 * +27% / +10% / +1% is the Data Druid Surf default.
 * It is not measured from this brand. Age 3 and older is final, so the fraction is 0.
 */
export const META_BACKFILL_REMAINING_BY_AGE = [0.27, 0.1, 0.01] as const;

/** Day ROAS and the last settled hour must both clear this multiple of target to PUSH. */
export const PUSH_MULTIPLE = 1.05;

/** Either the day or the last settled hour below this multiple of target is a PULL. */
export const PULL_MULTIPLE = 0.85;

export const SESSIONS_REASON =
  'Sessions are unavailable. Melch.Cloud has no session source connected.';

export const CVR_REASON =
  'Conversion rate is unavailable. It needs sessions, and Melch.Cloud has no session source.';

export const GOOGLE_BACKFILL_REASON =
  'Google backfill is unavailable. This app has no documented Google spend-backfill curve.';

export const EVEN_SPLIT_REASON =
  'Planned-by-now splits the day plan evenly across 24 shop hours. There is no stored hourly plan.';

export type ChannelState = 'ready' | 'unavailable' | 'absent';

export type Figure =
  | { status: 'value'; value: number }
  | { status: 'unavailable'; reason: string }
  | { status: 'no_plan'; reason: string }
  | { status: 'blank' };

export type Tone = 'green' | 'red' | 'neutral';

export type BudgetCall = 'HOLD' | 'PUSH' | 'PULL' | 'NO_PLAN' | 'NO_CALL';

export interface DayPlan {
  spendBudget: number | null;
  metaSpendBudget: number | null;
  googleSpendBudget: number | null;
  revenueGoal: number | null;
  blendedRoasTarget: number | null;
  metaRoasTarget: number | null;
  googleRoasTarget: number | null;
}

export interface SurfHourInput {
  hour: number;
  metaSpend: number | null;
  googleSpend: number | null;
  sales: number | null;
  orders: number | null;
  newOrders: number | null;
}

export interface SurfInput {
  nowHour: number;
  nowMinute: number;
  metaState: ChannelState;
  googleState: ChannelState;
  /** `unavailable` covers no shop and a failed order read. The reason says which. */
  salesState: 'ready' | 'unavailable';
  salesReason: string;
  metaReason: string;
  googleReason: string;
  /** False for Triple Whale, which does not split new and returning. */
  customerSplit: boolean;
  hours: SurfHourInput[];
  plan: DayPlan | null;
}

export interface Recommendation {
  call: BudgetCall;
  settledHour: number | null;
  settledRoas: number | null;
  dayRoas: number | null;
  target: number | null;
  pushAt: number | null;
  pullAt: number | null;
  headline: string;
  detail: string;
  siteNote: string;
}

export interface KpiCardModel {
  id: 'spend' | 'meta' | 'google' | 'roas';
  label: string;
  value: Figure;
  plannedByNow: Figure;
  dayPlan: Figure;
  /** Actual divided by the day plan, or ROAS divided by target. Null when that plan is missing. */
  progress: number | null;
  deltaPct: number | null;
  deltaLabel: string;
  tone: Tone;
}

export interface HourRow {
  hour: number;
  label: string;
  settled: 'live' | 'settling' | 'final' | 'upcoming';
  settledLabel: string;
  metaSpend: Figure;
  googleSpend: Figure;
  spend: Figure;
  sales: Figure;
  roas: Figure;
  roasTone: Tone;
  expectedFinalRoas: Figure;
  expectedFinalIsEstimate: boolean;
  trendingRoas: Figure;
  trendingTone: Tone;
  orders: Figure;
  newPct: Figure;
  aov: Figure;
  sessions: Figure;
  cvr: Figure;
}

export interface ChartSeries {
  available: boolean;
  reason: string | null;
  soFar: number | null;
  planByNow: number | null;
  pacePct: number | null;
  dayPlan: number | null;
  points: { hour: number; label: string; actual: number | null; plan: number | null }[];
}

export interface SurfView {
  recommendation: Recommendation;
  kpis: KpiCardModel[];
  saleSoFar: {
    salesDeltaPct: number | null;
    onCourse: number | null;
    salesPlan: number | null;
    spendDeltaPct: number | null;
    note: string | null;
  };
  totals: {
    spend: Figure;
    metaSpend: Figure;
    googleSpend: Figure;
    sales: Figure;
    roas: Figure;
    roasTone: Tone;
    expectedFinalRoas: Figure;
    orders: Figure;
    newPct: Figure;
    aov: Figure;
    sessions: Figure;
    cvr: Figure;
    target: number | null;
  };
  charts: { spend: ChartSeries; sales: ChartSeries };
  rate: {
    perMinute: Figure;
    perHour: Figure;
    thisHourProjected: Figure;
    vsLastHourPct: number | null;
    metaBackfill: Figure;
    googleBackfill: Figure;
    curveLabel: string;
    measureLabel: string;
  };
  hours: HourRow[];
  day: HourRow;
  method: string[];
}

const SITE_NOTE =
  'Session conversion rate is unavailable, so this call does not check the site or stock.';

function value(n: number): Figure {
  return { status: 'value', value: n };
}

function unavailable(reason: string): Figure {
  return { status: 'unavailable', reason };
}

function noPlan(reason: string): Figure {
  return { status: 'no_plan', reason };
}

function blank(): Figure {
  return { status: 'blank' };
}

function num(figure: Figure): number | null {
  return figure.status === 'value' ? figure.value : null;
}

export function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

export function hourAge(hour: number, nowHour: number): number | null {
  if (hour > nowHour) return null;
  return nowHour - hour;
}

export function hourSettled(hour: number, nowHour: number): HourRow['settled'] {
  const age = hourAge(hour, nowHour);
  if (age == null) return 'upcoming';
  if (age === 0) return 'live';
  if (age >= META_SETTLE_AGE_HOURS) return 'final';
  return 'settling';
}

/**
 * Reported Meta spend plus the default remaining backfill.
 * Age 3 and older returns the reported spend unchanged.
 * A zero stays zero. There is no spend to inflate.
 */
export function expectedFinalMetaSpend(reported: number, age: number): number {
  if (!(reported > 0)) return 0;
  const remaining = META_BACKFILL_REMAINING_BY_AGE[age] ?? 0;
  return reported * (1 + remaining);
}

function ratio(numerator: number, denominator: number): number | null {
  if (!(denominator > 0) || !Number.isFinite(numerator)) return null;
  return numerator / denominator;
}

function toneAgainst(actual: number | null, target: number | null): Tone {
  if (actual == null || target == null || !(target > 0)) return 'neutral';
  return actual + 1e-9 >= target ? 'green' : 'red';
}

function channelFigure(
  state: ChannelState,
  amount: number | null,
  reason: string
): Figure {
  if (state === 'absent' || state === 'unavailable') return unavailable(reason);
  return value(amount ?? 0);
}

function spendFigure(meta: Figure, google: Figure): Figure {
  if (meta.status === 'unavailable' && google.status === 'unavailable') return meta;
  const parts = [meta, google].filter((part) => part.status === 'value');
  if (parts.length === 0) return meta.status === 'unavailable' ? meta : google;
  return value(parts.reduce((sum, part) => sum + (part.status === 'value' ? part.value : 0), 0));
}

function plannedByNow(dayPlan: number | null, elapsedHours: number, missing: string): Figure {
  if (dayPlan == null || !(dayPlan > 0)) return noPlan(missing);
  return value(dayPlan * Math.min(1, Math.max(0, elapsedHours / 24)));
}

function deltaPct(actual: number | null, baseline: number | null): number | null {
  if (actual == null || baseline == null || !(baseline > 0)) return null;
  return ((actual - baseline) / baseline) * 100;
}

function deltaLabel(pct: number | null, empty: string): string {
  if (pct == null) return empty;
  const rounded = Math.abs(pct).toFixed(0);
  return pct >= 0 ? `${rounded}% ahead` : `${rounded}% behind`;
}

function fmtX(n: number): string {
  return `${n.toFixed(2)}x`;
}

function recommendationCopy(input: {
  call: BudgetCall;
  settledHour: number | null;
  settledRoas: number | null;
  dayRoas: number | null;
  target: number | null;
  pushAt: number | null;
  pullAt: number | null;
  salesReady: boolean;
  spendReady: boolean;
  hasTarget: boolean;
  hasSpendPlan: boolean;
  settledUnscored: boolean;
}): Pick<Recommendation, 'headline' | 'detail'> {
  if (!input.hasTarget || !input.hasSpendPlan) {
    const missing = [
      !input.hasTarget ? 'a blended ROAS target' : null,
      !input.hasSpendPlan ? 'a day spend plan' : null,
    ].filter(Boolean).join(' or ');
    return {
      headline: `No budget call. This day needs ${missing}.`,
      detail: 'Set both on Plan. This page will not guess a call from margin, last year, or a default target.',
    };
  }
  if (!input.salesReady) {
    return {
      headline: 'No budget call. Shopify sales are unavailable for this refresh.',
      detail: 'Blended ROAS needs store sales. A zero would be a guess.',
    };
  }
  if (!input.spendReady) {
    return {
      headline: 'No budget call. Ad spend is incomplete for this refresh.',
      detail: 'A channel that is configured but failed is left out of the call. It is not treated as zero spend.',
    };
  }
  if (input.settledHour == null || input.dayRoas == null || input.target == null) {
    return {
      headline: 'No budget call yet. No hour has settled.',
      detail: `A settled hour started at least ${META_SETTLE_AGE_HOURS} hours ago. The open hour is still reporting.`,
    };
  }
  if (input.settledUnscored || input.settledRoas == null) {
    return {
      headline: `No budget call. The last settled hour (${hourLabel(input.settledHour)}) has no ad spend to score.`,
      detail: 'A zero-spend hour has no ROAS. This page will not invent one.',
    };
  }
  const hour = hourLabel(input.settledHour);
  const band = `Today ${fmtX(input.dayRoas)} so far, push above ${fmtX(input.pushAt || 0)}, pull below ${fmtX(input.pullAt || 0)}.`;
  if (input.call === 'PUSH') {
    return {
      headline: `Push: the last settled hour (${hour}) came in at ${fmtX(input.settledRoas)} against ${fmtX(input.target)}.`,
      detail: band,
    };
  }
  if (input.call === 'PULL') {
    return {
      headline: `Pull: the last settled hour (${hour}) came in at ${fmtX(input.settledRoas)} against ${fmtX(input.target)}.`,
      detail: band,
    };
  }
  return {
    headline: `On target: the last settled hour (${hour}) came in at ${fmtX(input.settledRoas)} against ${fmtX(input.target)}.`,
    detail: band,
  };
}

function buildRecommendation(input: {
  nowHour: number;
  target: number | null;
  hasSpendPlan: boolean;
  salesReady: boolean;
  spendReady: boolean;
  settledHour: number | null;
  settledRoas: number | null;
  dayRoas: number | null;
}): Recommendation {
  const hasTarget = input.target != null && input.target > 0;
  const pushAt = hasTarget ? input.target! * PUSH_MULTIPLE : null;
  const pullAt = hasTarget ? input.target! * PULL_MULTIPLE : null;
  let call: BudgetCall = 'NO_CALL';
  if (!hasTarget || !input.hasSpendPlan || !input.salesReady || !input.spendReady) {
    call = !hasTarget || !input.hasSpendPlan ? 'NO_PLAN' : 'NO_CALL';
  } else if (input.settledHour == null || input.dayRoas == null || input.settledRoas == null) {
    call = 'NO_CALL';
  } else if (input.settledRoas < pullAt! || input.dayRoas < pullAt!) {
    call = 'PULL';
  } else if (input.settledRoas >= pushAt! && input.dayRoas >= pushAt!) {
    call = 'PUSH';
  } else {
    call = 'HOLD';
  }
  const copy = recommendationCopy({
    call,
    settledHour: input.settledHour,
    settledRoas: input.settledRoas,
    dayRoas: input.dayRoas,
    target: hasTarget ? input.target : null,
    pushAt,
    pullAt,
    salesReady: input.salesReady,
    spendReady: input.spendReady,
    hasTarget,
    hasSpendPlan: input.hasSpendPlan,
    settledUnscored: input.settledHour != null && input.settledRoas == null,
  });
  return {
    call,
    settledHour: input.settledHour,
    settledRoas: input.settledRoas,
    dayRoas: input.dayRoas,
    target: hasTarget ? input.target : null,
    pushAt,
    pullAt,
    headline: copy.headline,
    detail: copy.detail,
    siteNote: SITE_NOTE,
  };
}

function kpi(input: {
  id: KpiCardModel['id'];
  label: string;
  actual: Figure;
  plan: Figure;
  planned: Figure;
  mode: 'pace' | 'target';
}): KpiCardModel {
  const actualN = num(input.actual);
  const planN = num(input.plan);
  const plannedN = num(input.planned);
  const progress = actualN != null && planN != null && planN > 0 ? actualN / planN : null;
  const delta = input.mode === 'target'
    ? deltaPct(actualN, planN)
    : deltaPct(actualN, plannedN);
  let tone: Tone = 'neutral';
  let deltaText = input.actual.status === 'unavailable'
    ? 'unavailable'
    : input.plan.status === 'no_plan'
      ? 'no day plan'
      : input.mode === 'pace'
        ? deltaLabel(delta, 'no day plan')
        : 'no target';
  if (input.mode === 'target' && actualN != null && planN != null && planN > 0) {
    tone = actualN >= planN ? 'green' : 'red';
    deltaText = actualN >= planN ? 'at or above target' : 'below target';
  } else if (input.mode === 'pace' && delta != null) {
    tone = delta >= 0 ? 'green' : 'red';
    deltaText = deltaLabel(delta, 'no day plan');
  }
  return {
    id: input.id,
    label: input.label,
    value: input.actual,
    plannedByNow: input.mode === 'target' ? input.plan : input.planned,
    dayPlan: input.plan,
    progress,
    deltaPct: delta,
    deltaLabel: deltaText,
    tone,
  };
}

function chartSeries(input: {
  actualByHour: Array<number | null>;
  dayPlan: number | null;
  nowHour: number;
  elapsedHours: number;
  missing: string;
}): ChartSeries {
  const ready = input.actualByHour.some((amount) => amount != null);
  let running = 0;
  let runningKnown = true;
  const points = input.actualByHour.map((amount, hour) => {
    if (hour > input.nowHour) {
      return {
        hour,
        label: hourLabel(hour),
        actual: null,
        plan: input.dayPlan != null && input.dayPlan > 0 ? input.dayPlan * ((hour + 1) / 24) : null,
      };
    }
    if (amount == null) runningKnown = false;
    else running += amount;
    return {
      hour,
      label: hourLabel(hour),
      actual: runningKnown ? running : null,
      plan: input.dayPlan != null && input.dayPlan > 0 ? input.dayPlan * ((hour + 1) / 24) : null,
    };
  });
  const soFar = runningKnown && ready ? running : null;
  const planByNow = input.dayPlan != null && input.dayPlan > 0
    ? input.dayPlan * Math.min(1, input.elapsedHours / 24)
    : null;
  return {
    available: ready && runningKnown,
    reason: ready && runningKnown ? null : input.missing,
    soFar,
    planByNow,
    pacePct: deltaPct(soFar, planByNow),
    dayPlan: input.dayPlan != null && input.dayPlan > 0 ? input.dayPlan : null,
    points,
  };
}

export function buildSurf(input: SurfInput): SurfView {
  const nowHour = Math.min(23, Math.max(0, Math.floor(input.nowHour)));
  const nowMinute = Math.min(59, Math.max(0, Math.floor(input.nowMinute)));
  const elapsedHours = nowHour + nowMinute / 60;
  const byHour = new Map(input.hours.map((hour) => [hour.hour, hour]));
  const plan = input.plan;
  const target = plan?.blendedRoasTarget ?? null;
  const hasSpendPlan = plan?.spendBudget != null && plan.spendBudget > 0;
  const salesReady = input.salesState === 'ready';
  const spendReady = input.metaState === 'ready' || input.googleState === 'ready';
  const spendBlocked = input.metaState === 'unavailable' || input.googleState === 'unavailable';

  const rows: HourRow[] = [];
  let cumSales = 0;
  let cumExpSpend = 0;
  let cumSalesKnown = salesReady;
  let cumExpKnown = !spendBlocked && spendReady;
  let settledHour: number | null = null;
  let settledSpend = 0;
  let settledSales = 0;
  let daySales = 0;
  let dayOrders = 0;
  let dayNew = 0;
  let dayMeta = 0;
  let dayGoogle = 0;
  let dayExpMeta = 0;
  let metaBackfill = 0;
  let countedHours = 0;

  for (let hour = 0; hour < 24; hour += 1) {
    const source = byHour.get(hour);
    const settled = hourSettled(hour, nowHour);
    const age = hourAge(hour, nowHour);
    const upcoming = settled === 'upcoming';
    const meta = upcoming
      ? blank()
      : channelFigure(input.metaState, source?.metaSpend ?? 0, input.metaReason);
    const google = upcoming
      ? blank()
      : channelFigure(input.googleState, source?.googleSpend ?? 0, input.googleReason);
    const sales = upcoming
      ? blank()
      : salesReady
        ? value(source?.sales ?? 0)
        : unavailable(input.salesReason);
    const orders = upcoming
      ? blank()
      : salesReady
        ? value(source?.orders ?? 0)
        : unavailable(input.salesReason);
    const spend = upcoming ? blank() : spendFigure(meta, google);
    const roasN = num(sales) != null && num(spend) != null ? ratio(num(sales)!, num(spend)!) : null;
    const roas: Figure = upcoming
      ? blank()
      : sales.status !== 'value' || spend.status !== 'value'
        ? sales.status !== 'value' ? sales : spend
        : roasN == null
          ? blank()
          : value(roasN);

    let expectedFinalRoas: Figure = blank();
    let expectedFinalIsEstimate = false;
    let expSpendN: number | null = null;
    if (!upcoming && spend.status === 'value' && sales.status === 'value' && age != null) {
      const metaReported = meta.status === 'value' ? meta.value : 0;
      const googleReported = google.status === 'value' ? google.value : 0;
      const metaFinal = meta.status === 'value' ? expectedFinalMetaSpend(metaReported, age) : 0;
      expSpendN = metaFinal + googleReported;
      const expRoas = ratio(sales.value, expSpendN);
      expectedFinalRoas = expRoas == null ? blank() : value(expRoas);
      expectedFinalIsEstimate = age < META_SETTLE_AGE_HOURS && meta.status === 'value' && meta.value > 0;
      if (settled === 'final') {
        settledHour = hour;
        settledSpend = spend.value;
        settledSales = sales.value;
      }
    } else if (!upcoming && (sales.status !== 'value' || spend.status !== 'value')) {
      expectedFinalRoas = sales.status !== 'value' ? sales : spend;
    }

    if (!upcoming && cumSalesKnown && sales.status === 'value') cumSales += sales.value;
    else if (!upcoming) cumSalesKnown = false;
    if (!upcoming && cumExpKnown && expSpendN != null) cumExpSpend += expSpendN;
    else if (!upcoming) cumExpKnown = false;
    const trendingN = cumSalesKnown && cumExpKnown ? ratio(cumSales, cumExpSpend) : null;
    const trendingRoas: Figure = upcoming
      ? blank()
      : !cumSalesKnown || !cumExpKnown
        ? unavailable('Trending ROAS needs the day sales and spend through this hour.')
        : trendingN == null
          ? blank()
          : value(trendingN);

    let newPct: Figure = blank();
    if (!upcoming) {
      if (!salesReady) newPct = unavailable(input.salesReason);
      else if (!input.customerSplit) newPct = unavailable('New customers are unavailable on a Triple Whale brand.');
      else if ((source?.orders ?? 0) > 0) newPct = value(((source?.newOrders ?? 0) / (source?.orders ?? 1)) * 100);
      else newPct = blank();
    }
    const aovN = num(orders) != null && num(orders)! > 0 && num(sales) != null ? num(sales)! / num(orders)! : null;
    const aov: Figure = upcoming ? blank() : orders.status !== 'value' ? orders : aovN == null ? blank() : value(aovN);

    if (!upcoming && sales.status === 'value') {
      daySales += sales.value;
      countedHours += 1;
    }
    if (!upcoming && orders.status === 'value') dayOrders += orders.value;
    if (!upcoming && input.customerSplit && salesReady) dayNew += source?.newOrders ?? 0;
    if (!upcoming && meta.status === 'value') {
      dayMeta += meta.value;
      if (age != null) {
        const finalMeta = expectedFinalMetaSpend(meta.value, age);
        dayExpMeta += finalMeta;
        metaBackfill += finalMeta - meta.value;
      }
    }
    if (!upcoming && google.status === 'value') dayGoogle += google.value;

    rows.push({
      hour,
      label: hourLabel(hour),
      settled,
      settledLabel: settled === 'upcoming' ? '—' : settled === 'settling' && age != null ? `settling · ${age}h` : settled,
      metaSpend: meta,
      googleSpend: google,
      spend,
      sales,
      roas,
      roasTone: toneAgainst(roasN, target),
      expectedFinalRoas,
      expectedFinalIsEstimate,
      trendingRoas,
      trendingTone: toneAgainst(trendingN, target),
      orders,
      newPct,
      aov,
      sessions: upcoming ? blank() : unavailable(SESSIONS_REASON),
      cvr: upcoming ? blank() : unavailable(CVR_REASON),
    });
  }

  const daySpendFigure = spendBlocked || !spendReady
    ? unavailable(spendBlocked ? 'Ad spend is incomplete for this refresh.' : 'No ad account is configured.')
    : value(dayMeta + dayGoogle);
  const daySalesFigure = salesReady ? value(daySales) : unavailable(input.salesReason);
  const dayRoasN = num(daySalesFigure) != null && num(daySpendFigure) != null
    ? ratio(num(daySalesFigure)!, num(daySpendFigure)!)
    : null;
  const dayRoasFigure: Figure = daySalesFigure.status !== 'value'
    ? daySalesFigure
    : daySpendFigure.status !== 'value'
      ? daySpendFigure
      : dayRoasN == null
        ? blank()
        : value(dayRoasN);
  const dayExpSpend = (input.metaState === 'ready' ? dayExpMeta : 0) + (input.googleState === 'ready' ? dayGoogle : 0);
  const dayExpRoasN = salesReady && !spendBlocked && spendReady ? ratio(daySales, dayExpSpend) : null;
  const settledRoas = settledHour == null ? null : ratio(settledSales, settledSpend);

  const recommendation = buildRecommendation({
    nowHour,
    target,
    hasSpendPlan,
    salesReady,
    spendReady: spendReady && !spendBlocked,
    settledHour,
    settledRoas,
    dayRoas: dayRoasN,
  });

  const metaActual = input.metaState === 'ready' ? value(dayMeta) : unavailable(input.metaReason);
  const googleActual = input.googleState === 'ready' ? value(dayGoogle) : unavailable(input.googleReason);
  const spendPlan = plannedByNow(plan?.spendBudget ?? null, elapsedHours, 'No spend plan is saved for this day.');
  const metaPlan = plannedByNow(plan?.metaSpendBudget ?? null, elapsedHours, 'No Meta spend plan is saved for this day.');
  const googlePlan = plannedByNow(plan?.googleSpendBudget ?? null, elapsedHours, 'No Google spend plan is saved for this day.');
  const salesPlanNow = plannedByNow(plan?.revenueGoal ?? null, elapsedHours, 'No sales plan is saved for this day.');
  const roasTargetFigure = target != null && target > 0
    ? value(target)
    : noPlan('No blended ROAS target is saved for this day.');

  const kpis: KpiCardModel[] = [
    kpi({ id: 'spend', label: 'Today\'s spend', actual: daySpendFigure, plan: plan?.spendBudget != null && plan.spendBudget > 0 ? value(plan.spendBudget) : noPlan('No spend plan is saved for this day.'), planned: spendPlan, mode: 'pace' }),
    kpi({ id: 'meta', label: 'Meta spend', actual: metaActual, plan: plan?.metaSpendBudget != null && plan.metaSpendBudget > 0 ? value(plan.metaSpendBudget) : noPlan('No Meta spend plan is saved for this day.'), planned: metaPlan, mode: 'pace' }),
    kpi({ id: 'google', label: 'Google spend', actual: googleActual, plan: plan?.googleSpendBudget != null && plan.googleSpendBudget > 0 ? value(plan.googleSpendBudget) : noPlan('No Google spend plan is saved for this day.'), planned: googlePlan, mode: 'pace' }),
    kpi({ id: 'roas', label: 'Blended ROAS today', actual: dayRoasFigure, plan: roasTargetFigure, planned: roasTargetFigure, mode: 'target' }),
  ];

  const onCourse = salesReady && elapsedHours > 0 ? daySales / (elapsedHours / 24) : null;
  const saleSoFar = {
    salesDeltaPct: deltaPct(salesReady ? daySales : null, num(salesPlanNow)),
    onCourse: salesReady ? onCourse : null,
    salesPlan: plan?.revenueGoal != null && plan.revenueGoal > 0 ? plan.revenueGoal : null,
    spendDeltaPct: deltaPct(num(daySpendFigure), num(spendPlan)),
    note: !hasSpendPlan && !(plan?.revenueGoal != null && plan.revenueGoal > 0)
      ? 'No day plan is saved, so pace against plan is blank.'
      : null,
  };

  const spendActualByHour = rows.map((row) => num(row.spend));
  const salesActualByHour = rows.map((row) => num(row.sales));
  const current = rows[nowHour];
  const previous = nowHour > 0 ? rows[nowHour - 1] : null;
  const minute = nowMinute;
  const openSpend = current ? num(current.spend) : null;
  const rate = minute > 0 && openSpend != null ? openSpend / minute : null;
  const projected = rate == null ? null : rate * 60;
  const lastSpend = previous ? num(previous.spend) : null;

  const dayOrdersFigure = salesReady ? value(dayOrders) : unavailable(input.salesReason);
  const dayNewPct: Figure = !salesReady
    ? unavailable(input.salesReason)
    : !input.customerSplit
      ? unavailable('New customers are unavailable on a Triple Whale brand.')
      : value(dayOrders > 0 ? (dayNew / dayOrders) * 100 : 0);
  const dayAov: Figure = !salesReady
    ? unavailable(input.salesReason)
    : dayOrders > 0
      ? value(daySales / dayOrders)
      : blank();

  const dayRow: HourRow = {
    hour: -1,
    label: 'Day',
    settled: 'final',
    settledLabel: countedHours > 0 ? 'so far' : '—',
    metaSpend: metaActual,
    googleSpend: googleActual,
    spend: daySpendFigure,
    sales: daySalesFigure,
    roas: dayRoasFigure,
    roasTone: toneAgainst(dayRoasN, target),
    expectedFinalRoas: dayExpRoasN == null
      ? (daySalesFigure.status !== 'value' ? daySalesFigure : daySpendFigure.status !== 'value' ? daySpendFigure : blank())
      : value(dayExpRoasN),
    expectedFinalIsEstimate: input.metaState === 'ready' && metaBackfill > 0,
    trendingRoas: dayExpRoasN == null ? blank() : value(dayExpRoasN),
    trendingTone: toneAgainst(dayExpRoasN, target),
    orders: dayOrdersFigure,
    newPct: dayNewPct,
    aov: dayAov,
    sessions: unavailable(SESSIONS_REASON),
    cvr: unavailable(CVR_REASON),
  };

  return {
    recommendation,
    kpis,
    saleSoFar,
    totals: {
      spend: daySpendFigure,
      metaSpend: metaActual,
      googleSpend: googleActual,
      sales: daySalesFigure,
      roas: dayRoasFigure,
      roasTone: toneAgainst(dayRoasN, target),
      expectedFinalRoas: dayRow.expectedFinalRoas,
      orders: dayOrdersFigure,
      newPct: dayNewPct,
      aov: dayAov,
      sessions: unavailable(SESSIONS_REASON),
      cvr: unavailable(CVR_REASON),
      target: target != null && target > 0 ? target : null,
    },
    charts: {
      spend: chartSeries({
        actualByHour: spendActualByHour,
        dayPlan: plan?.spendBudget ?? null,
        nowHour,
        elapsedHours,
        missing: daySpendFigure.status === 'value' ? 'No spend yet.' : daySpendFigure.status === 'unavailable' ? daySpendFigure.reason : 'No spend yet.',
      }),
      sales: chartSeries({
        actualByHour: salesActualByHour,
        dayPlan: plan?.revenueGoal ?? null,
        nowHour,
        elapsedHours,
        missing: salesReady ? 'No sales yet.' : input.salesReason,
      }),
    },
    rate: {
      perMinute: rate == null
        ? unavailable(minute === 0 ? 'The shop hour just opened, so a per-minute rate would divide by zero.' : 'Spend for the open hour is unavailable.')
        : value(rate),
      perHour: projected == null
        ? unavailable(minute === 0 ? 'The shop hour just opened, so an hourly rate is not meaningful yet.' : 'Spend for the open hour is unavailable.')
        : value(projected),
      thisHourProjected: projected == null
        ? unavailable('The open hour cannot be projected until a minute has elapsed.')
        : value(projected),
      vsLastHourPct: deltaPct(projected, lastSpend),
      metaBackfill: input.metaState === 'ready'
        ? value(metaBackfill)
        : unavailable(input.metaReason),
      googleBackfill: unavailable(GOOGLE_BACKFILL_REASON),
      curveLabel: 'Meta +27% / +10% / +1% at hour age 0 / 1 / 2. Default estimate, not measured on this brand.',
      measureLabel: 'Spend rate is this shop hour\'s reported spend divided by minutes elapsed. Meta and Google arrive by hour, so this is not a last-few-minutes tape.',
    },
    hours: rows,
    day: dayRow,
    method: methodNotes(),
  };
}

export function methodNotes(): string[] {
  return [
    'Sales are Shopify gross, subtotal plus discounts, with voided orders excluded. That is the Daily P&L gross. It is not net of refunds.',
    'Meta spend is the Marketing API hourly breakdown, rebucketed from the ad account clock onto the shop clock.',
    'Google spend is Pipeboard GAQL segments.hour, rebucketed onto the shop clock.',
    SESSIONS_REASON,
    'Blended ROAS is Shopify gross divided by the ad spend that actually returned. A configured channel that failed this refresh is not filled with zero.',
    `Expected final is an estimate. Meta reported spend is grossed up by ${META_BACKFILL_REMAINING_BY_AGE.map((rate) => `+${Math.round(rate * 100)}%`).join(' / ')} at hour ages 0, 1, and 2. Age is whole hours since that hour started. Age ${META_SETTLE_AGE_HOURS} and older is final and is not adjusted. The curve is the Surf default. It is not fit to this brand.`,
    GOOGLE_BACKFILL_REASON + ' Expected final keeps Google at the reported amount.',
    EVEN_SPLIT_REASON,
    `The budget call needs a blended ROAS target and a day spend plan. Push means the last settled hour and the day so far are both at least ${Math.round((PUSH_MULTIPLE - 1) * 100)}% above target. Pull means either one is more than ${Math.round((1 - PULL_MULTIPLE) * 100)}% below target. Otherwise the call is hold.`,
    'The page reloads about every 60 seconds while the tab is visible.',
  ];
}

/** Sale-to-date across the BFCM window. A missing plan is not treated as zero. */
export function saleToDate(input: {
  today: string;
  days: { date: string; sales: number | null; salesPlan: number | null; spendPlan: number | null }[];
}): {
  sales: number | null;
  salesPlan: number | null;
  salesPlanComplete: boolean;
  spendPlan: number | null;
  spendPlanComplete: boolean;
  salesDeltaPct: number | null;
} {
  const started = input.days.filter((day) => day.date <= input.today);
  const salesKnown = started.every((day) => day.sales != null);
  const sales = salesKnown ? started.reduce((sum, day) => sum + (day.sales || 0), 0) : null;
  const salesPlans = started.map((day) => day.salesPlan).filter((plan): plan is number => plan != null && plan > 0);
  const spendPlans = started.map((day) => day.spendPlan).filter((plan): plan is number => plan != null && plan > 0);
  const salesPlanComplete = started.length > 0 && started.every((day) => day.salesPlan != null && day.salesPlan > 0);
  const spendPlanComplete = started.length > 0 && started.every((day) => day.spendPlan != null && day.spendPlan > 0);
  const salesPlan = salesPlans.length > 0 ? salesPlans.reduce((sum, plan) => sum + plan, 0) : null;
  return {
    sales,
    salesPlan: salesPlanComplete ? salesPlan : null,
    salesPlanComplete,
    spendPlan: spendPlanComplete ? spendPlans.reduce((sum, plan) => sum + plan, 0) : null,
    spendPlanComplete,
    salesDeltaPct: salesPlanComplete && sales != null && salesPlan != null && salesPlan > 0
      ? ((sales - salesPlan) / salesPlan) * 100
      : null,
  };
}
