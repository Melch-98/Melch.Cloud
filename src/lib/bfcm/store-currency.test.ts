import { describe, expect, it } from 'vitest';
import { pacingDisplayFigures, resolveBfcmDisplayCurrency, resolveBfcmStoreCurrency } from '@/lib/bfcm/store-currency';

const rates = { USD: 1, CAD: 1.38 };

function figures(input: {
  store: string;
  meta: string;
  google?: string;
  display?: string;
}) {
  return pacingDisplayFigures({
    storeCurrency: input.store,
    displayCurrency: input.display || resolveBfcmDisplayCurrency({ requested: 'AUTO', storeCurrency: input.store }),
    metaCurrency: input.meta,
    googleCurrency: input.google || input.meta,
    fxRates: rates,
    todayRevenue: 200,
    todayNcRevenue: 80,
    l7Revenue: 140,
    sameDayRevenue: 70,
    metaSpend: 138,
    googleSpend: 69,
    amerNcRevenue: 100,
    amerMetaSpend: 50,
    amerGoogleSpend: 25,
    amerOtherSpend: 0,
  });
}

describe('BFCM store currency', () => {
  it('prefers daily_pnl.currency over an empty shopify_stores lookup', () => {
    expect(resolveBfcmStoreCurrency({ pnlCurrency: 'CAD', shopCurrency: null })).toEqual({
      code: 'CAD',
      source: 'daily_pnl',
    });
    expect(resolveBfcmStoreCurrency({ pnlCurrency: 'USD', shopCurrency: null })).toEqual({
      code: 'USD',
      source: 'daily_pnl',
    });
    expect(resolveBfcmStoreCurrency({ pnlCurrency: 'cad', shopCurrency: 'USD' }).code).toBe('CAD');
    expect(resolveBfcmStoreCurrency({ pnlCurrency: null, shopCurrency: 'CAD' })).toEqual({
      code: 'CAD',
      source: 'shop',
    });
    expect(resolveBfcmStoreCurrency({ pnlCurrency: null, shopCurrency: null }).source).toBe('default_usd');
  });

  it('uses the store currency when Auto is selected', () => {
    expect(resolveBfcmDisplayCurrency({ requested: 'AUTO', storeCurrency: 'CAD' })).toBe('CAD');
    expect(resolveBfcmDisplayCurrency({ requested: 'AUTO', storeCurrency: 'USD' })).toBe('USD');
    expect(resolveBfcmDisplayCurrency({ requested: 'GBP', storeCurrency: 'CAD' })).toBe('GBP');
  });
});

describe('CAD store and CAD ad account', () => {
  it('leaves sales, aMER, and ad spend in CAD', () => {
    const shown = figures({ store: 'CAD', meta: 'CAD' });
    expect(shown.todayRevenue).toBe(200);
    expect(shown.l7Revenue).toBe(140);
    expect(shown.sameDayRevenue).toBe(70);
    expect(shown.metaSpend).toBe(138);
    expect(shown.googleSpend).toBe(69);
    expect(shown.amerNcRevenue).toBe(100);
    expect(shown.amerMetaSpend).toBe(50);
    expect(shown.amerGoogleSpend).toBe(25);
  });
});

describe('USD store and CAD ad account', () => {
  it('keeps store-currency sales and aMER in USD and converts CAD ad spend', () => {
    const shown = figures({ store: 'USD', meta: 'CAD' });
    expect(shown.todayRevenue).toBe(200);
    expect(shown.todayNcRevenue).toBe(80);
    expect(shown.l7Revenue).toBe(140);
    expect(shown.sameDayRevenue).toBe(70);
    expect(shown.metaSpend).toBeCloseTo(100, 5);
    expect(shown.googleSpend).toBeCloseTo(50, 5);
    expect(shown.amerNcRevenue).toBe(100);
    expect(shown.amerMetaSpend).toBe(50);
    expect(shown.amerGoogleSpend).toBe(25);
  });
});
