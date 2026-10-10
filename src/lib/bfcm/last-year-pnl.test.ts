import { describe, expect, it } from 'vitest';
import { buildLastYearBfcmPnl, isCsvImportSource, lastYearBfcmRange } from '@/lib/bfcm/last-year-pnl';

describe('last year BFCM alignment', () => {
  it('reads four days before the Monday through four days after Cyber Monday', () => {
    const range = lastYearBfcmRange(2026);
    expect(range.core.blackFriday).toBe('2025-11-28');
    expect(range.core.cyberMonday).toBe('2025-12-01');
    expect(range.start).toBe('2025-11-20');
    expect(range.end).toBe('2025-12-05');
    expect(range.thisYear.blackFriday).toBe('2026-11-27');
  });

  it('aligns each last-year day to the same offset from this year Black Friday', () => {
    const pnl = buildLastYearBfcmPnl({
      year: 2026,
      rows: [
        { date: '2025-11-28', gross_sales: 100, nc_revenue: 80, nc_orders: 2, meta_spend: 20 },
        { date: '2025-12-01', gross_sales: 50, nc_revenue: 40, nc_orders: 1, meta_spend: 10 },
        { date: '2025-11-20', gross_sales: 10, nc_orders: 1, meta_spend: 5 },
      ],
      earliestOrderDay: '2025-11-01',
      ncEstimated: false,
      reportingCurrency: 'USD',
      fxRates: { USD: 1 },
    });
    expect(pnl.days).toHaveLength(16);
    expect(pnl.days.find((day) => day.date === '2025-11-28')).toMatchObject({
      label: 'Black Friday',
      alignedDate: '2026-11-27',
      inCore: true,
    });
    expect(pnl.days.find((day) => day.date === '2025-12-01')).toMatchObject({
      label: 'Cyber Monday',
      alignedDate: '2026-11-30',
      inCore: true,
    });
    expect(pnl.days.find((day) => day.date === '2025-11-20')).toMatchObject({
      label: 'Thursday',
      alignedDate: '2026-11-19',
      inCore: false,
    });
  });
});

describe('last year BFCM no-data and totals', () => {
  it('shows no data before the first stored order and keeps a real zero', () => {
    const missing = buildLastYearBfcmPnl({
      year: 2026,
      rows: [],
      earliestOrderDay: '2026-06-28',
      ncEstimated: false,
      reportingCurrency: 'USD',
      fxRates: { USD: 1 },
    });
    const blackFriday = missing.days.find((day) => day.date === '2025-11-28');
    expect(blackFriday?.gross).toBe('no data');
    expect(blackFriday?.orders).toBe('no data');
    expect(blackFriday?.mer).toBe('no data');
    expect(blackFriday?.amer).toBe('no data');
    expect(missing.core.gross).toBe('no data');
    expect(missing.extended.gross).toBe('no data');

    const kept = buildLastYearBfcmPnl({
      year: 2026,
      rows: [{ date: '2025-11-28', gross_sales: 120, nc_revenue: 120, nc_orders: 1, meta_spend: 40 }],
      earliestOrderDay: '2026-06-28',
      ncEstimated: false,
      reportingCurrency: 'USD',
      fxRates: { USD: 1 },
    });
    expect(kept.days.find((day) => day.date === '2025-11-28')?.gross).toBe(120);
    expect(kept.days.find((day) => day.date === '2025-11-27')?.gross).toBe('no data');

    const quiet = buildLastYearBfcmPnl({
      year: 2026,
      rows: [{ date: '2025-11-28', gross_sales: 0, nc_revenue: 0, meta_spend: 0, google_spend: 0 }],
      earliestOrderDay: '2025-11-01',
      ncEstimated: false,
      reportingCurrency: 'USD',
      fxRates: { USD: 1 },
    });
    expect(quiet.days.find((day) => day.date === '2025-11-28')?.gross).toBe(0);
    expect(quiet.core.gross).toBe(0);
  });

  it('nets negative discounts and refunds, and splits core from the extended range', () => {
    const pnl = buildLastYearBfcmPnl({
      year: 2026,
      rows: [
        {
          date: '2025-11-20',
          gross_sales: 1000,
          discounts: -100,
          refunds: -50,
          nc_revenue: 400,
          nc_orders: 4,
          rc_orders: 1,
          meta_spend: 200,
          google_spend: 100,
        },
        {
          date: '2025-11-28',
          gross_sales: 700,
          discounts: -100,
          refunds: -20,
          nc_revenue: 500,
          nc_orders: 5,
          meta_spend: 200,
          google_spend: 0,
        },
      ],
      earliestOrderDay: '2025-11-01',
      ncEstimated: true,
      reportingCurrency: 'USD',
      fxRates: { USD: 1 },
    });
    const shoulder = pnl.days.find((day) => day.date === '2025-11-20');
    expect(shoulder?.orders).toBe(5);
    expect(shoulder?.net).toBe(850);
    expect(shoulder?.mer).toBe(3);
    expect(shoulder?.amer).toBeCloseTo(1.33, 2);
    const blackFriday = pnl.days.find((day) => day.date === '2025-11-28');
    expect(blackFriday?.net).toBe(580);
    expect(blackFriday?.mer).toBe(3);
    expect(blackFriday?.amer).toBe(2.5);
    expect(pnl.core.gross).toBe(700);
    expect(pnl.extended.gross).toBe(1700);
    expect(pnl.ncEstimated).toBe(true);
  });

  it('converts a row into the reporting currency before MER', () => {
    const pnl = buildLastYearBfcmPnl({
      year: 2026,
      rows: [
        {
          date: '2025-11-28',
          currency: 'CAD',
          gross_sales: 138,
          nc_revenue: 69,
          meta_spend: 69,
          nc_orders: 1,
        },
      ],
      earliestOrderDay: '2025-11-01',
      ncEstimated: false,
      reportingCurrency: 'USD',
      fxRates: { USD: 1, CAD: 1.38 },
    });
    const blackFriday = pnl.days.find((day) => day.date === '2025-11-28');
    expect(blackFriday?.gross).toBe(100);
    expect(blackFriday?.ncRevenue).toBe(50);
    expect(blackFriday?.metaSpend).toBe(50);
    expect(blackFriday?.amer).toBe(1);
    expect(pnl.currency).toBe('USD');
  });
});

describe('csv import source', () => {
  it('matches a Shopify CSV import prefix', () => {
    expect(isCsvImportSource('csv_import')).toBe(true);
    expect(isCsvImportSource('csv_import_2025')).toBe(true);
    expect(isCsvImportSource('shopify')).toBe(false);
    expect(isCsvImportSource(null)).toBe(false);
  });
});
