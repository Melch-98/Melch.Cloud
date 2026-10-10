import { describe, expect, it } from 'vitest';
import { amerTone, merRatio, paceSnapshot, requiredHourly, spendPaceTone, vsBaselinePct } from '@/lib/bfcm/pacing';

describe('pacing math', () => {
  it('computes the hourly run-rate still required to hit the goal', () => {
    expect(requiredHourly(2400, 600, 12)).toBe(150);
    expect(requiredHourly(1000, 1000, 4)).toBe(0);
    expect(requiredHourly(1000, 400, 0)).toBeNull();
    expect(requiredHourly(null, 400, 4)).toBeNull();
  });

  it('compares revenue and spend with the day elapsed, and aMER with its target', () => {
    const noon = paceSnapshot({
      revenueSoFar: 600,
      revenueGoal: 2400,
      spendSoFar: 500,
      spendBudget: 1000,
      amer: 1.8,
      amerTarget: 2,
      hour: 12,
      minute: 0,
    });
    expect(noon.elapsedHours).toBe(12);
    expect(noon.remainingHours).toBe(12);
    expect(noon.revenueVsGoal).toBe(0.25);
    expect(noon.spendVsBudget).toBe(0.5);
    expect(noon.revenueTone).toBe('red');
    expect(noon.spendTone).toBe('green');
    expect(noon.requiredHourlyRevenue).toBe(150);
    expect(noon.requiredHourlySpend).toBeCloseTo(500 / 12);
    expect(noon.amerTone).toBe('amber');
  });

  it('colors aMER against the target', () => {
    expect(amerTone(2, 2)).toBe('green');
    expect(amerTone(2.4, 2)).toBe('green');
    expect(amerTone(1.7, 2)).toBe('amber');
    expect(amerTone(1.69, 2)).toBe('red');
    expect(amerTone(null, 2)).toBe('neutral');
    expect(amerTone(2, null)).toBe('neutral');
  });

  it('flags spend that is far ahead of the budget pace', () => {
    expect(spendPaceTone(800, 1000, 12)).toBe('red');
    expect(spendPaceTone(400, 1000, 12)).toBe('amber');
  });

  it('MER is revenue over spend and is blank when nothing has been spent', () => {
    expect(merRatio(300, 100)).toBe(3);
    expect(merRatio(300, 0)).toBeNull();
  });

  it('does not turn missing last-year history into a percent versus zero', () => {
    expect(vsBaselinePct(100, 0, 'ok')).toBeNull();
    expect(vsBaselinePct(100, 50, 'no_last_year_data')).toBeNull();
    expect(vsBaselinePct(150, 100, 'ok')).toBe(50);
  });
});
