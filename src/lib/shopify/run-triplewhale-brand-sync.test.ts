import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/redis', () => ({
  getSyncRateLimiter: () => null,
  acquireSyncLock: async () => true,
  releaseSyncLock: async () => {},
  invalidatePnlCache: async () => {},
}));

import { runTripleWhaleBrandSync } from '@/lib/shopify/run-triplewhale-brand-sync';

const ORDER_KEYS = [
  'nc_orders',
  'nc_revenue',
  'rc_orders',
  'rc_revenue',
  'gross_sales',
  'discounts',
  'refunds',
  'taxes',
  'shipping',
] as const;

type PnlRow = Record<string, unknown>;

const remote = {
  blended: [] as Array<Record<string, unknown>>,
  ads: [] as Array<Record<string, unknown>>,
  metaStatus: 200,
  metaBody: { data: [] as Array<Record<string, unknown>> },
  googleStatus: 200,
  googleText: '{"results":[]}',
};

const timeline: string[] = [];
const upserts: Array<{ table: string; rows: PnlRow[]; options?: { defaultToNull?: boolean; onConflict?: string } }> = [];

function blendedDay(date: string, gross: number) {
  return {
    event_date: date,
    orders_count: 2,
    new_customer_orders: 1,
    new_customer_revenue: 40,
    gross_product_sales: gross,
    order_revenue: 90,
    discounts: 5,
    refund_money: 1,
    taxes: 3,
    shipping_price: 4,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createSupabase(brand: Record<string, unknown>) {
  return {
    from(table: string) {
      const api = {
        select(columns: string) {
          timeline.push(`select:${table}:${columns}`);
          return api;
        },
        eq() {
          return api;
        },
        single: async () => {
          if (table === 'brands') return { data: brand, error: null };
          return { data: null, error: { message: 'not found' } };
        },
        maybeSingle: async () => ({ data: null, error: null }),
        upsert(rows: PnlRow[], options?: { defaultToNull?: boolean; onConflict?: string }) {
          upserts.push({ table, rows, options });
          return { error: null };
        },
      };
      return api;
    },
  };
}

async function runSync(brandExtras: Record<string, unknown> = {}) {
  const brand = {
    id: 'brand-oj',
    name: 'Organic Jaguar',
    shopify_store_domain: 'organicjaguar.myshopify.com',
    meta_ad_account_id: 'act_111',
    google_ads_customer_id: null,
    ...brandExtras,
  };
  const response = await runTripleWhaleBrandSync(createSupabase(brand), {
    brandId: brand.id,
    startDate: '2026-09-14',
    endDate: '2026-09-16',
  });
  const body = (await response.json()) as {
    success?: boolean;
    warnings?: string[];
    ad_spend_errors?: string[];
    daysUpserted?: number;
  };
  const pnl = upserts.find((call) => call.table === 'daily_pnl');
  return { response, body, pnl };
}

function rowOn(rows: PnlRow[] | undefined, date: string) {
  return rows?.find((row) => row.date === date);
}

beforeEach(() => {
  timeline.length = 0;
  upserts.length = 0;
  remote.blended = [];
  remote.ads = [];
  remote.metaStatus = 200;
  remote.metaBody = { data: [] };
  remote.googleStatus = 200;
  remote.googleText = '{"results":[]}';
  vi.stubEnv('TRIPLEWHALE_API_KEY', 'tw-test');
  vi.stubEnv('META_ACCESS_TOKEN', 'meta-test');
  vi.stubEnv('PIPEBOARD_API_TOKEN', '');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    timeline.push(`fetch:${url}`);
    if (url.includes('triplewhale.com')) {
      const query = String(JSON.parse(String(init?.body)).query);
      if (query.includes('blended_stats')) {
        timeline.push('tw:blended_stats');
        return jsonResponse(remote.blended);
      }
      if (query.includes('ads_table')) {
        timeline.push('tw:ads_table');
        return jsonResponse(remote.ads);
      }
      if (query.includes('orders_table')) {
        timeline.push('tw:orders_table');
        return jsonResponse([]);
      }
    }
    if (url.includes('graph.facebook.com')) return jsonResponse(remote.metaBody, remote.metaStatus);
    if (url.includes('pipeboard.co')) return jsonResponse({ result: { content: [{ text: remote.googleText }] } }, remote.googleStatus);
    return jsonResponse({ error: 'unexpected' }, 500);
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('runTripleWhaleBrandSync native ad spend', () => {
  it('writes Meta daily spend when Triple Whale facebook-ads is 0', async () => {
    remote.blended = [blendedDay('2026-09-14', 100), blendedDay('2026-09-15', 50)];
    remote.ads = [
      { event_date: '2026-09-14', channel: 'facebook-ads', spend: 0 },
      { event_date: '2026-09-15', channel: 'facebook-ads', spend: 0 },
      { event_date: '2026-09-14', channel: 'google-ads', spend: 12.5 },
      { event_date: '2026-09-15', channel: 'tiktok-ads', spend: 4 },
    ];
    remote.metaBody = {
      data: [
        { date_start: '2026-09-14', spend: '812.50' },
        { date_start: '2026-09-15', spend: '940.00' },
      ],
    };

    const { response, body, pnl } = await runSync();
    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.daysUpserted).toBe(3);
    expect(body.warnings).toEqual([
      'Triple Whale facebook-ads spend is 0 for Organic Jaguar (2026-09-14 to 2026-09-16) but Meta reports 1752.5',
    ]);
    expect(console.warn).toHaveBeenCalledWith(body.warnings?.[0]);

    const adsAt = timeline.findIndex((entry) => entry.includes('ads_table'));
    const selectAt = timeline.findIndex((entry) => entry.includes('meta_ad_account_id, google_ads_customer_id'));
    const metaAt = timeline.findIndex((entry) => entry.includes('graph.facebook.com') && entry.includes('act_111'));
    expect(adsAt).toBeGreaterThan(-1);
    expect(selectAt).toBeGreaterThan(adsAt);
    expect(metaAt).toBeGreaterThan(selectAt);

    const rows = pnl?.rows ?? [];
    const day14 = rowOn(rows, '2026-09-14');
    const day15 = rowOn(rows, '2026-09-15');
    const day16 = rowOn(rows, '2026-09-16');
    expect(day14?.meta_spend).toBe(812.5);
    expect(day14?.google_spend).toBe(12.5);
    expect(day14?.other_spend).toBeUndefined();
    expect(day14?.nc_orders).toBe(1);
    expect(day14?.nc_revenue).toBe(40);
    expect(day14?.rc_orders).toBe(1);
    expect(day14?.rc_revenue).toBe(50);
    expect(day14?.gross_sales).toBe(100);
    expect(day14?.discounts).toBe(-5);
    expect(day14?.refunds).toBe(-1);
    expect(day14?.taxes).toBe(3);
    expect(day14?.shipping).toBe(4);

    expect(day15?.meta_spend).toBe(940);
    expect(day15?.google_spend).toBeUndefined();
    expect(day15?.other_spend).toBe(4);
    expect(day15?.gross_sales).toBe(50);

    expect(day16?.meta_spend).toBe(0);
    expect(day16?.google_spend).toBeUndefined();
    for (const key of ORDER_KEYS) expect(day16).not.toHaveProperty(key);
    expect(pnl?.options).toEqual({ onConflict: 'brand_id,date', defaultToNull: false });
  });

  it('keeps the Triple Whale meta value when the Meta fetch fails', async () => {
    remote.blended = [
      blendedDay('2026-09-14', 100),
      blendedDay('2026-09-15', 50),
      blendedDay('2026-09-16', 20),
    ];
    remote.ads = [
      { event_date: '2026-09-14', channel: 'facebook-ads', spend: 800 },
      { event_date: '2026-09-15', channel: 'facebook-ads', spend: 0 },
      { event_date: '2026-09-14', channel: 'google-ads', spend: 12.5 },
    ];
    remote.metaStatus = 500;
    remote.metaBody = {
      data: [{ date_start: '2026-09-14', spend: '1.00' }],
    };

    const { response, body, pnl } = await runSync();
    expect(response.status).toBe(200);
    expect(body.warnings).toBeUndefined();
    expect(body.ad_spend_errors).toEqual(['Meta: request failed']);

    const rows = pnl?.rows ?? [];
    const day14 = rowOn(rows, '2026-09-14');
    const day15 = rowOn(rows, '2026-09-15');
    const day16 = rowOn(rows, '2026-09-16');
    expect(day14?.meta_spend).toBe(800);
    expect(day14?.google_spend).toBe(12.5);
    expect(day14?.gross_sales).toBe(100);
    expect(day15?.meta_spend).toBe(0);
    expect(day15?.gross_sales).toBe(50);
    expect(day16?.meta_spend).toBeUndefined();
    expect(day16?.gross_sales).toBe(20);
    expect(console.warn).not.toHaveBeenCalledWith(expect.stringContaining('but Meta reports'));
  });

  it('writes Google daily spend, including 0, when the Google fetch succeeds', async () => {
    remote.blended = [blendedDay('2026-09-14', 100), blendedDay('2026-09-15', 50)];
    remote.ads = [
      { event_date: '2026-09-14', channel: 'facebook-ads', spend: 10 },
      { event_date: '2026-09-14', channel: 'google-ads', spend: 12.5 },
      { event_date: '2026-09-15', channel: 'google-ads', spend: 7 },
    ];
    remote.metaBody = { data: [{ date_start: '2026-09-14', spend: '10.00' }] };
    remote.googleText = JSON.stringify({
      results: [{ segments: { date: '2026-09-14' }, metrics: { costMicros: '20000000' } }],
    });
    vi.stubEnv('PIPEBOARD_API_TOKEN', 'pipe-test');

    const { body, pnl } = await runSync({ google_ads_customer_id: '123-456-7890' });

    expect(body.warnings).toBeUndefined();
    const rows = pnl?.rows ?? [];
    expect(rowOn(rows, '2026-09-14')?.google_spend).toBe(20);
    expect(rowOn(rows, '2026-09-14')?.meta_spend).toBe(10);
    expect(rowOn(rows, '2026-09-14')?.gross_sales).toBe(100);
    expect(rowOn(rows, '2026-09-15')?.google_spend).toBe(0);
    expect(rowOn(rows, '2026-09-15')?.meta_spend).toBe(0);
    expect(rowOn(rows, '2026-09-16')?.google_spend).toBe(0);
    expect(rowOn(rows, '2026-09-16')?.meta_spend).toBe(0);
    for (const key of ORDER_KEYS) expect(rowOn(rows, '2026-09-16')).not.toHaveProperty(key);
    expect(timeline.some((entry) => entry.includes('pipeboard.co'))).toBe(true);
  });

  it('keeps Triple Whale google spend when the Google fetch fails', async () => {
    remote.blended = [blendedDay('2026-09-14', 80), blendedDay('2026-09-15', 40)];
    remote.ads = [
      { event_date: '2026-09-14', channel: 'google-ads', spend: 12.5 },
      { event_date: '2026-09-14', channel: 'facebook-ads', spend: 0 },
    ];
    remote.metaBody = { data: [{ date_start: '2026-09-14', spend: '600.00' }] };
    remote.googleStatus = 500;
    vi.stubEnv('PIPEBOARD_API_TOKEN', 'pipe-test');

    const { body, pnl } = await runSync({ google_ads_customer_id: '123-456-7890' });
    expect(body.ad_spend_errors).toContain('Google: HTTP 500');
    const rows = pnl?.rows ?? [];
    expect(rowOn(rows, '2026-09-14')?.google_spend).toBe(12.5);
    expect(rowOn(rows, '2026-09-14')?.meta_spend).toBe(600);
    expect(rowOn(rows, '2026-09-14')?.gross_sales).toBe(80);
    expect(rowOn(rows, '2026-09-15')?.google_spend).toBeUndefined();
    expect(rowOn(rows, '2026-09-15')?.meta_spend).toBe(0);
    expect(rowOn(rows, '2026-09-15')?.gross_sales).toBe(40);
  });
});
