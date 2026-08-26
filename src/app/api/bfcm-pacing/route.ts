import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { fetchAccountCurrency, fetchAccountTimezone } from '@/lib/meta-api';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// ─── Types ──────────────────────────────────────────────────────

interface HourlyPoint {
  hour: number;
  spend: number;
}

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
  // L7 trend (previous 7 days, not incl. today)
  l7DailySpend: number;
  l7Roas: number;
  spendPaceVsL7: number; // today spend / l7DailySpend, e.g. 2.3 = 230% of normal
  roasDeltaVsL7: number; // today roas - l7 roas (percentage points)
}

interface BfcmPacingResponse {
  currency: string;
  timezone: string;
  grossMarginPct: number | null;
  bfcmWindow: { start: string; end: string };
  today: {
    date: string;
    dayLabel: string;
    hourlySpend: HourlyPoint[];
    totalSpendSoFar: number;
    purchases: number;
    purchaseValue: number;
    roas: number;
  };
  l7Baseline: {
    hourlyAvg: HourlyPoint[];
    dailyAvg: number;
    dailyHourly: { date: string; hourlySpend: HourlyPoint[]; dayTotal: number }[];
    roas: number;
    totalSpend: number;
    totalPurchaseValue: number;
  };
  lastYearBfcm: {
    sameDay: { dayLabel: string; date: string; totalSpend: number; hourlySpend: HourlyPoint[]; purchases: number; purchaseValue: number; roas: number };
    fullWindow: DailyPoint[];
  };
  thisYearBfcm: {
    fullWindow: DailyPoint[];
  };
  campaigns: CampaignToday[];
}

// ─── BFCM Date Calculation ──────────────────────────────────────

function getBfcmWindow(year: number) {
  let thursdayCount = 0;
  let thanksgiving: Date | null = null;
  for (let d = 1; d <= 30; d++) {
    const date = new Date(year, 10, d);
    if (date.getDay() === 4) {
      thursdayCount++;
      if (thursdayCount === 4) {
        thanksgiving = date;
        break;
      }
    }
  }
  const mondayBefore = new Date(thanksgiving!);
  mondayBefore.setDate(mondayBefore.getDate() - 3);
  const cyberMonday = new Date(thanksgiving!);
  cyberMonday.setDate(cyberMonday.getDate() + 4);

  return { start: mondayBefore, end: cyberMonday, thanksgiving: thanksgiving! };
}

function fmtDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

function getDayLabel(date: Date, thanksgiving: Date): string {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const d = new Date(date);
  if (d.toDateString() === thanksgiving.toDateString()) return 'Thanksgiving';
  const bf = new Date(thanksgiving);
  bf.setDate(bf.getDate() + 1);
  if (d.toDateString() === bf.toDateString()) return 'Black Friday';
  const cm = new Date(thanksgiving);
  cm.setDate(cm.getDate() + 4);
  if (d.toDateString() === cm.toDateString()) return 'Cyber Monday';
  return days[d.getDay()];
}

// ─── Meta action extraction ─────────────────────────────────────
// Meta reports conversions under different action types depending on the
// account's pixel/CAPI setup. Pick the FIRST matching type — NEVER sum across
// aliases (purchase + omni_purchase both present = double count).

const PURCHASE_TYPES = ['purchase', 'omni_purchase', 'offsite_conversion.fb_pixel_purchase'];

function firstAction(actions: any[] | undefined, types: string[]): number {
  if (!actions) return 0;
  for (const t of types) {
    const found = actions.find((a: any) => a.action_type === t);
    if (found) return parseFloat(found.value) || 0;
  }
  return 0;
}

function purchases(actions: any[] | undefined): number {
  return firstAction(actions, PURCHASE_TYPES);
}

function purchaseValue(actionValues: any[] | undefined): number {
  return firstAction(actionValues, PURCHASE_TYPES);
}

function roas(spend: number, value: number): number {
  return spend > 0 ? value / spend : 0;
}

// ─── In-memory cache ────────────────────────────────────────────

const cache = new Map<string, { data: BfcmPacingResponse; ts: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 min

// ─── API Route ──────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const authHeader = request.headers.get('authorization');
  if (!authHeader) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
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
  const yearParam = searchParams.get('year');
  const year = yearParam ? parseInt(yearParam, 10) : new Date().getFullYear();

  if (!brandId) return NextResponse.json({ error: 'brandId required' }, { status: 400 });

  if (profile.role !== 'admin' && profile.brand_id !== brandId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const cacheKey = `bfcm:${brandId}:${year}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return NextResponse.json(cached.data);
  }

  const { data: brand, error: brandError } = await supabase
    .from('brands')
    .select('*')
    .eq('id', brandId)
    .single();

  if (brandError || !brand) {
    return NextResponse.json({ error: 'Brand not found' }, { status: 404 });
  }

  if (!brand.meta_ad_account_id || !brand.meta_ad_account_id.trim()) {
    return NextResponse.json({ error: 'No Meta ad account configured for this brand' }, { status: 400 });
  }

  let metaToken = process.env.META_ACCESS_TOKEN || '';
  if (!metaToken) {
    const { data: settings } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'meta_access_token')
      .single();
    metaToken = settings?.value || '';
  }

  if (!metaToken) {
    return NextResponse.json({ error: 'No Meta access token configured' }, { status: 400 });
  }

  const adAccountId = brand.meta_ad_account_id;
  const META_BASE = 'https://graph.facebook.com/v21.0';
  const ATTRIBUTION = '&action_attribution_windows=["7d_click","1d_view"]';

  try {
    const currency = await fetchAccountCurrency(metaToken, adAccountId);
    const timezone = await fetchAccountTimezone(metaToken, adAccountId);

    const bfcmWindow = getBfcmWindow(year);
    const lastYearBfcmWindow = getBfcmWindow(year - 1);

    const today = new Date();
    const todayStr = fmtDate(today);

    // L7 = the 7 days BEFORE today
    const l7Start = new Date(today);
    l7Start.setDate(l7Start.getDate() - 7);
    const l7End = new Date(today);
    l7End.setDate(l7End.getDate() - 1);
    const l7StartStr = fmtDate(l7Start);
    const l7EndStr = fmtDate(l7End);

    const l7Days: string[] = [];
    for (let i = 1; i <= 7; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      l7Days.push(fmtDate(d));
    }

    // ── Helper: single insights GET (json) ──
    const getInsights = async (path: string): Promise<any> => {
      const res: Response = await fetch(`${META_BASE}/${adAccountId}/insights?${path}&access_token=${metaToken}`);
      if (!res.ok) return {};
      return (await res.json()) as any;
    };

    // ── 1. Today hourly spend (advertiser timezone) ──
    const todayHourlyPromise = getInsights(
      `level=account&time_range=${encodeURIComponent(JSON.stringify({ since: todayStr, until: todayStr }))}&breakdowns=hourly_stats_aggregated_by_advertiser_time_zone&fields=spend&limit=500`
    );

    // ── 2. Today account-level totals (revenue + purchases + roas) ──
    const todayTotalsPromise = getInsights(
      `level=account&time_range=${encodeURIComponent(JSON.stringify({ since: todayStr, until: todayStr }))}&fields=spend,impressions,clicks,actions,action_values&limit=10${ATTRIBUTION}`
    );

    // ── 3. L7 per-day hourly (baseline curve) ──
    const l7HourlyPromises = l7Days.map(async (day): Promise<{ date: string; hourlySpend: HourlyPoint[]; dayTotal: number }> => {
      try {
        const json = await getInsights(
          `level=account&time_range=${encodeURIComponent(JSON.stringify({ since: day, until: day }))}&breakdowns=hourly_stats_aggregated_by_advertiser_time_zone&fields=spend&limit=500`
        );
        const hourlySpend: HourlyPoint[] = Array.from({ length: 24 }, (_, h) => ({ hour: h, spend: 0 }));
        let dayTotal = 0;
        if (json?.data) {
          for (const row of json.data) {
            const hourlyStr = row.hourly_stats_aggregated_by_advertiser_time_zone || '';
            const hourMatch = hourlyStr.match(/^(\d{1,2}):/);
            if (hourMatch) {
              const hour = parseInt(hourMatch[1], 10);
              const spend = parseFloat(row.spend || '0');
              if (hour >= 0 && hour < 24) {
                hourlySpend[hour].spend += spend;
                dayTotal += spend;
              }
            }
          }
        }
        return { date: day, hourlySpend, dayTotal };
      } catch {
        return { date: day, hourlySpend: Array.from({ length: 24 }, (_, h) => ({ hour: h, spend: 0 })), dayTotal: 0 };
      }
    });

    // ── 4. L7 account-level aggregate (roas + daily avg) ──
    const l7AggPromise = getInsights(
      `level=account&time_range=${encodeURIComponent(JSON.stringify({ since: l7StartStr, until: l7EndStr }))}&fields=spend,actions,action_values&limit=10${ATTRIBUTION}`
    );

    // ── 5. Last year BFCM daily (spend + revenue) ──
    const lyStart = fmtDate(lastYearBfcmWindow.start);
    const lyEnd = fmtDate(lastYearBfcmWindow.end);
    const lyDailyPromise = getInsights(
      `level=account&time_range=${encodeURIComponent(JSON.stringify({ since: lyStart, until: lyEnd }))}&time_increment=1&fields=spend,actions,action_values&limit=500${ATTRIBUTION}`
    );

    // ── 6. This year BFCM daily (spend + revenue) ──
    const tyStart = fmtDate(bfcmWindow.start);
    const tyEnd = fmtDate(bfcmWindow.end);
    const tyDailyPromise = getInsights(
      `level=account&time_range=${encodeURIComponent(JSON.stringify({ since: tyStart, until: tyEnd }))}&time_increment=1&fields=spend,actions,action_values&limit=500${ATTRIBUTION}`
    );

    // ── 7. Today campaign-level ──
    const campaignTodayPromise = (async (): Promise<any[]> => {
      const rows: any[] = [];
      let nextUrl: string | null =
        `${META_BASE}/${adAccountId}/insights?level=campaign&time_range=${encodeURIComponent(JSON.stringify({ since: todayStr, until: todayStr }))}&fields=spend,impressions,clicks,ctr,cpm,cpc,actions,action_values&limit=500${ATTRIBUTION}&access_token=${metaToken}`;
      while (nextUrl) {
        const res: Response = await fetch(nextUrl);
        if (!res.ok) break;
        const page = (await res.json()) as any;
        if (page?.data) rows.push(...page.data);
        nextUrl = page?.paging?.next || null;
      }
      return rows;
    })();

    // ── 8. L7 campaign-level (trend baseline) ──
    const campaignL7Promise = (async (): Promise<any[]> => {
      const rows: any[] = [];
      let nextUrl: string | null =
        `${META_BASE}/${adAccountId}/insights?level=campaign&time_range=${encodeURIComponent(JSON.stringify({ since: l7StartStr, until: l7EndStr }))}&fields=spend,actions,action_values&limit=500${ATTRIBUTION}&access_token=${metaToken}`;
      while (nextUrl) {
        const res: Response = await fetch(nextUrl);
        if (!res.ok) break;
        const page = (await res.json()) as any;
        if (page?.data) rows.push(...page.data);
        nextUrl = page?.paging?.next || null;
      }
      return rows;
    })();

    // Await the primary parallel batch
    const [todayHourlyJson, todayTotalsJson, l7DayResults, l7AggJson, lyDailyJson, tyDailyJson, campaignTodayRows, campaignL7Rows] =
      await Promise.all([
        todayHourlyPromise,
        todayTotalsPromise,
        Promise.all(l7HourlyPromises),
        l7AggPromise,
        lyDailyPromise,
        tyDailyPromise,
        campaignTodayPromise,
        campaignL7Promise,
      ]);

    // ── Build today hourly + totals ──
    let todayHourly: HourlyPoint[] = [];
    let totalSpendSoFar = 0;
    if (todayHourlyJson?.data) {
      const hourlyMap = new Map<number, number>();
      for (const row of todayHourlyJson.data) {
        const hourlyStr = row.hourly_stats_aggregated_by_advertiser_time_zone || '';
        const hourMatch = hourlyStr.match(/^(\d{1,2}):/);
        if (hourMatch) {
          const hour = parseInt(hourMatch[1], 10);
          const spend = parseFloat(row.spend || '0');
          hourlyMap.set(hour, (hourlyMap.get(hour) || 0) + spend);
          totalSpendSoFar += spend;
        }
      }
      todayHourly = Array.from({ length: 24 }, (_, i) => ({ hour: i, spend: hourlyMap.get(i) || 0 }));
    }

    let todayPurchases = 0;
    let todayPurchaseValue = 0;
    if (todayTotalsJson?.data?.length) {
      const row = todayTotalsJson.data[0];
      todayPurchases = purchases(row.actions);
      todayPurchaseValue = purchaseValue(row.action_values);
      if (totalSpendSoFar === 0) totalSpendSoFar = parseFloat(row.spend || '0');
    }

    // ── Build L7 baseline ──
    l7DayResults.sort((a, b) => a.date.localeCompare(b.date));
    let l7DailyAvg = 0;
    const l7HourlyAvg: HourlyPoint[] = Array.from({ length: 24 }, (_, i) => ({ hour: i, spend: 0 }));
    const validDays = l7DayResults.filter(d => d.dayTotal > 0);
    const dayCount = validDays.length;
    if (dayCount > 0) {
      l7DailyAvg = validDays.reduce((s, d) => s + d.dayTotal, 0) / dayCount;
      for (let h = 0; h < 24; h++) {
        const hourSum = validDays.reduce((s, d) => s + d.hourlySpend[h].spend, 0);
        l7HourlyAvg[h] = { hour: h, spend: hourSum / dayCount };
      }
    }

    let l7TotalSpend = 0;
    let l7TotalPurchaseValue = 0;
    if (l7AggJson?.data?.length) {
      const row = l7AggJson.data[0];
      l7TotalSpend = parseFloat(row.spend || '0');
      l7TotalPurchaseValue = purchaseValue(row.action_values);
    }

    // ── Build BFCM daily (this year + last year) ──
    const buildDaily = (json: any, thanksgiving: Date): DailyPoint[] => {
      const out: DailyPoint[] = [];
      if (json?.data) {
        for (const row of json.data) {
          const spend = parseFloat(row.spend || '0');
          const p = purchases(row.actions);
          const pv = purchaseValue(row.action_values);
          out.push({
            date: row.date_start,
            dayLabel: getDayLabel(new Date(row.date_start + 'T00:00:00'), thanksgiving),
            spend,
            purchases: p,
            purchaseValue: pv,
            roas: roas(spend, pv),
          });
        }
        out.sort((a, b) => a.date.localeCompare(b.date));
      }
      return out;
    }

    const lastYearFullWindow = buildDaily(lyDailyJson, lastYearBfcmWindow.thanksgiving);
    const thisYearFullWindow = buildDaily(tyDailyJson, bfcmWindow.thanksgiving);

    // Last year same BFCM day (same position in window) — hourly for curve,
    // revenue from the fullWindow row.
    let lastYearSameDay: BfcmPacingResponse['lastYearBfcm']['sameDay'] = {
      dayLabel: '',
      date: '',
      totalSpend: 0,
      hourlySpend: [],
      purchases: 0,
      purchaseValue: 0,
      roas: 0,
    };
    const todayInWindow = (today.getDay() + 7 - bfcmWindow.start.getDay()) % 7;
    if (todayInWindow >= 0 && todayInWindow < lastYearFullWindow.length) {
      const lySameDay = lastYearFullWindow[todayInWindow];
      lastYearSameDay = {
        dayLabel: lySameDay.dayLabel,
        date: lySameDay.date,
        totalSpend: lySameDay.spend,
        hourlySpend: [],
        purchases: lySameDay.purchases,
        purchaseValue: lySameDay.purchaseValue,
        roas: lySameDay.roas,
      };

      // Hourly for last year's same day (curve only)
      const lyHourlyJson = await getInsights(
        `level=account&time_range=${encodeURIComponent(JSON.stringify({ since: lySameDay.date, until: lySameDay.date }))}&breakdowns=hourly_stats_aggregated_by_advertiser_time_zone&fields=spend&limit=500`
      );
      if (lyHourlyJson?.data) {
        const lyHourlyMap = new Map<number, number>();
        for (const row of lyHourlyJson.data) {
          const hourlyStr = row.hourly_stats_aggregated_by_advertiser_time_zone || '';
          const hourMatch = hourlyStr.match(/^(\d{1,2}):/);
          if (hourMatch) {
            const hour = parseInt(hourMatch[1], 10);
            const spend = parseFloat(row.spend || '0');
            lyHourlyMap.set(hour, (lyHourlyMap.get(hour) || 0) + spend);
          }
        }
        lastYearSameDay.hourlySpend = Array.from({ length: 24 }, (_, i) => ({ hour: i, spend: lyHourlyMap.get(i) || 0 }));
      }
    }

    // ── Build campaign table (today + L7 trend) ──
    const l7ByCampaign = new Map<string, { spend: number; purchaseValue: number }>();
    for (const row of campaignL7Rows) {
      const id = row.campaign_id;
      if (!id) continue;
      const cur = l7ByCampaign.get(id) || { spend: 0, purchaseValue: 0 };
      cur.spend += parseFloat(row.spend || '0');
      cur.purchaseValue += purchaseValue(row.action_values);
      l7ByCampaign.set(id, cur);
    }

    const campaigns: CampaignToday[] = [];
    const campaignIds = campaignTodayRows.map((r: any) => r.campaign_id).filter(Boolean);

    // Batch fetch objective + effective_status (chunk 50 ids)
    const campaignMeta: Record<string, { objective: string; status: string }> = {};
    if (campaignIds.length > 0) {
      for (let i = 0; i < campaignIds.length; i += 50) {
        const chunk = campaignIds.slice(i, i + 50);
        try {
          const metaRes: Response = await fetch(
            `${META_BASE}/?ids=${chunk.join(',')}&fields=objective,effective_status&access_token=${metaToken}`
          );
          if (metaRes.ok) {
            const metaJson = (await metaRes.json()) as Record<string, any>;
            for (const [id, info] of Object.entries(metaJson)) {
              campaignMeta[id] = {
                objective: info?.objective || 'UNKNOWN',
                status: info?.effective_status || 'UNKNOWN',
              };
            }
          }
        } catch { /* non-fatal */ }
      }
    }

    for (const row of campaignTodayRows) {
      const id = row.campaign_id;
      if (!id) continue;
      const spend = parseFloat(row.spend || '0');
      if (spend <= 0) continue;

      const p = purchases(row.actions);
      const pv = purchaseValue(row.action_values);
      const impressions = parseInt(row.impressions || '0');
      const clicks = parseInt(row.clicks || '0');

      const l7 = l7ByCampaign.get(id) || { spend: 0, purchaseValue: 0 };
      const l7DailySpend = l7.spend / 7;
      const l7Roas = roas(l7.spend, l7.purchaseValue);
      const meta = campaignMeta[id] || { objective: 'UNKNOWN', status: 'UNKNOWN' };

      campaigns.push({
        campaignId: id,
        campaignName: row.campaign_name || id,
        objective: meta.objective,
        status: meta.status,
        spend,
        impressions,
        clicks,
        ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
        cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
        cpc: clicks > 0 ? spend / clicks : 0,
        purchases: p,
        purchaseValue: pv,
        roas: roas(spend, pv),
        cpa: p > 0 ? spend / p : 0,
        l7DailySpend,
        l7Roas,
        spendPaceVsL7: l7DailySpend > 0 ? spend / l7DailySpend : 0,
        roasDeltaVsL7: l7.spend > 0 ? roas(spend, pv) - l7Roas : 0,
      });
    }
    campaigns.sort((a, b) => b.spend - a.spend);

    const response: BfcmPacingResponse = {
      currency,
      timezone,
      grossMarginPct: brand.gross_margin_pct != null ? Number(brand.gross_margin_pct) : null,
      bfcmWindow: { start: tyStart, end: tyEnd },
      today: {
        date: todayStr,
        dayLabel: getDayLabel(today, bfcmWindow.thanksgiving),
        hourlySpend: todayHourly,
        totalSpendSoFar,
        purchases: todayPurchases,
        purchaseValue: todayPurchaseValue,
        roas: roas(totalSpendSoFar, todayPurchaseValue),
      },
      l7Baseline: {
        hourlyAvg: l7HourlyAvg.map(p => ({ hour: p.hour, spend: Math.round(p.spend * 100) / 100 })),
        dailyAvg: Math.round(l7DailyAvg * 100) / 100,
        dailyHourly: l7DayResults.map(d => ({
          date: d.date,
          hourlySpend: d.hourlySpend.map(p => ({ hour: p.hour, spend: Math.round(p.spend * 100) / 100 })),
          dayTotal: Math.round(d.dayTotal * 100) / 100,
        })),
        roas: roas(l7TotalSpend, l7TotalPurchaseValue),
        totalSpend: Math.round(l7TotalSpend * 100) / 100,
        totalPurchaseValue: Math.round(l7TotalPurchaseValue * 100) / 100,
      },
      lastYearBfcm: {
        sameDay: lastYearSameDay,
        fullWindow: lastYearFullWindow,
      },
      thisYearBfcm: {
        fullWindow: thisYearFullWindow,
      },
      campaigns,
    };

    cache.set(cacheKey, { data: response, ts: Date.now() });

    return NextResponse.json(response);
  } catch (e: any) {
    return NextResponse.json({ error: `Failed to fetch BFCM pacing data: ${e.message}` }, { status: 500 });
  }
}
