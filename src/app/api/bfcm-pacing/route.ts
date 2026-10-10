import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { currencyFromShopInfo, getFxRates, resolveReportingCurrency, toReportingCurrency } from '@/lib/currency';
import {
  alignLastYear,
  bfcmWindow,
  lastYearSalesStatus,
  orderFeed,
  shopDayRangeIso,
  shopTodayAndL7,
  type BfcmDay,
} from '@/lib/bfcm/calendar';
import { googleTodayQuery, sumGoogleToday } from '@/lib/bfcm/google-today';
import { enrichOrders, loadOrderFreshness, loadOrdersBetween } from '@/lib/bfcm/load-orders';
import {
  averageHourlySpend,
  emptyHourlySpend,
  insightUrl,
  clampMetaRange,
  l7HourlyInsightQuery,
  metaCollect,
  metaGet,
  metaHistoryRanges,
  parseHourlySpendRows,
  readMetaAccountCache,
  rememberMetaAccount,
  type HourlySpend,
  type MetaAccountCache,
} from '@/lib/bfcm/meta-insights';
import { merRatio } from '@/lib/bfcm/pacing';
import {
  averageSalesByHour,
  daySalesOrEmpty,
  emptyDaySales,
  salesByDay,
  type DaySales,
  type HourSales,
} from '@/lib/bfcm/shopify-sales';
import { fetchGoogleAdsCurrency, gaqlQueryStrict, resolvePipeboardToken } from '@/lib/pipeboard-google';
import { shopLocalDay } from '@/lib/shopify/shop-time';
import { resolveShopIanaTimeZone } from '@/lib/shopify/shop-timezone';
import { resolveOrderConnection } from '@/lib/shopify/order-connection';
import { webhookStatusKey, type StoredWebhookStatus } from '@/lib/shopify/webhook-status';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const TODAY_TTL = 60 * 1000;
const HISTORY_TTL = 15 * 60 * 1000;
const META_BASE = 'https://graph.facebook.com/v21.0';
const ATTRIBUTION = 'action_attribution_windows=["7d_click","1d_view"]';
const PURCHASE_TYPES = ['purchase', 'omni_purchase', 'offsite_conversion.fb_pixel_purchase'];

interface DailyPoint {
  date: string;
  dayLabel: string;
  spend: number;
  purchases: number;
  purchaseValue: number;
  roas: number;
}

interface CampaignToday {
  campaignId: string;
  campaignName: string;
  objective: string;
  status: string;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpm: number;
  cpc: number;
  purchases: number;
  purchaseValue: number;
  roas: number;
  cpa: number;
  l7DailySpend: number;
  l7Roas: number;
  spendPaceVsL7: number;
  roasDeltaVsL7: number;
}

interface HistorySlice {
  l7HourlyAvg: HourlySpend[];
  l7DailyAvg: number;
  l7DailyHourly: { date: string; hourlySpend: HourlySpend[]; dayTotal: number }[];
  l7TotalSpend: number;
  l7TotalPurchaseValue: number;
  l7Roas: number;
  lyWindow: DailyPoint[];
  tyWindow: DailyPoint[];
  lySameDay: {
    dayLabel: string;
    date: string;
    totalSpend: number;
    hourlySpend: HourlySpend[];
    purchases: number;
    purchaseValue: number;
    roas: number;
  };
  campaignL7: Record<string, { spend: number; purchaseValue: number }>;
  shopifyL7Hourly: HourSales[];
  shopifyL7DailyAvg: number;
  shopifyLastYear: DaySales | null;
  earliestOrderDay: string | null;
  pnl: { ncRev: number; meta: number; google: number; other: number; hasData: boolean };
  warnings: string[];
}

interface LiveSlice {
  hourlySpend: HourlySpend[];
  totalSpendSoFar: number;
  purchases: number;
  purchaseValue: number;
  campaigns: CampaignToday[];
  shopifyToday: DaySales;
  newestOrderAt: string | null;
  google: {
    configured: boolean;
    spend: number | null;
    conversionValue: number | null;
    conversions: number | null;
    roas: number | null;
    currency: string | null;
    valueLabel: 'conversion value' | 'unavailable';
    error: string | null;
  };
  metaOk: boolean;
  metaCurrency: string | null;
  feed: { feed: string; label: string };
  warnings: string[];
}

const historyCache = new Map<string, { data: HistorySlice; ts: number }>();
const liveCache = new Map<string, { data: LiveSlice; ts: number }>();
const metaAccountCache: MetaAccountCache = new Map();

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

function roundHours(hours: HourSales[]): HourSales[] {
  return hours.map((hour) => ({
    ...hour,
    revenue: r2(hour.revenue),
    ncRevenue: r2(hour.ncRevenue),
    rcRevenue: r2(hour.rcRevenue),
  }));
}

function roundDay(day: DaySales): DaySales {
  return {
    ...day,
    revenue: r2(day.revenue),
    aov: r2(day.aov),
    ncRevenue: r2(day.ncRevenue),
    rcRevenue: r2(day.rcRevenue),
    hourly: roundHours(day.hourly),
  };
}

function readCache<T>(map: Map<string, { data: T; ts: number }>, key: string, ttl: number, bypass: boolean): T | null {
  if (bypass) return null;
  const hit = map.get(key);
  if (!hit || Date.now() - hit.ts > ttl) return null;
  return hit.data;
}

function firstAction(actions: any[] | undefined): number {
  if (!Array.isArray(actions)) return 0;
  for (const type of PURCHASE_TYPES) {
    const found = actions.find((action) => action?.action_type === type);
    if (found) return parseFloat(found.value) || 0;
  }
  return 0;
}

function ratio(spend: number, value: number): number {
  return spend > 0 ? value / spend : 0;
}

function dailyFromRows(rows: any[], days: BfcmDay[]): DailyPoint[] {
  return rows.map((row) => {
    const spend = parseFloat(row.spend || '0');
    const purchaseValue = firstAction(row.action_values);
    const known = days.find((day) => day.date === row.date_start);
    return {
      date: row.date_start,
      dayLabel: known?.dayLabel || row.date_start,
      spend,
      purchases: firstAction(row.actions),
      purchaseValue,
      roas: ratio(spend, purchaseValue),
    };
  });
}

function fillWindow(days: BfcmDay[], rows: DailyPoint[]): DailyPoint[] {
  return days.map((day) => {
    const found = rows.find((row) => row.date === day.date);
    return (
      found || {
        date: day.date,
        dayLabel: day.dayLabel,
        spend: 0,
        purchases: 0,
        purchaseValue: 0,
        roas: 0,
      }
    );
  });
}

async function metaAccount(token: string, adAccountId: string): Promise<{ currency: string; timezone: string }> {
  const cached = readMetaAccountCache(metaAccountCache, adAccountId);
  if (cached) return cached;
  const account = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
  const json = await metaGet(`${META_BASE}/${account}?fields=currency,timezone_name`, token);
  const details = {
    currency: typeof json?.currency === 'string' ? json.currency : 'USD',
    timezone: typeof json?.timezone_name === 'string' ? json.timezone_name : 'UTC',
  };
  rememberMetaAccount(metaAccountCache, adAccountId, details);
  return details;
}

export async function GET(request: NextRequest) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const authHeader = request.headers.get('authorization');
  if (!authHeader) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const token = authHeader.replace('Bearer ', '');
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(token);
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('users_profile')
    .select('role, brand_id')
    .eq('id', user.id)
    .single();
  if (!profile || !['admin', 'strategist', 'founder'].includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const brandId = searchParams.get('brandId');
  const year = searchParams.get('year') ? parseInt(searchParams.get('year') as string, 10) : new Date().getFullYear();
  const baseCurrencyParam = (searchParams.get('baseCurrency') || 'AUTO').toUpperCase();
  const bypassCache = searchParams.get('refresh') === '1';
  if (!brandId) return NextResponse.json({ error: 'brandId required' }, { status: 400 });
  if (profile.role !== 'admin' && profile.brand_id !== brandId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data: brand, error: brandError } = await supabase.from('brands').select('*').eq('id', brandId).single();
  if (brandError || !brand) return NextResponse.json({ error: 'Brand not found' }, { status: 404 });

  let shopCurrency: string | null = null;
  if (brand.shopify_store_domain) {
    const { data: storeRow } = await supabase
      .from('shopify_stores')
      .select('shop_info')
      .eq('shop_domain', brand.shopify_store_domain)
      .maybeSingle();
    shopCurrency = currencyFromShopInfo(storeRow?.shop_info);
  }
  const reporting = resolveReportingCurrency({ shopCurrency });
  const display = resolveReportingCurrency({ override: baseCurrencyParam, shopCurrency });
  const reportingCurrency = reporting.code;
  const baseCurrency = display.code;

  const warnings: string[] = [];
  let metaToken = process.env.META_ACCESS_TOKEN || '';
  if (!metaToken) {
    const { data: settings } = await supabase.from('app_settings').select('value').eq('key', 'meta_access_token').maybeSingle();
    metaToken = settings?.value || '';
  }
  const metaConfigured = !!(brand.meta_ad_account_id && String(brand.meta_ad_account_id).trim());
  const metaReady = metaConfigured && !!metaToken;
  if (metaConfigured && !metaToken) warnings.push('Meta account is set, but no access token is configured.');
  if (!metaConfigured) warnings.push('No Meta ad account. Showing Shopify and Google only.');

  const shopZone = await resolveShopIanaTimeZone(supabase, {
    id: brand.id,
    name: brand.name,
    shopify_store_domain: brand.shopify_store_domain,
    shopify_client_id: brand.shopify_client_id,
    shopify_client_secret: brand.shopify_client_secret,
  });
  let timezone = shopZone.timeZone;
  let timezoneSource: 'shop' | 'ad_account' | 'utc' = shopZone.source === 'utc_fallback' ? 'utc' : 'shop';
  let accountTimeZone = timezone;
  let metaCurrency = 'USD';
  if (metaReady) {
    try {
      const account = await metaAccount(metaToken, brand.meta_ad_account_id);
      metaCurrency = account.currency;
      if (account.timezone) {
        accountTimeZone = account.timezone;
        if (shopZone.source === 'utc_fallback' && account.timezone !== 'UTC') {
          timezone = account.timezone;
          timezoneSource = 'ad_account';
        }
      }
    } catch (err) {
      warnings.push(`Meta account lookup failed: ${err instanceof Error ? err.message : 'request failed'}`);
    }
  } else if (timezoneSource === 'utc') {
    warnings.push('Shop timezone is not cached. Today is using UTC until the shop zone is known.');
  }

  const now = new Date();
  const clock = shopTodayAndL7(now, timezone);
  const metaClock = shopTodayAndL7(now, accountTimeZone);
  const window = bfcmWindow(year);
  const alignment = alignLastYear(clock.today);
  const historyKey = `bfcm:hist:${brandId}:${year}:${clock.today}:${metaClock.today}:${baseCurrency}:${timezone}:${accountTimeZone}`;
  const liveKey = `bfcm:live:${brandId}:${clock.today}:${metaClock.today}:${baseCurrency}:${timezone}:${accountTimeZone}`;
  let history = readCache(historyCache, historyKey, HISTORY_TTL, bypassCache);
  let live = readCache(liveCache, liveKey, TODAY_TTL, bypassCache);

  const fxRates = await getFxRates();

  if (!history || !live) {
    const connection = await resolveOrderConnection(supabase, brand);
    let webhooksOk = false;
    const { data: webhookRow } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', webhookStatusKey(brand.id))
      .maybeSingle();
    if (webhookRow?.value) {
      try {
        webhooksOk = (JSON.parse(webhookRow.value) as StoredWebhookStatus).ok === true;
      } catch {
        webhooksOk = false;
      }
    }
    const feed = orderFeed({ connection: connection.connection, webhooksOk });

    if (!history) {
      history = await loadHistory({
        supabase,
        brand,
        brandId,
        metaToken,
        metaReady,
        adAccountId: brand.meta_ad_account_id,
        clock,
        metaClock,
        window,
        alignment,
        timezone,
        connection,
      });
      if (!history.warnings.some((warning) => warning.includes('cannot be in the future'))) {
        historyCache.set(historyKey, { data: history, ts: Date.now() });
      }
    }
    if (!live) {
      live = await loadLive({
        supabase,
        brand,
        brandId,
        metaToken,
        metaReady,
        metaCurrency,
        adAccountId: brand.meta_ad_account_id,
        today: clock.today,
        metaToday: metaClock.today,
        timezone,
        connection,
        campaignL7: history.campaignL7,
        feed,
      });
      if (!live.warnings.some((warning) => warning.startsWith('Shopify orders failed'))) {
        liveCache.set(liveKey, { data: live, ts: Date.now() });
      }
    }
  }

  if (!history || !live) {
    return NextResponse.json({ error: 'Failed to fetch BFCM pacing data' }, { status: 500 });
  }
  const historyWarnings = history.warnings || [];
  const liveWarnings = live.warnings || [];
  const allWarnings = [...warnings, ...historyWarnings, ...liveWarnings];
  const metaCurrencyResolved = live.metaCurrency || (metaReady ? metaCurrency : null);
  const metaOk = metaReady && live.metaOk;
  const googleOk = live.google.configured && !live.google.error && live.google.spend != null;
  const shopifyCurrency = shopCurrency || reportingCurrency;
  const revenueReporting = toReportingCurrency(live.shopifyToday.revenue, shopifyCurrency, reportingCurrency, fxRates);
  const ncReporting = toReportingCurrency(live.shopifyToday.ncRevenue, shopifyCurrency, reportingCurrency, fxRates);
  const metaSpendReporting = metaOk
    ? toReportingCurrency(live.totalSpendSoFar, metaCurrencyResolved || reportingCurrency, reportingCurrency, fxRates)
    : 0;
  const googleSpendReporting = googleOk
    ? toReportingCurrency(live.google.spend || 0, live.google.currency || reportingCurrency, reportingCurrency, fxRates)
    : 0;
  const spendForMer = (metaConfigured && !metaOk) || (live.google.configured && !googleOk)
    ? null
    : metaSpendReporting + googleSpendReporting;
  const mer = spendForMer == null ? null : merRatio(revenueReporting, spendForMer);
  const amer = spendForMer == null ? null : merRatio(ncReporting, spendForMer);
  const googleSpend = live.google.spend ?? 0;
  const acquisitionSpend = live.totalSpendSoFar + googleSpend;

  const response = {
    currency: metaCurrencyResolved || reportingCurrency,
    reportingCurrency,
    timezone,
    timezoneSource,
    grossMarginPct: brand.gross_margin_pct != null ? Number(brand.gross_margin_pct) : null,
    baseCurrency,
    fxRates,
    currencies: {
      meta: metaOk ? metaCurrencyResolved : null,
      google: live.google.currency,
      shopify: shopifyCurrency,
    },
    warnings: allWarnings,
    meta: {
      available: metaOk,
      configured: metaConfigured,
      reason: metaOk ? null : metaConfigured ? 'Meta data is unavailable for this refresh.' : 'No Meta ad account configured.',
    },
    bfcmWindow: { start: window.start, end: window.end, days: window.days },
    comparison: alignment,
    today: {
      date: clock.today,
      dayLabel: alignment.inWindow ? (window.days.find((day) => day.date === clock.today)?.dayLabel || alignment.dayLabel) : alignment.dayLabel,
      hour: clock.hour,
      minute: clock.minute,
      hourlySpend: live.hourlySpend,
      totalSpendSoFar: r2(live.totalSpendSoFar),
      googleSpend: r2(googleSpend),
      acquisitionSpend: r2(acquisitionSpend),
      purchases: live.purchases,
      purchaseValue: r2(live.purchaseValue),
      roas: ratio(live.totalSpendSoFar, live.purchaseValue),
    },
    l7Baseline: {
      hourlyAvg: history.l7HourlyAvg.map((point) => ({ hour: point.hour, spend: r2(point.spend) })),
      dailyAvg: r2(history.l7DailyAvg),
      dailyHourly: history.l7DailyHourly,
      roas: history.l7Roas,
      totalSpend: r2(history.l7TotalSpend),
      totalPurchaseValue: r2(history.l7TotalPurchaseValue),
    },
    aMer: {
      available: history.pnl.hasData,
      l7NcRevenue: r2(history.pnl.ncRev),
      l7MetaSpend: r2(history.pnl.meta),
      l7GoogleSpend: r2(history.pnl.google),
      l7OtherSpend: r2(history.pnl.other),
      l7TotalSpend: r2(history.pnl.meta + history.pnl.google + history.pnl.other),
      l7: history.pnl.hasData && history.pnl.meta + history.pnl.google + history.pnl.other > 0
        ? r2(history.pnl.ncRev / (history.pnl.meta + history.pnl.google + history.pnl.other))
        : null,
    },
    lastYearBfcm: {
      sameDay: history.lySameDay,
      fullWindow: history.lyWindow,
    },
    thisYearBfcm: { fullWindow: clock.today < window.start ? [] : history.tyWindow },
    campaigns: live.campaigns,
    google: live.google,
    shopify: {
      currency: shopifyCurrency,
      today: roundDay(live.shopifyToday),
      l7HourlyAvg: roundHours(history.shopifyL7Hourly),
      l7DailyAvgRevenue: r2(history.shopifyL7DailyAvg),
      lastYear: {
        status: lastYearSalesStatus(alignment.date, history.earliestOrderDay),
        date: alignment.date,
        dayLabel: alignment.dayLabel,
        rule: alignment.rule,
        earliestOrderDay: history.earliestOrderDay,
        sales: history.shopifyLastYear ? roundDay(history.shopifyLastYear) : null,
      },
      mer: mer == null ? null : r2(mer),
      amer: amer == null ? null : r2(amer),
      revenueReporting: r2(revenueReporting),
      ncRevenueReporting: r2(ncReporting),
      spendReporting: spendForMer == null ? null : r2(spendForMer),
      freshness: {
        asOf: live.newestOrderAt,
        feed: live.feed.feed,
        label: live.feed.label,
      },
    },
  };

  return NextResponse.json(response);
}

async function loadHistory(input: {
  supabase: any;
  brand: any;
  brandId: string;
  metaToken: string;
  metaReady: boolean;
  adAccountId: string | null;
  clock: { today: string; l7: string[] };
  metaClock: { today: string; l7: string[] };
  window: ReturnType<typeof bfcmWindow>;
  alignment: ReturnType<typeof alignLastYear>;
  timezone: string;
  connection: { domain: string | null; token: string | null };
}): Promise<HistorySlice> {
  const warnings: string[] = [];
  const lastWindow = bfcmWindow(Number(input.clock.today.slice(0, 4)) - 1);
  const emptyLy = {
    dayLabel: input.alignment.dayLabel,
    date: input.alignment.date,
    totalSpend: 0,
    hourlySpend: emptyHourlySpend(),
    purchases: 0,
    purchaseValue: 0,
    roas: 0,
  };
  const slice: HistorySlice = {
    l7HourlyAvg: emptyHourlySpend(),
    l7DailyAvg: 0,
    l7DailyHourly: input.clock.l7.map((date) => ({ date, hourlySpend: emptyHourlySpend(), dayTotal: 0 })),
    l7TotalSpend: 0,
    l7TotalPurchaseValue: 0,
    l7Roas: 0,
    lyWindow: fillWindow(lastWindow.days, []),
    tyWindow: fillWindow(input.window.days, []),
    lySameDay: emptyLy,
    campaignL7: {},
    shopifyL7Hourly: emptyDaySales().hourly,
    shopifyL7DailyAvg: 0,
    shopifyLastYear: null,
    earliestOrderDay: null,
    pnl: { ncRev: 0, meta: 0, google: 0, other: 0, hasData: false },
    warnings,
  };

  let earliestAt: string | null = null;
  try {
    const freshness = await loadOrderFreshness(input.supabase, input.brandId);
    earliestAt = freshness.earliestAt;
    slice.earliestOrderDay = earliestAt ? shopLocalDay(earliestAt, input.timezone) : null;
  } catch (err) {
    warnings.push(`Shopify freshness failed: ${err instanceof Error ? err.message : 'query failed'}`);
  }

  const lyStatus = lastYearSalesStatus(input.alignment.date, slice.earliestOrderDay);
  const l7Range = shopDayRangeIso(input.clock.l7[0], input.clock.l7[input.clock.l7.length - 1], input.timezone);
  const lyRange = lyStatus === 'ok' ? shopDayRangeIso(input.alignment.date, input.alignment.date, input.timezone) : null;

  const shopifyL7 = (async () => {
    const orders = await loadOrdersBetween(input.supabase, input.brandId, l7Range.min, l7Range.max);
    await enrichOrders(input.connection.domain, input.connection.token, orders);
    const byDay = salesByDay(orders, input.timezone);
    const days = input.clock.l7.map((day) => daySalesOrEmpty(byDay, day));
    slice.shopifyL7Hourly = averageSalesByHour(days);
    slice.shopifyL7DailyAvg = days.reduce((sum, day) => sum + day.revenue, 0) / days.length;
  })().catch((err) => {
    warnings.push(`Shopify L7 failed: ${err instanceof Error ? err.message : 'query failed'}`);
  });

  const shopifyLy = (async () => {
    if (!lyRange || lyStatus !== 'ok') {
      slice.shopifyLastYear = null;
      return;
    }
    const orders = await loadOrdersBetween(input.supabase, input.brandId, lyRange.min, lyRange.max);
    await enrichOrders(input.connection.domain, input.connection.token, orders);
    slice.shopifyLastYear = daySalesOrEmpty(salesByDay(orders, input.timezone), input.alignment.date);
  })().catch((err) => {
    warnings.push(`Shopify last year failed: ${err instanceof Error ? err.message : 'query failed'}`);
  });

  const pnl = (async () => {
    const { data, error } = await input.supabase
      .from('daily_pnl')
      .select('date, nc_revenue, meta_spend, google_spend, other_spend')
      .eq('brand_id', input.brandId)
      .gte('date', input.clock.l7[0])
      .lte('date', input.clock.l7[input.clock.l7.length - 1]);
    if (error || !data || data.length === 0) return;
    let ncRev = 0;
    let meta = 0;
    let google = 0;
    let other = 0;
    for (const row of data) {
      ncRev += parseFloat(row.nc_revenue || '0');
      meta += parseFloat(row.meta_spend || '0');
      google += parseFloat(row.google_spend || '0');
      other += parseFloat(row.other_spend || '0');
    }
    slice.pnl = { ncRev, meta, google, other, hasData: true };
  })().catch(() => undefined);

  const meta = (async () => {
    if (!input.metaReady || !input.adAccountId) return;
    const account = input.adAccountId;
    const ranges = metaHistoryRanges({
      accountToday: input.metaClock.today,
      l7Since: input.metaClock.l7[0],
      l7Until: input.metaClock.l7[input.metaClock.l7.length - 1],
      lastYearStart: lastWindow.start,
      lastYearEnd: lastWindow.end,
      thisYearStart: input.window.start,
      thisYearEnd: input.window.end,
      sameDay: input.alignment.date,
    });
    const found = (name: string) => ranges.find((range) => range.name === name) || null;
    const rangeUrl = (since: string, until: string, extra: string) =>
      insightUrl(account, `level=account&time_range=${encodeURIComponent(JSON.stringify({ since, until }))}&${extra}&limit=500`);
    const collect = (name: string, extra: string) => {
      const bounded = found(name);
      if (!bounded) return Promise.resolve([] as any[]);
      return metaCollect(rangeUrl(bounded.since, bounded.until, extra), input.metaToken);
    };
    const l7 = found('l7');
    const lyOutside = input.alignment.date < lastWindow.start || input.alignment.date > lastWindow.end;
    const sameDay = found('sameDay');
    const [hourlyRows, l7Agg, lyDaily, tyDaily, lyHourly, lyOutsideTotals, campaignRows] = await Promise.all([
      l7
        ? metaCollect(insightUrl(account, l7HourlyInsightQuery(l7.since, l7.until)), input.metaToken)
        : Promise.resolve([] as any[]),
      collect('l7', `fields=spend,actions,action_values&${ATTRIBUTION}`),
      collect('lastYearWindow', `time_increment=1&fields=spend,actions,action_values&${ATTRIBUTION}`),
      collect('thisYearWindow', `time_increment=1&fields=spend,actions,action_values&${ATTRIBUTION}`),
      sameDay
        ? metaCollect(
            rangeUrl(sameDay.since, sameDay.until, 'breakdowns=hourly_stats_aggregated_by_advertiser_time_zone&fields=spend'),
            input.metaToken
          )
        : Promise.resolve([] as any[]),
      lyOutside && sameDay
        ? metaCollect(rangeUrl(sameDay.since, sameDay.until, `fields=spend,actions,action_values&${ATTRIBUTION}`), input.metaToken)
        : Promise.resolve([] as any[]),
      l7
        ? metaCollect(
            insightUrl(
              account,
              `level=campaign&time_range=${encodeURIComponent(JSON.stringify({ since: l7.since, until: l7.until }))}&fields=spend,actions,action_values&${ATTRIBUTION}&limit=500`
            ),
            input.metaToken
          ).catch(() => [] as any[])
        : Promise.resolve([] as any[]),
    ]);
    const byDay = parseHourlySpendRows(hourlyRows);
    const dailyHourly = input.metaClock.l7.map((date) => {
      const hourlySpend = byDay.get(date) || emptyHourlySpend();
      const dayTotal = hourlySpend.reduce((sum, point) => sum + point.spend, 0);
      return { date, hourlySpend, dayTotal: r2(dayTotal) };
    });
    slice.l7DailyHourly = dailyHourly;
    slice.l7HourlyAvg = averageHourlySpend(dailyHourly.map((day) => day.hourlySpend)).map((point) => ({
      hour: point.hour,
      spend: point.spend,
    }));
    slice.l7DailyAvg = dailyHourly.filter((day) => day.dayTotal > 0).reduce((sum, day, _, arr) => sum + day.dayTotal / arr.length, 0);
    if (l7Agg[0]) {
      slice.l7TotalSpend = parseFloat(l7Agg[0].spend || '0');
      slice.l7TotalPurchaseValue = firstAction(l7Agg[0].action_values);
      slice.l7Roas = ratio(slice.l7TotalSpend, slice.l7TotalPurchaseValue);
    }
    slice.lyWindow = fillWindow(lastWindow.days, dailyFromRows(lyDaily, lastWindow.days));
    slice.tyWindow = fillWindow(input.window.days, dailyFromRows(tyDaily, input.window.days));
    const lyHours = parseHourlySpendRows(lyHourly).get(input.alignment.date) || emptyHourlySpend();
    const lyPoint = slice.lyWindow.find((day) => day.date === input.alignment.date);
    const lyOutsidePoint = lyOutsideTotals[0];
    const lySpend = lyHours.reduce((sum, point) => sum + point.spend, 0);
    const outsideSpend = lyOutsidePoint ? parseFloat(lyOutsidePoint.spend || '0') : 0;
    const outsideValue = lyOutsidePoint ? firstAction(lyOutsidePoint.action_values) : 0;
    slice.lySameDay = {
      dayLabel: input.alignment.dayLabel,
      date: input.alignment.date,
      totalSpend: lyPoint?.spend || outsideSpend || lySpend,
      hourlySpend: lyHours,
      purchases: lyPoint?.purchases || (lyOutsidePoint ? firstAction(lyOutsidePoint.actions) : 0),
      purchaseValue: lyPoint?.purchaseValue || outsideValue,
      roas: lyPoint?.roas || ratio(outsideSpend, outsideValue),
    };
    for (const row of campaignRows) {
      const id = row.campaign_id;
      if (!id) continue;
      const current = slice.campaignL7[id] || { spend: 0, purchaseValue: 0 };
      current.spend += parseFloat(row.spend || '0');
      current.purchaseValue += firstAction(row.action_values);
      slice.campaignL7[id] = current;
    }
  })().catch((err) => {
    warnings.push(`Meta history failed: ${err instanceof Error ? err.message : 'request failed'}`);
  });

  await Promise.all([shopifyL7, shopifyLy, pnl, meta]);
  return slice;
}

async function loadLive(input: {
  supabase: any;
  brand: any;
  brandId: string;
  metaToken: string;
  metaReady: boolean;
  metaCurrency: string;
  adAccountId: string | null;
  today: string;
  metaToday: string;
  timezone: string;
  connection: { domain: string | null; token: string | null; connection: 'shopify_admin' | 'triple_whale' | 'none' };
  campaignL7: Record<string, { spend: number; purchaseValue: number }>;
  feed: { feed: string; label: string };
}): Promise<LiveSlice> {
  const warnings: string[] = [];
  const slice: LiveSlice & { feed: { feed: string; label: string } } = {
    hourlySpend: emptyHourlySpend(),
    totalSpendSoFar: 0,
    purchases: 0,
    purchaseValue: 0,
    campaigns: [],
    shopifyToday: emptyDaySales(),
    newestOrderAt: null,
    google: {
      configured: !!(input.brand.google_ads_customer_id && String(input.brand.google_ads_customer_id).trim()),
      spend: null,
      conversionValue: null,
      conversions: null,
      roas: null,
      currency: null,
      valueLabel: 'unavailable',
      error: null,
    },
    metaOk: false,
    metaCurrency: null,
    warnings,
    feed: input.feed,
  };

  const todayRange = shopDayRangeIso(input.today, input.today, input.timezone);
  const shopify = (async () => {
    const [orders, freshness] = await Promise.all([
      loadOrdersBetween(input.supabase, input.brandId, todayRange.min, todayRange.max),
      loadOrderFreshness(input.supabase, input.brandId),
    ]);
    await enrichOrders(input.connection.domain, input.connection.token, orders);
    slice.shopifyToday = daySalesOrEmpty(salesByDay(orders, input.timezone), input.today);
    slice.newestOrderAt = freshness.newestAt;
  })().catch((err) => {
    warnings.push(`Shopify orders failed: ${err instanceof Error ? err.message : 'query failed'}`);
  });

  const meta = (async () => {
    if (!input.metaReady || !input.adAccountId) return;
    const account = input.adAccountId;
    const today = clampMetaRange(input.metaToday, input.metaToday, input.metaToday);
    if (!today) {
      slice.metaOk = true;
      return;
    }
    const range = encodeURIComponent(JSON.stringify({ since: today.since, until: today.until }));
    const [hourlyRows, totals, campaignRows] = await Promise.all([
      metaCollect(
        insightUrl(account, `level=account&time_range=${range}&breakdowns=hourly_stats_aggregated_by_advertiser_time_zone&fields=spend&limit=500`),
        input.metaToken
      ),
      metaCollect(
        insightUrl(account, `level=account&time_range=${range}&fields=spend,impressions,clicks,actions,action_values&${ATTRIBUTION}&limit=10`),
        input.metaToken
      ),
      metaCollect(
        insightUrl(account, `level=campaign&time_range=${range}&fields=spend,impressions,clicks,actions,action_values&${ATTRIBUTION}&limit=500`),
        input.metaToken
      ),
    ]);
    const hours = parseHourlySpendRows(hourlyRows).get(today.since) || emptyHourlySpend();
    slice.hourlySpend = hours;
    slice.totalSpendSoFar = hours.reduce((sum, point) => sum + point.spend, 0);
    if (totals[0]) {
      slice.purchases = firstAction(totals[0].actions);
      slice.purchaseValue = firstAction(totals[0].action_values);
      if (slice.totalSpendSoFar === 0) slice.totalSpendSoFar = parseFloat(totals[0].spend || '0');
    }
    slice.metaCurrency = input.metaCurrency || null;
    slice.campaigns = await campaignsFromRows(campaignRows, input.campaignL7, input.metaToken);
    slice.metaOk = true;
  })().catch((err) => {
    warnings.push(`Meta today failed: ${err instanceof Error ? err.message : 'request failed'}`);
  });

  const google = (async () => {
    if (!slice.google.configured) return;
    const pipeboardToken = await resolvePipeboardToken(process.env.PIPEBOARD_API_TOKEN, async (key) => {
      const { data } = await input.supabase.from('app_settings').select('value').eq('key', key).maybeSingle();
      return data?.value || null;
    });
    if (!pipeboardToken) {
      slice.google.error = 'PIPEBOARD_API_TOKEN is not configured';
      return;
    }
    const [rows, currency] = await Promise.all([
      gaqlQueryStrict(pipeboardToken, input.brand.google_ads_customer_id, googleTodayQuery(input.today)),
      fetchGoogleAdsCurrency(pipeboardToken, input.brand.google_ads_customer_id),
    ]);
    const totals = sumGoogleToday(rows);
    slice.google.currency = currency;
    slice.google.spend = totals.spend;
    slice.google.conversionValue = totals.conversionValue;
    slice.google.conversions = totals.conversions;
    slice.google.roas = totals.spend > 0 ? totals.conversionValue / totals.spend : null;
    slice.google.valueLabel = 'conversion value';
  })().catch((err) => {
    slice.google.error = err instanceof Error ? err.message : 'Google request failed';
    slice.google.valueLabel = 'unavailable';
  });

  await Promise.all([shopify, meta, google]);
  return slice;
}

async function campaignsFromRows(
  rows: any[],
  l7: Record<string, { spend: number; purchaseValue: number }>,
  token: string
): Promise<CampaignToday[]> {
  const ids = rows.map((row) => row.campaign_id).filter(Boolean);
  const meta: Record<string, { objective: string; status: string }> = {};
  await Promise.all(
    Array.from({ length: Math.ceil(ids.length / 50) }, (_, index) => ids.slice(index * 50, index * 50 + 50)).map(async (chunk) => {
      if (chunk.length === 0) return;
      try {
        const json = await metaGet(`${META_BASE}/?ids=${chunk.join(',')}&fields=objective,effective_status`, token);
        for (const [id, info] of Object.entries(json || {})) {
          const record = info as { objective?: string; effective_status?: string };
          meta[id] = { objective: record?.objective || 'UNKNOWN', status: record?.effective_status || 'UNKNOWN' };
        }
      } catch {
        /* campaign status is optional */
      }
    })
  );

  const campaigns: CampaignToday[] = [];
  for (const row of rows) {
    const id = row.campaign_id;
    if (!id) continue;
    const spend = parseFloat(row.spend || '0');
    if (spend <= 0) continue;
    const purchases = firstAction(row.actions);
    const purchaseValue = firstAction(row.action_values);
    const impressions = parseInt(row.impressions || '0', 10);
    const clicks = parseInt(row.clicks || '0', 10);
    const prior = l7[id] || { spend: 0, purchaseValue: 0 };
    const l7DailySpend = prior.spend / 7;
    const l7Roas = ratio(prior.spend, prior.purchaseValue);
    const info = meta[id] || { objective: 'UNKNOWN', status: 'UNKNOWN' };
    const roas = ratio(spend, purchaseValue);
    campaigns.push({
      campaignId: id,
      campaignName: row.campaign_name || id,
      objective: info.objective,
      status: info.status,
      spend,
      impressions,
      clicks,
      ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
      cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
      cpc: clicks > 0 ? spend / clicks : 0,
      purchases,
      purchaseValue,
      roas,
      cpa: purchases > 0 ? spend / purchases : 0,
      l7DailySpend,
      l7Roas,
      spendPaceVsL7: l7DailySpend > 0 ? spend / l7DailySpend : 0,
      roasDeltaVsL7: prior.spend > 0 ? roas - l7Roas : 0,
    });
  }
  campaigns.sort((a, b) => b.spend - a.spend);
  return campaigns;
}
