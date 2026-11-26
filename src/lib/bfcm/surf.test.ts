import { describe, expect, it } from 'vitest';
import { zonedClock } from '@/lib/bfcm/calendar';
import { rebucketAccountHoursToStoreDay } from '@/lib/bfcm/store-day-spend';
import {
  CVR_REASON,
  GOOGLE_BACKFILL_REASON,
  META_BACKFILL_REMAINING_BY_AGE,
  PULL_MULTIPLE,
  PUSH_MULTIPLE,
  SESSIONS_REASON,
  buildSurf,
  expectedFinalMetaSpend,
  saleToDate,
  type DayPlan,
  type SurfHourInput,
  type SurfInput,
} from '@/lib/bfcm/surf';

const plan: DayPlan = {
  spendBudget: 2400,
  metaSpendBudget: 1800,
  googleSpendBudget: 600,
  revenueGoal: 12000,
  blendedRoasTarget: 5.4,
  metaRoasTarget: 4,
  googleRoasTarget: 3,
};

function day(overrides: Partial<SurfHourInput>[]): SurfHourInput[] {
  const byHour = new Map(overrides.map((hour) => [hour.hour, hour]));
  return Array.from({ length: 24 }, (_, hour) => {
    const row = byHour.get(hour);
    return {
      hour,
      metaSpend: row?.metaSpend ?? 0,
      googleSpend: row?.googleSpend ?? 0,
      sales: row?.sales ?? 0,
      orders: row?.orders ?? 0,
      newOrders: row?.newOrders ?? 0,
    };
  });
}

function input(overrides: Partial<SurfInput> = {}): SurfInput {
  return {
    nowHour: 19,
    nowMinute: 26,
    metaState: 'ready',
    googleState: 'ready',
    salesState: 'ready',
    salesReason: 'No Shopify connected',
    metaReason: 'No Meta ad account configured.',
    googleReason: 'No Google Ads account.',
    customerSplit: true,
    hours: day([]),
    plan,
    ...overrides,
  };
}

function figure(view: ReturnType<typeof buildSurf>, hour: number, key: 'metaSpend' | 'googleSpend' | 'sales' | 'roas' | 'expectedFinalRoas' | 'sessions' | 'cvr' | 'newPct') {
  return view.hours[hour][key];
}

describe('expected final Meta spend', () => {
  it('applies the default curve by hour age and leaves a settled hour unchanged', () => {
    expect(META_BACKFILL_REMAINING_BY_AGE).toEqual([0.27, 0.1, 0.01]);
    expect(expectedFinalMetaSpend(100, 0)).toBeCloseTo(127);
    expect(expectedFinalMetaSpend(100, 1)).toBeCloseTo(110);
    expect(expectedFinalMetaSpend(100, 2)).toBeCloseTo(101);
    expect(expectedFinalMetaSpend(100, 3)).toBe(100);
    expect(expectedFinalMetaSpend(100, 8)).toBe(100);
    expect(expectedFinalMetaSpend(0, 0)).toBe(0);
  });

  it('labels the open hour as an estimate and a settled hour as final', () => {
    const view = buildSurf(input({
      hours: day([
        { hour: 16, metaSpend: 100, googleSpend: 0, sales: 200, orders: 2, newOrders: 1 },
        { hour: 19, metaSpend: 100, googleSpend: 0, sales: 127, orders: 1, newOrders: 1 },
      ]),
    }));
    const open = view.hours[19];
    const settled = view.hours[16];
    expect(open.settled).toBe('live');
    expect(open.expectedFinalIsEstimate).toBe(true);
    expect(open.expectedFinalRoas).toEqual({ status: 'value', value: 1 });
    expect(settled.settled).toBe('final');
    expect(settled.expectedFinalIsEstimate).toBe(false);
    expect(settled.expectedFinalRoas).toMatchObject({ status: 'value', value: 2 });
    expect(view.rate.metaBackfill).toMatchObject({ status: 'value' });
    expect(view.rate.googleBackfill).toEqual({ status: 'unavailable', reason: GOOGLE_BACKFILL_REASON });
    if (view.rate.metaBackfill.status === 'value') {
      expect(view.rate.metaBackfill.value).toBeCloseTo(27);
    }
  });
});

describe('budget call', () => {
  const target = 5.4;

  it('holds when the last settled hour is inside the band even if the day is above the push line', () => {
    const view = buildSurf(input({
      hours: day([
        { hour: 10, metaSpend: 900, googleSpend: 0, sales: 5518, orders: 10, newOrders: 4 },
        { hour: 16, metaSpend: 100, googleSpend: 0, sales: 532, orders: 4, newOrders: 2 },
      ]),
    }));
    expect(view.recommendation.call).toBe('HOLD');
    expect(view.recommendation.settledHour).toBe(16);
    expect(view.recommendation.settledRoas).toBeCloseTo(5.32);
    expect(view.recommendation.dayRoas).toBeCloseTo(6.05);
    expect(view.recommendation.pushAt).toBeCloseTo(target * PUSH_MULTIPLE);
    expect(view.recommendation.pullAt).toBeCloseTo(target * PULL_MULTIPLE);
    expect(view.recommendation.headline).toContain('last settled hour (16:00)');
    expect(view.recommendation.headline).toContain('5.32x');
    expect(view.recommendation.detail).toContain('6.05x');
    expect(view.recommendation.siteNote).toContain('unavailable');
  });

  it('pushes only when the settled hour and the day are both above the push line', () => {
    const view = buildSurf(input({
      hours: day([{ hour: 16, metaSpend: 100, googleSpend: 0, sales: 600, orders: 3, newOrders: 1 }]),
    }));
    expect(view.recommendation.call).toBe('PUSH');
    expect(view.recommendation.settledRoas).toBeCloseTo(6);
    expect(view.recommendation.dayRoas).toBeCloseTo(6);
  });

  it('pulls when the settled hour is below the pull line even if the day is strong', () => {
    const view = buildSurf(input({
      hours: day([
        { hour: 10, metaSpend: 900, googleSpend: 0, sales: 5650, orders: 8, newOrders: 2 },
        { hour: 16, metaSpend: 100, googleSpend: 0, sales: 400, orders: 2, newOrders: 1 },
      ]),
    }));
    expect(view.recommendation.call).toBe('PULL');
    expect(view.recommendation.settledRoas).toBeCloseTo(4);
    expect(view.recommendation.dayRoas).toBeGreaterThan(target);
  });

  it('refuses a call when the day has no target or no spend plan', () => {
    const noTarget = buildSurf(input({ plan: { ...plan, blendedRoasTarget: null } }));
    expect(noTarget.recommendation.call).toBe('NO_PLAN');
    expect(noTarget.recommendation.headline).toContain('blended ROAS target');

    const noSpend = buildSurf(input({ plan: { ...plan, spendBudget: null } }));
    expect(noSpend.recommendation.call).toBe('NO_PLAN');
    expect(noSpend.recommendation.headline).toContain('day spend plan');

    const nothing = buildSurf(input({ plan: null }));
    expect(nothing.recommendation.call).toBe('NO_PLAN');
    expect(nothing.kpis.find((card) => card.id === 'spend')?.deltaLabel).toBe('no day plan');
  });

  it('waits when no hour has settled yet', () => {
    const view = buildSurf(input({
      nowHour: 2,
      nowMinute: 15,
      hours: day([{ hour: 2, metaSpend: 50, googleSpend: 10, sales: 400, orders: 2, newOrders: 1 }]),
    }));
    expect(view.recommendation.call).toBe('NO_CALL');
    expect(view.recommendation.headline).toContain('No hour has settled');
    expect(view.hours[2].settled).toBe('live');
    expect(view.hours[0].settled).toBe('settling');
    expect(view.hours[3].settled).toBe('upcoming');
  });
});

describe('shop-timezone hourly buckets', () => {
  it('puts Los Angeles 17:00 onto Chicago 19:00 and not onto the account hour', () => {
    const instant = new Date('2026-11-27T01:30:00.000Z');
    expect(zonedClock(instant, 'America/Chicago')).toMatchObject({ ymd: '2026-11-26', hour: 19 });
    expect(zonedClock(instant, 'America/Toronto')).toMatchObject({ ymd: '2026-11-26', hour: 20 });

    const store = rebucketAccountHoursToStoreDay({
      rows: [{ date: '2026-11-26', hour: 17, spend: 40 }],
      storeDate: '2026-11-26',
      storeTimeZone: 'America/Chicago',
      accountTimeZone: 'America/Los_Angeles',
    });
    expect(store.hourly[19].spend).toBe(40);
    expect(store.hourly[17].spend).toBe(0);

    const view = buildSurf(input({
      nowHour: zonedClock(instant, 'America/Chicago').hour,
      nowMinute: zonedClock(instant, 'America/Chicago').minute,
      googleState: 'absent',
      hours: day(store.hourly.map((point) => ({
        hour: point.hour,
        metaSpend: point.spend,
        googleSpend: 0,
        sales: point.hour === 19 ? 80 : 0,
        orders: point.hour === 19 ? 1 : 0,
        newOrders: point.hour === 19 ? 1 : 0,
      }))),
    }));
    expect(figure(view, 19, 'metaSpend')).toEqual({ status: 'value', value: 40 });
    expect(figure(view, 17, 'metaSpend')).toEqual({ status: 'value', value: 0 });
    expect(figure(view, 19, 'sales')).toEqual({ status: 'value', value: 80 });
    expect(view.hours[19].settled).toBe('live');
  });
});

describe('unavailable states stay blank', () => {
  it('does not turn a missing session, a failed channel, or a disconnected shop into zero', () => {
    const view = buildSurf(input({
      metaState: 'unavailable',
      googleState: 'absent',
      salesState: 'unavailable',
      metaReason: 'Meta data is unavailable for this refresh.',
      googleReason: 'No Google Ads account.',
      salesReason: 'No Shopify connected',
      hours: day([{ hour: 16, metaSpend: 999, googleSpend: 999, sales: 999, orders: 9, newOrders: 9 }]),
    }));
    expect(figure(view, 16, 'metaSpend')).toEqual({
      status: 'unavailable',
      reason: 'Meta data is unavailable for this refresh.',
    });
    expect(figure(view, 16, 'googleSpend')).toEqual({
      status: 'unavailable',
      reason: 'No Google Ads account.',
    });
    expect(figure(view, 16, 'sales')).toEqual({ status: 'unavailable', reason: 'No Shopify connected' });
    expect(view.totals.sales).toEqual({ status: 'unavailable', reason: 'No Shopify connected' });
    expect(view.totals.sessions).toEqual({ status: 'unavailable', reason: SESSIONS_REASON });
    expect(view.totals.cvr).toEqual({ status: 'unavailable', reason: CVR_REASON });
    expect(figure(view, 16, 'sessions').status).toBe('unavailable');
    expect(figure(view, 16, 'cvr').status).toBe('unavailable');
    expect(view.recommendation.call).toBe('NO_CALL');
    expect(view.hours[20].sales).toEqual({ status: 'blank' });
  });

  it('keeps Meta when Google is not configured, and blocks the call when a configured Google read fails', () => {
    const metaOnly = buildSurf(input({
      googleState: 'absent',
      hours: day([{ hour: 16, metaSpend: 100, googleSpend: 0, sales: 500, orders: 2, newOrders: 1 }]),
    }));
    expect(metaOnly.kpis.find((card) => card.id === 'google')?.value.status).toBe('unavailable');
    expect(metaOnly.totals.spend).toEqual({ status: 'value', value: 100 });
    expect(metaOnly.recommendation.dayRoas).toBeCloseTo(5);

    const failed = buildSurf(input({
      googleState: 'unavailable',
      googleReason: 'Google request failed',
      hours: day([{ hour: 16, metaSpend: 100, googleSpend: 0, sales: 500, orders: 2, newOrders: 1 }]),
    }));
    expect(failed.totals.spend.status).toBe('unavailable');
    expect(failed.kpis.find((card) => card.id === 'meta')?.value).toEqual({ status: 'value', value: 100 });
    expect(failed.recommendation.call).toBe('NO_CALL');
  });

  it('hides new-customer rate for Triple Whale and still shows orders', () => {
    const view = buildSurf(input({
      customerSplit: false,
      hours: day([{ hour: 16, metaSpend: 100, googleSpend: 20, sales: 400, orders: 4, newOrders: 4 }]),
    }));
    expect(figure(view, 16, 'newPct').status).toBe('unavailable');
    expect(view.hours[16].orders).toEqual({ status: 'value', value: 4 });
    expect(view.totals.newPct.status).toBe('unavailable');
  });
});

describe('pace against an even day plan', () => {
  it('compares spend with the elapsed fraction of the day plan', () => {
    const view = buildSurf(input({
      nowHour: 12,
      nowMinute: 0,
      hours: day([{ hour: 10, metaSpend: 1500, googleSpend: 0, sales: 8000, orders: 8, newOrders: 3 }]),
    }));
    const spend = view.kpis.find((card) => card.id === 'spend');
    expect(spend?.plannedByNow).toEqual({ status: 'value', value: 1200 });
    expect(spend?.dayPlan).toEqual({ status: 'value', value: 2400 });
    expect(spend?.tone).toBe('green');
    expect(view.charts.spend.planByNow).toBe(1200);
    expect(view.charts.spend.points[23].plan).toBe(2400);
    expect(view.charts.spend.points[13].actual).toBeNull();
    expect(view.charts.spend.points[12].actual).toBe(1500);
  });
});

describe('sale to date', () => {
  it('does not treat a missing day plan as zero', () => {
    const partial = saleToDate({
      today: '2026-11-26',
      days: [
        { date: '2026-11-25', sales: 100, salesPlan: null, spendPlan: 40 },
        { date: '2026-11-26', sales: 50, salesPlan: 80, spendPlan: null },
        { date: '2026-11-27', sales: null, salesPlan: 90, spendPlan: 30 },
      ],
    });
    expect(partial.sales).toBe(150);
    expect(partial.salesPlanComplete).toBe(false);
    expect(partial.salesPlan).toBeNull();
    expect(partial.salesDeltaPct).toBeNull();
    expect(partial.spendPlan).toBeNull();

    const full = saleToDate({
      today: '2026-11-26',
      days: [
        { date: '2026-11-25', sales: 100, salesPlan: 80, spendPlan: 40 },
        { date: '2026-11-26', sales: 50, salesPlan: 80, spendPlan: 40 },
      ],
    });
    expect(full.salesPlan).toBe(160);
    expect(full.salesDeltaPct).toBeCloseTo(((150 - 160) / 160) * 100);
  });
});
