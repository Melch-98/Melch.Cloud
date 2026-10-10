export type PaceTone = 'green' | 'amber' | 'red' | 'neutral';

const CLOSE = 0.85;

export interface PaceSnapshot {
  elapsedHours: number;
  remainingHours: number;
  dayFraction: number;
  revenueVsGoal: number | null;
  spendVsBudget: number | null;
  revenueTone: PaceTone;
  spendTone: PaceTone;
  requiredHourlyRevenue: number | null;
  requiredHourlySpend: number | null;
  amerTone: PaceTone;
}

export function merRatio(revenue: number, spend: number): number | null {
  if (!(spend > 0) || !Number.isFinite(revenue)) return null;
  return revenue / spend;
}

/** aMER at or above target is green. Within 15% below is amber. Further below is red. */
export function amerTone(amer: number | null, target: number | null): PaceTone {
  if (amer == null || target == null || !(target > 0) || !Number.isFinite(amer)) return 'neutral';
  if (amer >= target) return 'green';
  if (amer >= target * CLOSE) return 'amber';
  return 'red';
}

export function requiredHourly(
  goal: number | null,
  soFar: number,
  remainingHours: number
): number | null {
  if (goal == null || !(goal > 0) || !Number.isFinite(soFar)) return null;
  if (remainingHours <= 0) return soFar >= goal ? 0 : null;
  return Math.max(0, goal - soFar) / remainingHours;
}

/** Revenue ahead of the time-elapsed share of the goal is green. */
export function revenuePaceTone(soFar: number, goal: number | null, elapsedHours: number): PaceTone {
  if (goal == null || !(goal > 0) || !Number.isFinite(soFar)) return 'neutral';
  const fraction = Math.min(1, Math.max(0, elapsedHours / 24));
  const expected = goal * fraction;
  if (expected <= 0) return soFar > 0 ? 'green' : 'neutral';
  const ratio = soFar / expected;
  if (ratio >= 1) return 'green';
  if (ratio >= CLOSE) return 'amber';
  return 'red';
}

/**
 * Spend near the time-elapsed share of the budget is green.
 * More than 10% over that share is red. Well behind is red. Slightly behind is amber.
 */
export function spendPaceTone(soFar: number, budget: number | null, elapsedHours: number): PaceTone {
  if (budget == null || !(budget > 0) || !Number.isFinite(soFar)) return 'neutral';
  const fraction = Math.min(1, Math.max(0, elapsedHours / 24));
  const expected = budget * fraction;
  if (expected <= 0) return 'neutral';
  const ratio = soFar / expected;
  if (ratio > 1.1) return 'red';
  if (ratio >= CLOSE) return 'green';
  if (ratio >= 0.7) return 'amber';
  return 'red';
}

export function fractionOfGoal(soFar: number, goal: number | null): number | null {
  if (goal == null || !(goal > 0) || !Number.isFinite(soFar)) return null;
  return soFar / goal;
}

export function paceSnapshot(input: {
  revenueSoFar: number;
  revenueGoal: number | null;
  spendSoFar: number;
  spendBudget: number | null;
  amer: number | null;
  amerTarget: number | null;
  hour: number;
  minute: number;
}): PaceSnapshot {
  const elapsedHours = Math.min(24, Math.max(0, input.hour + input.minute / 60));
  const remainingHours = Math.max(0, 24 - elapsedHours);
  return {
    elapsedHours,
    remainingHours,
    dayFraction: elapsedHours / 24,
    revenueVsGoal: fractionOfGoal(input.revenueSoFar, input.revenueGoal),
    spendVsBudget: fractionOfGoal(input.spendSoFar, input.spendBudget),
    revenueTone: revenuePaceTone(input.revenueSoFar, input.revenueGoal, elapsedHours),
    spendTone: spendPaceTone(input.spendSoFar, input.spendBudget, elapsedHours),
    requiredHourlyRevenue: requiredHourly(input.revenueGoal, input.revenueSoFar, remainingHours),
    requiredHourlySpend: requiredHourly(input.spendBudget, input.spendSoFar, remainingHours),
    amerTone: amerTone(input.amer, input.amerTarget),
  };
}

export function vsBaselinePct(
  current: number,
  baseline: number,
  status: 'ok' | 'no_last_year_data'
): number | null {
  if (status !== 'ok' || !(baseline > 0) || !Number.isFinite(current)) return null;
  return ((current - baseline) / baseline) * 100;
}
