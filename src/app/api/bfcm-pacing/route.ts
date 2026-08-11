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
}

interface BfcmPacingResponse {
  currency: string;
  timezone: string;
  bfcmWindow: { start: string; end: string };
  today: {
    date: string;
    dayLabel: string;
    hourlySpend: HourlyPoint[];
    totalSpendSoFar: number;
  };
  l7Baseline: {
    hourlyAvg: HourlyPoint[];
    dailyAvg: number;
    dailyHourly: { date: string; hourlySpend: HourlyPoint[]; dayTotal: number }[];
  };
  lastYearBfcm: {
    sameDay: { dayLabel: string; date: string; totalSpend: number; hourlySpend: HourlyPoint[] };
    fullWindow: DailyPoint[];
  };
  thisYearBfcm: {
    fullWindow: DailyPoint[];
  };
}

// ─── BFCM Date Calculation ──────────────────────────────────────

function getBfcmWindow(year: number) {
  const nov1 = new Date(year, 10, 1);
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
  // Black Friday = Thanksgiving + 1
  const bf = new Date(thanksgiving);
  bf.setDate(bf.getDate() + 1);
  if (d.toDateString() === bf.toDateString()) return 'Black Friday';
  // Cyber Monday = Thanksgiving + 4
  const cm = new Date(thanksgiving);
  cm.setDate(cm.getDate() + 4);
  if (d.toDateString() === cm.toDateString()) return 'Cyber Monday';
  return days[d.getDay()];
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

  // Auth
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

  // Non-admins can only fetch their own brand
  if (profile.role !== 'admin' && profile.brand_id !== brandId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Cache key
  const cacheKey = `bfcm:${brandId}:${year}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return NextResponse.json(cached.data);
  }

  // Get brand config
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

  // Get Meta token
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

  try {
    // ── Fetch currency & timezone ──
    const currency = await fetchAccountCurrency(metaToken, adAccountId);
    const timezone = await fetchAccountTimezone(metaToken, adAccountId);

    // ── Calculate BFCM windows ──
    const bfcmWindow = getBfcmWindow(year);
    const lastYearBfcmWindow = getBfcmWindow(year - 1);

    const today = new Date();
    const todayStr = fmtDate(today);

    // ── Today's hourly spend ──
    let todayHourly: HourlyPoint[] = [];
    let totalSpendSoFar = 0;

    const todayUrl = `${META_BASE}/${adAccountId}/insights?level=account&time_range=${encodeURIComponent(JSON.stringify({ since: todayStr, until: todayStr }))}&breakdowns=hourly_stats_aggregated_by_advertiser_time_zone&fields=spend&limit=500&access_token=${metaToken}`;

    const todayRes = await fetch(todayUrl);
    const todayData = await todayRes.json();

    if (todayData?.data) {
      const hourlyMap = new Map<number, number>();
      for (const row of todayData.data) {
        const hourlyStr = row.hourly_stats_aggregated_by_advertiser_time_zone || '';
        const hourMatch = hourlyStr.match(/^(\d{1,2}):/);
        if (hourMatch) {
          const hour = parseInt(hourMatch[1], 10);
          const spend = parseFloat(row.spend || '0');
          hourlyMap.set(hour, (hourlyMap.get(hour) || 0) + spend);
          totalSpendSoFar += spend;
        }
      }
      todayHourly = Array.from({ length: 24 }, (_, i) => ({
        hour: i,
        spend: hourlyMap.get(i) || 0,
      }));
    }

    // ── L7 baseline: one API call per day (last 7 days) ──
    // Meta aggregates hourly breakdowns across multi-day ranges into
    // 24 buckets (one per hour) with totals across ALL days, not per-day.
    // Querying each day individually fixes the "by this hour" calculation.
    const l7Days: string[] = [];
    for (let i = 1; i <= 7; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      l7Days.push(fmtDate(d));
    }

    const l7Promises = l7Days.map(async (day): Promise<{ date: string; hourlySpend: HourlyPoint[]; dayTotal: number }> => {
      const url = `${META_BASE}/${adAccountId}/insights?level=account&time_range=${encodeURIComponent(JSON.stringify({ since: day, until: day }))}&breakdowns=hourly_stats_aggregated_by_advertiser_time_zone&fields=spend&limit=500&access_token=${metaToken}`;
      try {
        const res = await fetch(url);
        const json = await res.json();
        const hourlySpend: HourlyPoint[] = Array.from({ length: 24 }, (_, h) => ({ hour: h, spend: 0 }));
        let dayTotal = 0;
        if (json?.data) {
          for (const row of json.data) {
            const hourlyStr = row.hourly_stats_aggregated_by_advertiser_time_zone || '';
            const hourMatch = hourlyStr.match(/^(\\d{1,2}):/);
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

    const l7DayResults = await Promise.all(l7Promises);
    // Sort chronologically
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

    // ── Projection (computed client-side for correct timezone) ──
    // Server only provides raw data; the page computes pacing using
    // the user's local time which matches the advertiser's timezone.

    // ── Last year BFCM data ──
    const lyStart = fmtDate(lastYearBfcmWindow.start);
    const lyEnd = fmtDate(lastYearBfcmWindow.end);

    const lyDailyUrl = `${META_BASE}/${adAccountId}/insights?level=account&time_range=${encodeURIComponent(JSON.stringify({ since: lyStart, until: lyEnd }))}&time_increment=1&fields=spend&limit=500&access_token=${metaToken}`;

    const lyDailyRes = await fetch(lyDailyUrl);
    const lyDailyData = await lyDailyRes.json();

    let lastYearFullWindow: DailyPoint[] = [];
    let lastYearSameDay: { dayLabel: string; date: string; totalSpend: number; hourlySpend: HourlyPoint[] } = {
      dayLabel: '',
      date: '',
      totalSpend: 0,
      hourlySpend: [],
    };

    if (lyDailyData?.data) {
      const weekdayOffset = lastYearBfcmWindow.start.getDay(); // Monday offset for matching
      lastYearFullWindow = [];
      for (const row of lyDailyData.data) {
        const d = new Date(row.date_start + 'T00:00:00');
        lastYearFullWindow.push({
          date: row.date_start,
          dayLabel: getDayLabel(d, lastYearBfcmWindow.thanksgiving),
          spend: parseFloat(row.spend || '0'),
        });
      }
      lastYearFullWindow.sort((a, b) => a.date.localeCompare(b.date));

      // Find the same BFCM day (same position in window)
      const todayInWindow = (today.getDay() + 7 - bfcmWindow.start.getDay()) % 7;
      if (todayInWindow >= 0 && todayInWindow < lastYearFullWindow.length) {
        const lySameDay = lastYearFullWindow[todayInWindow];
        lastYearSameDay = {
          dayLabel: lySameDay.dayLabel,
          date: lySameDay.date,
          totalSpend: lySameDay.spend,
          hourlySpend: [],
        };

        // Fetch hourly for last year's same day
        const lyHourlyUrl = `${META_BASE}/${adAccountId}/insights?level=account&time_range=${encodeURIComponent(JSON.stringify({ since: lySameDay.date, until: lySameDay.date }))}&breakdowns=hourly_stats_aggregated_by_advertiser_time_zone&fields=spend&limit=500&access_token=${metaToken}`;

        const lyHourlyRes = await fetch(lyHourlyUrl);
        const lyHourlyData = await lyHourlyRes.json();

        if (lyHourlyData?.data) {
          const lyHourlyMap = new Map<number, number>();
          for (const row of lyHourlyData.data) {
            const hourlyStr = row.hourly_stats_aggregated_by_advertiser_time_zone || '';
            const hourMatch = hourlyStr.match(/^(\d{1,2}):/);
            if (hourMatch) {
              const hour = parseInt(hourMatch[1], 10);
              const spend = parseFloat(row.spend || '0');
              lyHourlyMap.set(hour, (lyHourlyMap.get(hour) || 0) + spend);
            }
          }
          lastYearSameDay.hourlySpend = Array.from({ length: 24 }, (_, i) => ({
            hour: i,
            spend: lyHourlyMap.get(i) || 0,
          }));
        }
      }
    }

    // ── This year BFCM window daily data ──
    const tyStart = fmtDate(bfcmWindow.start);
    const tyEnd = fmtDate(bfcmWindow.end);

    const tyDailyUrl = `${META_BASE}/${adAccountId}/insights?level=account&time_range=${encodeURIComponent(JSON.stringify({ since: tyStart, until: tyEnd }))}&time_increment=1&fields=spend&limit=500&access_token=${metaToken}`;

    const tyDailyRes = await fetch(tyDailyUrl);
    const tyDailyData = await tyDailyRes.json();

    let thisYearFullWindow: DailyPoint[] = [];
    if (tyDailyData?.data) {
      thisYearFullWindow = tyDailyData.data.map((row: any) => ({
        date: row.date_start,
        dayLabel: getDayLabel(new Date(row.date_start + 'T00:00:00'), bfcmWindow.thanksgiving),
        spend: parseFloat(row.spend || '0'),
      }));
      thisYearFullWindow.sort((a, b) => a.date.localeCompare(b.date));
    }

    const response: BfcmPacingResponse = {
      currency,
      timezone,
      bfcmWindow: { start: tyStart, end: tyEnd },
      today: {
        date: todayStr,
        dayLabel: getDayLabel(today, bfcmWindow.thanksgiving),
        hourlySpend: todayHourly,
        totalSpendSoFar,
      },
      l7Baseline: {
        hourlyAvg: l7HourlyAvg.map(p => ({ hour: p.hour, spend: Math.round(p.spend * 100) / 100 })),
        dailyAvg: Math.round(l7DailyAvg * 100) / 100,
        dailyHourly: l7DayResults.map(d => ({
          date: d.date,
          hourlySpend: d.hourlySpend.map(p => ({ hour: p.hour, spend: Math.round(p.spend * 100) / 100 })),
          dayTotal: Math.round(d.dayTotal * 100) / 100,
        })),
      },
      lastYearBfcm: {
        sameDay: lastYearSameDay,
        fullWindow: lastYearFullWindow,
      },
      thisYearBfcm: {
        fullWindow: thisYearFullWindow,
      },
    };

    // Store in cache
    cache.set(cacheKey, { data: response, ts: Date.now() });

    return NextResponse.json(response);
  } catch (e: any) {
    return NextResponse.json({ error: `Failed to fetch BFCM pacing data: ${e.message}` }, { status: 500 });
  }
}
