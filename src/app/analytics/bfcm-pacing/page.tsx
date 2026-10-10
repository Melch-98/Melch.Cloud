'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Loader,
  Zap,
  ChevronDown,
  AlertTriangle,
  RefreshCw,
  Info,
  Target,
  TrendingUp,
  Flame,
  Snowflake,
} from 'lucide-react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import Navbar from '@/components/Navbar';
import { createClient } from '@/lib/supabase';
import { lastYearFigure, lastYearTotal, zonedClock } from '@/lib/bfcm/calendar';
import { paceSnapshot, vsBaselinePct, type PaceTone } from '@/lib/bfcm/pacing';

// ─── Types ──────────────────────────────────────────────────────

interface Brand {
  id: string;
  name: string;
  slug: string;
}

interface HourlyPoint {
  hour: number;
  spend: number;
}

interface HourSales {
  hour: number;
  revenue: number;
  orders: number;
  ncOrders: number;
  rcOrders: number;
  ncRevenue: number;
  rcRevenue: number;
}

interface DaySales {
  revenue: number;
  orders: number;
  aov: number;
  ncOrders: number;
  rcOrders: number;
  ncRevenue: number;
  rcRevenue: number;
  hourly: HourSales[];
}

interface GoalRow {
  date: string;
  revenueGoal: number | null;
  spendBudget: number | null;
  amerTarget: number | null;
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
  l7DailySpend: number;
  l7Roas: number;
  spendPaceVsL7: number;
  roasDeltaVsL7: number;
}

interface BfcmPacingData {
  currency: string;
  timezone: string;
  grossMarginPct: number | null;
  baseCurrency: string;
  fxRates: Record<string, number>;
  currencies: { meta: string | null; google: string | null; shopify?: string };
  today: {
    date: string;
    dayLabel: string;
    hourlySpend: HourlyPoint[];
    totalSpendSoFar: number;
    googleSpend: number;
    acquisitionSpend: number;
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
  aMer: {
    available: boolean;
    l7NcRevenue: number;
    l7MetaSpend: number;
    l7GoogleSpend: number;
    l7OtherSpend: number;
    l7TotalSpend: number;
    l7: number | null;
  };
  lastYearBfcm: {
    sameDay: { dayLabel: string; date: string; totalSpend: number; hourlySpend: HourlyPoint[]; purchases: number; purchaseValue: number; roas: number };
    fullWindow: DailyPoint[];
  };
  thisYearBfcm: {
    fullWindow: DailyPoint[];
  };
  campaigns: CampaignToday[];
  reportingCurrency?: string;
  timezoneSource?: string;
  warnings?: string[];
  meta?: { available: boolean; configured: boolean; reason: string | null };
  comparison?: { date: string; rule: string; dayLabel: string; inWindow: boolean };
  google?: {
    configured: boolean;
    spend: number | null;
    conversionValue: number | null;
    roas: number | null;
    currency: string | null;
    valueLabel: 'conversion value' | 'unavailable';
    error: string | null;
  };
  shopify?: {
    currency: string;
    today: DaySales;
    l7HourlyAvg: HourSales[];
    l7DailyAvgRevenue: number;
    lastYear: {
      status: 'ok' | 'no_last_year_data';
      date: string;
      dayLabel: string;
      rule: string;
      earliestOrderDay: string | null;
      sales: DaySales | null;
    };
    mer: number | null;
    amer: number | null;
    revenueReporting: number;
    ncRevenueReporting: number;
    spendReporting: number | null;
    freshness: { asOf: string | null; feed: string; label: string };
  };
  bfcmWindow: { start: string; end: string; days?: { date: string; dayLabel: string }[] };
}

type Decision = 'scale' | 'hold' | 'watch' | 'pause' | 'low';

// ─── Formatters ─────────────────────────────────────────────────

const currencySymbols: Record<string, string> = {
  USD: '$', CAD: 'CA$', GBP: '£', EUR: '€', AUD: 'A$',
};

const BASE_CURRENCIES = ['AUTO', 'USD', 'CAD', 'GBP', 'EUR', 'AUD'];

function sym(currency: string): string {
  return currencySymbols[currency] || currency + ' ';
}

function fmtMoney(v: number, currency: string): string {
  const s = sym(currency);
  const abs = Math.abs(v);
  if (abs >= 1000000) return `${s}${(v / 1000000).toFixed(2)}M`;
  if (abs >= 1000) return `${s}${(v / 1000).toFixed(1)}K`;
  return `${s}${v.toFixed(0)}`;
}

function fmtPct(v: number): string {
  const sign = v >= 0 ? '+' : '';
  return `${sign}${v.toFixed(1)}%`;
}

function fmtRoas(v: number): string {
  return v === 0 ? '—' : `${v.toFixed(2)}×`;
}

function fmtRoasDelta(v: number): string {
  if (v === 0) return '—';
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(2)}×`;
}

function fmtX(v: number): string {
  if (v === 0) return '—';
  return `${v.toFixed(1)}×`;
}

function fmtNum(v: number): string {
  return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

// FX conversion: value_base = value_native * rates[base] / rates[native]
function toBase(v: number, native: string, fx: Record<string, number>, base: string): number {
  if (!native || !base || native === base) return v;
  const rNative = fx[native];
  const rBase = fx[base];
  if (!rNative || !rBase) return v;
  return v * rBase / rNative;
}

// ─── Decision classification ────────────────────────────────────

const MIN_JUDGE_SPEND = 50;

function classifyCampaign(
  c: CampaignToday,
  targetRoas: number,
  breakevenRoas: number | null
): { decision: Decision; label: string } {
  if (c.spend < MIN_JUDGE_SPEND) return { decision: 'low', label: 'Low spend' };
  if (c.status === 'PAUSED') return { decision: 'low', label: 'Paused' };
  if (c.roas >= targetRoas) return { decision: 'scale', label: 'Scale up' };
  if (breakevenRoas != null) {
    if (c.roas >= breakevenRoas) return { decision: 'hold', label: 'Hold' };
    if (c.purchases > 0) return { decision: 'watch', label: 'Under BE' };
    return { decision: 'pause', label: 'Pause' };
  }
  if (c.roas >= targetRoas * 0.6) return { decision: 'hold', label: 'Hold' };
  if (c.purchases > 0) return { decision: 'watch', label: 'Watch' };
  return { decision: 'pause', label: 'Pause' };
}

const DECISION_STYLE: Record<Decision, { color: string; bg: string; icon: any }> = {
  scale: { color: '#22C55E', bg: 'rgba(34,197,94,0.12)', icon: TrendingUp },
  hold: { color: '#C8B89A', bg: 'rgba(200,184,154,0.12)', icon: Snowflake },
  watch: { color: '#F59E0B', bg: 'rgba(245,158,11,0.12)', icon: AlertTriangle },
  pause: { color: '#EF4444', bg: 'rgba(239,68,68,0.12)', icon: Flame },
  low: { color: '#777', bg: 'rgba(255,255,255,0.04)', icon: Info },
};

// ─── KPI Card ───────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  sub,
  accent = 'default',
  bar,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: 'gold' | 'green' | 'red' | 'amber' | 'default';
  bar?: { pct: number; color: string };
}) {
  const accentColor =
    accent === 'gold' ? '#C8B89A'
    : accent === 'green' ? '#22C55E'
    : accent === 'red' ? '#EF4444'
    : accent === 'amber' ? '#F59E0B'
    : '#F5F5F8';
  return (
    <div className="rounded-xl p-5" style={{ backgroundColor: '#111111' }}>
      <div className="text-xs uppercase tracking-wider mb-2" style={{ color: '#ABABAB' }}>
        {label}
      </div>
      <div className="text-2xl font-semibold tabular-nums" style={{ color: accentColor }}>
        {value}
      </div>
      {sub && (
        <div className="text-xs mt-1.5" style={{ color: '#666' }}>
          {sub}
        </div>
      )}
      {bar && (
        <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}>
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${Math.min(100, Math.max(0, bar.pct))}%`, backgroundColor: bar.color }}
          />
        </div>
      )}
    </div>
  );
}

const TONE_COLOR: Record<PaceTone, string> = {
  green: '#22C55E',
  amber: '#F59E0B',
  red: '#EF4444',
  neutral: '#F5F5F8',
};

function HourlySalesChart({
  today,
  l7,
  lastYear,
  lastYearStatus,
  currency,
  currentHour,
  factor = 1,
}: {
  today: DaySales;
  l7: HourSales[];
  lastYear: DaySales | null;
  lastYearStatus: 'ok' | 'no_last_year_data';
  currency: string;
  currentHour: number;
  factor?: number;
}) {
  let todayCum = 0;
  let l7Cum = 0;
  let lyCum = 0;
  const showLy = lastYearStatus === 'ok' && lastYear;
  const data = Array.from({ length: 24 }, (_, hour) => {
    todayCum += today.hourly[hour]?.revenue || 0;
    l7Cum += l7[hour]?.revenue || 0;
    lyCum += lastYear?.hourly[hour]?.revenue || 0;
    return {
      hour: `${hour}:00`,
      today: Math.round(todayCum * factor * 100) / 100,
      l7: Math.round(l7Cum * factor * 100) / 100,
      lastYear: Math.round(lyCum * factor * 100) / 100,
    };
  });
  const s = sym(currency);
  return (
    <div className="rounded-xl p-6" style={{ backgroundColor: '#111111' }}>
      <div className="flex items-center justify-between mb-4 gap-3">
        <h3 className="text-sm font-semibold" style={{ color: '#F5F5F8' }}>
          Hourly cumulative Shopify gross sales
        </h3>
        <div className="flex items-center gap-4 text-xs" style={{ color: '#666' }}>
          <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 rounded" style={{ backgroundColor: '#C8B89A' }} />Today</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 rounded" style={{ backgroundColor: '#666' }} />L7 avg</span>
          {showLy ? (
            <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 rounded" style={{ backgroundColor: '#888' }} />Last year</span>
          ) : (
            <span>no data</span>
          )}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.04)" strokeDasharray="3 3" />
          <XAxis dataKey="hour" stroke="#555" tick={{ fontSize: 11, fill: '#555' }} tickLine={false} />
          <YAxis stroke="#555" tick={{ fontSize: 11, fill: '#555' }} tickLine={false}
            tickFormatter={(v: number) => `${s}${v >= 1000 ? (v / 1000).toFixed(0) + 'K' : v.toFixed(0)}`} />
          <Tooltip
            contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', color: '#F5F5F8' }}
            formatter={(value: any, name: any) => [`${s}${Number(value).toLocaleString()}`, String(name)]}
          />
          <Line type="monotone" dataKey="today" stroke="#C8B89A" strokeWidth={2.5} dot={false} name="Today" />
          <Line type="monotone" dataKey="l7" stroke="#666666" strokeWidth={1.5} dot={false} name="L7 avg" />
          {showLy && <Line type="monotone" dataKey="lastYear" stroke="#888888" strokeWidth={1.5} strokeDasharray="5 5" dot={false} name="Last year" />}
          <ReferenceLine x={`${currentHour}:00`} stroke="rgba(200,184,154,0.4)" strokeDasharray="4 4" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Hourly Spend Curve Chart ───────────────────────────────────

function HourlyCurveChart({
  today,
  l7Baseline,
  lastYearSameDay,
  currency,
  currentHour,
  factor = 1,
}: {
  today: BfcmPacingData['today'];
  l7Baseline: BfcmPacingData['l7Baseline'];
  lastYearSameDay: BfcmPacingData['lastYearBfcm']['sameDay'];
  currency: string;
  currentHour: number;
  factor?: number;
}) {
  let todayCum = 0;
  let l7Cum = 0;
  let lyCum = 0;

  const data = Array.from({ length: 24 }, (_, hour) => {
    todayCum += today.hourlySpend[hour]?.spend || 0;
    l7Cum += l7Baseline.hourlyAvg[hour]?.spend || 0;
    lyCum += lastYearSameDay?.hourlySpend?.[hour]?.spend || 0;
    return {
      hour: `${hour}:00`,
      today: Math.round(todayCum * factor * 100) / 100,
      l7: Math.round(l7Cum * factor * 100) / 100,
      lastYear: Math.round(lyCum * factor * 100) / 100,
      isProjected: hour > currentHour,
    };
  });

  const s = sym(currency);

  return (
    <div className="rounded-xl p-6" style={{ backgroundColor: '#111111' }}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold" style={{ color: '#F5F5F8' }}>
          Hourly Cumulative Meta Spend
        </h3>
        <div className="flex items-center gap-4 text-xs" style={{ color: '#666' }}>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 rounded" style={{ backgroundColor: '#C8B89A' }} />
            Today
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 rounded" style={{ backgroundColor: '#666' }} />
            L7 Avg
          </span>
          {lastYearSameDay?.totalSpend > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-0.5 rounded" style={{ backgroundColor: '#888' }} />
              Last Year
            </span>
          )}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.04)" strokeDasharray="3 3" />
          <XAxis dataKey="hour" stroke="#555" tick={{ fontSize: 11, fill: '#555' }} tickLine={false} />
          <YAxis
            stroke="#555"
            tick={{ fontSize: 11, fill: '#555' }}
            tickLine={false}
            tickFormatter={(v: number) => `${s}${v >= 1000 ? (v / 1000).toFixed(0) + 'K' : v.toFixed(0)}`}
          />
          <Tooltip
            contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', color: '#F5F5F8' }}
            formatter={(value: any, name: any) => [`${s}${Number(value).toLocaleString()}`, String(name)]}
          />
          <Line type="monotone" dataKey="today" stroke="#C8B89A" strokeWidth={2.5} dot={false} name="Today" />
          <Line type="monotone" dataKey="l7" stroke="#666666" strokeWidth={1.5} dot={false} name="L7 Avg" />
          {lastYearSameDay?.totalSpend > 0 && (
            <Line type="monotone" dataKey="lastYear" stroke="#888888" strokeWidth={1.5} strokeDasharray="5 5" dot={false} name="Last Year" />
          )}
          <ReferenceLine
            x={`${currentHour}:00`}
            stroke="rgba(200,184,154,0.4)"
            strokeDasharray="4 4"
            label={{ value: 'Now', position: 'top', fill: '#C8B89A', fontSize: 10 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── BFCM Window Chart (Spend / ROAS toggle) ────────────────────

function BfcmWindowChart({
  thisYear,
  lastYear,
  currentDate,
  currency,
  factor = 1,
  windowStart,
  windowEnd,
  earliestOrderDay = null,
}: {
  thisYear: DailyPoint[];
  lastYear: DailyPoint[];
  currentDate: string;
  currency: string;
  factor?: number;
  windowStart?: string;
  windowEnd?: string;
  earliestOrderDay?: string | null;
}) {
  const lyPoint = (amount: number, day: string | undefined, scale: number): number | null => {
    const figure = lastYearFigure(amount, day || '', earliestOrderDay);
    return figure === 'no data' ? null : figure * scale;
  };
  const lySpendTotal = lastYearTotal(
    lastYear.map((day) => ({ date: day.date, amount: day.spend })),
    earliestOrderDay
  );
  const [metric, setMetric] = useState<'spend' | 'roas'>('spend');
  const s = sym(currency);

  if (thisYear.length === 0) {
    const year = windowStart ? Number(windowStart.slice(0, 4)) : new Date().getFullYear();
    const mon = windowStart ? new Date(`${windowStart}T00:00:00Z`) : new Date();
    const cm = windowEnd ? new Date(`${windowEnd}T00:00:00Z`) : mon;
    const daysAway = windowStart
      ? Math.max(0, Math.ceil((Date.parse(`${windowStart}T00:00:00Z`) - Date.now()) / 86400000))
      : 0;
    const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

    return (
      <div className="rounded-xl p-6" style={{ backgroundColor: '#111111' }}>
        <h3 className="text-sm font-semibold mb-4" style={{ color: '#F5F5F8' }}>
          BFCM Window — Daily Meta Spend
        </h3>
        <div className="flex flex-col items-center justify-center py-10 text-center" style={{ minHeight: 200 }}>
          <div className="text-lg font-semibold mb-2" style={{ color: '#C8B89A' }}>
            BFCM {year}: {fmt(mon)} – {fmt(cm)}
          </div>
          <div className="text-sm" style={{ color: '#666' }}>
            {daysAway} {daysAway === 1 ? 'day' : 'days'} until the window opens
          </div>
        </div>
        {lastYear.length > 0 && (
          <>
            <div className="text-xs mb-3" style={{ color: '#555' }}>Last year&apos;s window for reference</div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart
                data={lastYear.map(ly => ({ shortLabel: shortDay(ly.dayLabel), value: lyPoint(ly.spend, ly.date, factor) }))}
                margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
              >
                <CartesianGrid stroke="rgba(255,255,255,0.04)" strokeDasharray="3 3" />
                <XAxis dataKey="shortLabel" stroke="#555" tick={{ fontSize: 11, fill: '#555' }} tickLine={false} />
                <YAxis stroke="#555" tick={{ fontSize: 11, fill: '#555' }} tickLine={false}
                  tickFormatter={(v: number) => `${s}${v >= 1000 ? (v / 1000).toFixed(0) + 'K' : v.toFixed(0)}`} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', color: '#F5F5F8' }}
                  formatter={(value: any, name: any) => [value == null ? 'no data' : `${s}${Number(value).toLocaleString()}`, String(name)]} />
                <Bar dataKey="value" fill="#444444" name="Last Year Spend" maxBarSize={32} />
              </BarChart>
            </ResponsiveContainer>
            <div className="flex flex-wrap gap-6 mt-3 text-xs" style={{ color: '#888' }}>
              <span>
                Last year total:{' '}
                <span style={{ color: '#F5F5F8', fontWeight: 600 }}>
                  {lySpendTotal === 'no data' ? 'no data' : fmtMoney(lySpendTotal * factor, currency)}
                </span>
              </span>
            </div>
          </>
        )}
      </div>
    );
  }

  const data = thisYear.map((ty, i) => ({
    shortLabel: shortDay(ty.dayLabel),
    thisYear: metric === 'spend' ? ty.spend * factor : ty.roas,
    lastYear: metric === 'spend'
      ? lyPoint(lastYear[i]?.spend || 0, lastYear[i]?.date, factor)
      : lyPoint(lastYear[i]?.roas || 0, lastYear[i]?.date, 1),
    isFuture: ty.date > currentDate,
  }));

  const tyTotalRaw = thisYear.reduce((sum, d) => sum + d.spend, 0);
  const lyTotalRaw = lySpendTotal === 'no data' ? 0 : lySpendTotal;
  const tyTotal = tyTotalRaw * factor;
  const lyTotal = lyTotalRaw * factor;
  const yoyPct = lyTotalRaw > 0 ? ((tyTotalRaw - lyTotalRaw) / lyTotalRaw) * 100 : 0;
  const tyRoas = tyTotalRaw > 0 ? thisYear.reduce((sum, d) => sum + d.purchaseValue, 0) / tyTotalRaw : 0;

  return (
    <div className="rounded-xl p-6" style={{ backgroundColor: '#111111' }}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold" style={{ color: '#F5F5F8' }}>
          BFCM Window — Daily Meta Spend
        </h3>
        <div className="flex rounded-lg overflow-hidden text-xs" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
          {(['spend', 'roas'] as const).map(m => (
            <button
              key={m}
              onClick={() => setMetric(m)}
              className="px-3 py-1.5 transition-colors"
              style={{
                backgroundColor: metric === m ? 'rgba(200,184,154,0.12)' : 'transparent',
                color: metric === m ? '#C8B89A' : '#777',
              }}
            >
              {m === 'spend' ? 'Spend' : 'ROAS'}
            </button>
          ))}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.04)" strokeDasharray="3 3" />
          <XAxis dataKey="shortLabel" stroke="#555" tick={{ fontSize: 11, fill: '#555' }} tickLine={false} />
          <YAxis stroke="#555" tick={{ fontSize: 11, fill: '#555' }} tickLine={false}
            tickFormatter={(v: number) => metric === 'spend' ? `${s}${v >= 1000 ? (v / 1000).toFixed(0) + 'K' : v.toFixed(0)}` : `${v.toFixed(1)}×`} />
          <Tooltip
            contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', color: '#F5F5F8' }}
            formatter={(value: any, name: any) => [
              value == null ? 'no data' : metric === 'spend' ? `${s}${Number(value).toLocaleString()}` : `${Number(value).toFixed(2)}×`,
              String(name),
            ]}
          />
          <Bar dataKey="thisYear" fill="#C8B89A" name="This Year" maxBarSize={32} />
          <Bar dataKey="lastYear" fill="#444444" name="Last Year" maxBarSize={32} />
        </BarChart>
      </ResponsiveContainer>

      <div className="flex flex-wrap gap-6 mt-4 pt-4 text-xs" style={{ borderTop: '1px solid rgba(255,255,255,0.06)', color: '#888' }}>
        <span>
          Window Meta spend: <span style={{ color: '#F5F5F8', fontWeight: 600 }}>{fmtMoney(tyTotal, currency)}</span>
        </span>
        <span>
          Last year: <span style={{ color: '#F5F5F8', fontWeight: 600 }}>{lySpendTotal === 'no data' ? 'no data' : fmtMoney(lyTotal, currency)}</span>
        </span>
        {lyTotal > 0 && (
          <span>
            YoY:{' '}
            <span style={{ color: yoyPct >= 0 ? '#22C55E' : '#EF4444', fontWeight: 600 }}>
              {fmtPct(yoyPct)}
            </span>
          </span>
        )}
        <span>
          Window ROAS: <span style={{ color: '#F5F5F8', fontWeight: 600 }}>{fmtRoas(tyRoas)}</span>
        </span>
      </div>
    </div>
  );
}

function shortDay(dayLabel: string): string {
  if (dayLabel === 'Thanksgiving') return 'Thu 🦃';
  if (dayLabel === 'Black Friday') return 'Fri BF';
  if (dayLabel === 'Cyber Monday') return 'Mon CM';
  return dayLabel.slice(0, 3);
}

// ─── Campaign Command Table ─────────────────────────────────────

type SortKey = 'spend' | 'roas' | 'purchaseValue' | 'purchases' | 'cpa' | 'spendPaceVsL7' | 'roasDeltaVsL7';

function CampaignTable({
  campaigns,
  currency,
  targetRoas,
  breakevenRoas,
  factor = 1,
}: {
  campaigns: CampaignToday[];
  currency: string;
  targetRoas: number;
  breakevenRoas: number | null;
  factor?: number;
}) {
  const [sortKey, setSortKey] = useState<SortKey>('spend');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const sorted = useMemo(() => {
    const arr = [...campaigns];
    arr.sort((a, b) => {
      const va = a[sortKey];
      const vb = b[sortKey];
      const diff = (typeof va === 'number' ? va : 0) - (typeof vb === 'number' ? vb : 0);
      return sortDir === 'desc' ? -diff : diff;
    });
    return arr;
  }, [campaigns, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir(d => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const totalSpend = campaigns.reduce((s, c) => s + c.spend, 0);

  if (campaigns.length === 0) {
    return (
      <div className="rounded-xl p-6" style={{ backgroundColor: '#111111' }}>
        <h3 className="text-sm font-semibold mb-3" style={{ color: '#F5F5F8' }}>Campaign Command (Meta)</h3>
        <div className="text-sm py-8 text-center" style={{ color: '#666' }}>
          No campaign spend today yet.
        </div>
      </div>
    );
  }

  const SortHeader = ({ label, k, align = 'right' }: { label: string; k: SortKey; align?: 'left' | 'right' }) => (
    <th
      onClick={() => toggleSort(k)}
      className={`py-2 pr-4 font-medium cursor-pointer select-none hover:text-[#C8B89A] transition-colors ${align === 'right' ? 'text-right' : 'text-left'}`}
      style={{ color: sortKey === k ? '#C8B89A' : '#555' }}
    >
      {label}{sortKey === k ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
    </th>
  );

  return (
    <div className="rounded-xl p-6" style={{ backgroundColor: '#111111' }}>
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-semibold" style={{ color: '#F5F5F8' }}>Campaign Command (Meta)</h3>
        <div className="text-xs" style={{ color: '#555' }}>
          {campaigns.length} campaigns · target {fmtRoas(targetRoas)}
          {breakevenRoas != null ? ` · breakeven ${fmtRoas(breakevenRoas)}` : ''}
        </div>
      </div>
      <p className="text-xs mb-4" style={{ color: '#666' }}>
        Decision = today&apos;s Meta ROAS vs target. Campaigns under ${MIN_JUDGE_SPEND} or paused are flagged low-priority.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              <th className="text-left py-2 pr-4 font-medium" style={{ color: '#555' }}>Campaign</th>
              <th className="text-left py-2 pr-4 font-medium" style={{ color: '#555' }}>Status</th>
              <SortHeader label="Spend" k="spend" />
              <SortHeader label="Rev" k="purchaseValue" />
              <SortHeader label="ROAS" k="roas" />
              <SortHeader label="CPA" k="cpa" />
              <SortHeader label="Orders" k="purchases" />
              <SortHeader label="vs L7 ROAS" k="roasDeltaVsL7" />
              <SortHeader label="Pace" k="spendPaceVsL7" />
              <th className="text-right py-2 font-medium" style={{ color: '#555' }}>Decision</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(c => {
              const { decision, label } = classifyCampaign(c, targetRoas, breakevenRoas);
              const st = DECISION_STYLE[decision];
              const share = totalSpend > 0 ? (c.spend / totalSpend) * 100 : 0;
              const Icon = st.icon;
              return (
                <tr key={c.campaignId} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                  <td className="py-2.5 pr-4 max-w-[260px]">
                    <div className="truncate font-medium" style={{ color: '#F5F5F8' }}>{c.campaignName}</div>
                    <div className="mt-1 h-1 rounded-full overflow-hidden" style={{ backgroundColor: 'rgba(255,255,255,0.05)', width: 120 }}>
                      <div className="h-full" style={{ width: `${Math.min(100, share)}%`, backgroundColor: '#C8B89A' }} />
                    </div>
                  </td>
                  <td className="py-2.5 pr-4">
                    <span
                      className="inline-block px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide"
                      style={{ color: c.status === 'ACTIVE' ? '#22C55E' : '#888', backgroundColor: 'rgba(255,255,255,0.05)' }}
                    >
                      {c.status === 'ACTIVE' ? 'Live' : c.status}
                    </span>
                  </td>
                  <td className="py-2.5 pr-4 text-right tabular-nums" style={{ color: '#F5F5F8' }}>{fmtMoney(c.spend * factor, currency)}</td>
                  <td className="py-2.5 pr-4 text-right tabular-nums" style={{ color: '#ABABAB' }}>{fmtMoney(c.purchaseValue * factor, currency)}</td>
                  <td className="py-2.5 pr-4 text-right tabular-nums" style={{ color: c.roas >= targetRoas ? '#22C55E' : '#F5F5F8' }}>{fmtRoas(c.roas)}</td>
                  <td className="py-2.5 pr-4 text-right tabular-nums" style={{ color: '#ABABAB' }}>{c.cpa > 0 ? fmtMoney(c.cpa * factor, currency) : '—'}</td>
                  <td className="py-2.5 pr-4 text-right tabular-nums" style={{ color: '#ABABAB' }}>{c.purchases > 0 ? fmtNum(c.purchases) : '—'}</td>
                  <td className="py-2.5 pr-4 text-right tabular-nums">
                    {c.l7DailySpend > 0 ? (
                      <span style={{ color: c.roasDeltaVsL7 >= 0 ? '#22C55E' : '#EF4444' }}>
                        {fmtRoasDelta(c.roasDeltaVsL7)}
                      </span>
                    ) : (
                      <span style={{ color: '#555' }}>—</span>
                    )}
                  </td>
                  <td className="py-2.5 pr-4 text-right tabular-nums" style={{ color: '#ABABAB' }}>{fmtX(c.spendPaceVsL7)}</td>
                  <td className="py-2.5 text-right">
                    <span
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium"
                      style={{ color: st.color, backgroundColor: st.bg }}
                    >
                      <Icon size={12} />
                      {label}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GoalField({
  label,
  value,
  onCommit,
  disabled,
  step = 1,
  compact = false,
}: {
  label: string;
  value: number | null;
  onCommit: (value: number | null) => void;
  disabled?: boolean;
  step?: number;
  compact?: boolean;
}) {
  const [draft, setDraft] = useState(value == null ? '' : String(value));
  useEffect(() => {
    setDraft(value == null ? '' : String(value));
  }, [value]);
  return (
    <div>
      {label ? (
        <div className="text-xs uppercase tracking-wider mb-1.5" style={{ color: '#777' }}>{label}</div>
      ) : null}
      <input
        type="number"
        min={0}
        step={step}
        disabled={disabled}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (draft.trim() === '') {
            onCommit(null);
            return;
          }
          const parsed = Number(draft);
          if (Number.isFinite(parsed) && parsed >= 0) onCommit(parsed);
        }}
        className={compact ? 'w-24 rounded px-2 py-1 text-xs tabular-nums' : 'w-28 rounded-lg px-3 py-2 text-sm tabular-nums'}
        style={{ backgroundColor: '#0A0A0A', border: '1px solid rgba(255,255,255,0.08)', color: disabled ? '#777' : '#F5F5F8' }}
      />
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────

export default function BfcmPacingPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [userRole, setUserRole] = useState<string | null>(null);
  const [userBrandId, setUserBrandId] = useState<string | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [brands, setBrands] = useState<Brand[]>([]);
  const [selectedBrandId, setSelectedBrandId] = useState<string>('');
  const [showBrandDropdown, setShowBrandDropdown] = useState(false);

  const [data, setData] = useState<BfcmPacingData | null>(null);
  const [fetchingData, setFetchingData] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [goalMap, setGoalMap] = useState<Record<string, GoalRow>>({});
  const [goalAccess, setGoalAccess] = useState<'read' | 'write'>('read');
  const [goalsError, setGoalsError] = useState<string | null>(null);
  const [extraGoalDate, setExtraGoalDate] = useState('');
  const requestRef = useRef(0);
  const loadedBrandRef = useRef('');
  // AUTO → API resolves Shopify settlement currency (CAD for Tallow Twins, etc.)
  const [baseCurrency, setBaseCurrency] = useState<string>('AUTO');

  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push('/'); return; }

      const { data: profile } = await supabase
        .from('users_profile')
        .select('role, brand_id')
        .eq('id', session.user.id)
        .single();

      if (!profile || !['admin', 'strategist', 'founder'].includes(profile.role)) {
        router.push('/');
        return;
      }

      setUserRole(profile.role);
      if (profile.brand_id) setUserBrandId(profile.brand_id);
      setAuthToken(session.access_token);
      const savedBase = localStorage.getItem('bfcm_base_currency');
      if (savedBase) setBaseCurrency(savedBase);
      setLoading(false);
    };
    init();
  }, [router, supabase]);

  useEffect(() => {
    if (!userRole || !['admin', 'strategist', 'founder'].includes(userRole)) return;
    const fetchBrands = async () => {
      try {
        let query = supabase.from('brands').select('id, name, slug').is('archived_at', null).order('name');
        if (userRole !== 'admin' && userBrandId) query = query.eq('id', userBrandId);

        const { data: allBrands } = await query;
        setBrands(allBrands || []);
        if (allBrands && allBrands.length > 0 && !selectedBrandId) {
          const saved = localStorage.getItem('melch_selected_brand');
          const match = saved && allBrands.find((b: any) => b.id === saved);
          setSelectedBrandId(match ? saved : allBrands[0].id);
        }
      } catch (err) {
        console.error('Error fetching brands:', err);
      }
    };
    fetchBrands();
  }, [userRole, supabase]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadPacing = async (refresh: boolean) => {
    if (!authToken || !selectedBrandId) return;
    const requestId = ++requestRef.current;
    setFetchingData(true);
    try {
      const params = new URLSearchParams({ brandId: selectedBrandId, baseCurrency });
      if (refresh) params.set('refresh', '1');
      const res = await fetch(`/api/bfcm-pacing?${params}`, {
        headers: { Authorization: `Bearer ${authToken}` },
        cache: 'no-store',
      });
      const json = await res.json().catch(() => ({}));
      if (requestId !== requestRef.current) return;
      if (!res.ok) {
        setFetchError(json.error || `Failed to load BFCM pacing (${res.status})`);
        if (!refresh) setData(null);
        return;
      }
      setData(json);
      setFetchError(null);
      if (baseCurrency === 'AUTO' && json.baseCurrency) setBaseCurrency(json.baseCurrency);
    } catch (err: any) {
      if (requestId !== requestRef.current) return;
      setFetchError(err.message || 'Failed to load BFCM pacing data');
      if (!refresh) setData(null);
    } finally {
      if (requestId === requestRef.current) setFetchingData(false);
    }
  };

  useEffect(() => {
    if (!authToken || !selectedBrandId) return;
    if (loadedBrandRef.current !== selectedBrandId) {
      loadedBrandRef.current = selectedBrandId;
      setData(null);
      setFetchError(null);
      setGoalMap({});
    }
    loadPacing(false);
  }, [authToken, selectedBrandId, baseCurrency]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!authToken || !selectedBrandId || !data?.bfcmWindow) return;
    const from = data.bfcmWindow.start;
    const to = data.bfcmWindow.end;
    let cancelled = false;
    fetch(`/api/bfcm-goals?brandId=${selectedBrandId}&from=${from}&to=${to}`, {
      headers: { Authorization: `Bearer ${authToken}` },
      cache: 'no-store',
    })
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || 'Goals unavailable');
        if (cancelled) return;
        const next: Record<string, GoalRow> = {};
        for (const goal of json.goals || []) next[goal.date] = goal;
        setGoalMap(next);
        setGoalAccess(json.access === 'write' ? 'write' : 'read');
        setGoalsError(null);
      })
      .catch((err) => {
        if (!cancelled) setGoalsError(err.message || 'Goals unavailable');
      });
    return () => { cancelled = true; };
  }, [authToken, selectedBrandId, data?.bfcmWindow.start, data?.bfcmWindow.end]);

  const breakevenRoas = useMemo(() => {
    if (!data || data.grossMarginPct == null || data.grossMarginPct <= 0) return null;
    return 100 / data.grossMarginPct;
  }, [data]);

  const effTargetRoas = breakevenRoas != null
    ? Math.round(breakevenRoas * 1.5 * 10) / 10
    : 2.0;

  const clock = data?.timezone ? zonedClock(new Date(), data.timezone) : null;
  const currentHour = clock?.hour ?? new Date().getHours();
  const currentMinute = clock?.minute ?? new Date().getMinutes();
  const todayGoal = data ? goalMap[data.today.date] : undefined;
  const reportingCurrency = data?.reportingCurrency || data?.baseCurrency || 'USD';
  const pace = data?.shopify
    ? paceSnapshot({
        revenueSoFar: data.shopify.revenueReporting,
        revenueGoal: todayGoal?.revenueGoal ?? null,
        spendSoFar: data.shopify.spendReporting ?? 0,
        spendBudget: todayGoal?.spendBudget ?? null,
        amer: data.shopify.amer,
        amerTarget: todayGoal?.amerTarget ?? null,
        hour: currentHour,
        minute: currentMinute,
      })
    : null;

  const fx = data?.fxRates || {};
  const base = data?.baseCurrency || baseCurrency;
  const native = data?.currency || 'USD';
  const convert = (v: number, fromCurrency?: string) => toBase(v, fromCurrency || native, fx, base);

  const metaSpendBase = data ? convert(data.today.totalSpendSoFar, data.currencies.meta || native) : 0;
  const googleSpendBase = data ? convert(data.today.googleSpend, data.currencies.google || data.currencies.meta || native) : 0;
  const acquisitionSpendBase = metaSpendBase + googleSpendBase;
  const budgetPct = pace?.spendVsBudget != null ? pace.spendVsBudget * 100 : 0;

  const lySameDay = data?.lastYearBfcm?.sameDay;
  const vsLastYearSpendPct = data && lySameDay && lySameDay.totalSpend > 0
    ? ((data.today.totalSpendSoFar - lySameDay.totalSpend) / lySameDay.totalSpend) * 100
    : 0;

  const alerts = useMemo(() => {
    if (!data) return [];
    const list: { tone: 'red' | 'amber' | 'green'; text: string }[] = [];

    if (pace && todayGoal?.spendBudget && pace.spendVsBudget != null) {
      const pct = pace.spendVsBudget * 100;
      if (pace.spendTone === 'red' && pct > 100) {
        list.push({ tone: 'amber', text: `Spend is ${pct.toFixed(0)}% of today's budget. Trim losers before the day runs away.` });
      } else if (pace.spendTone === 'red') {
        list.push({ tone: 'amber', text: `Spend is behind today's budget (${pct.toFixed(0)}%).` });
      }
    }
    if (pace && todayGoal?.revenueGoal && pace.revenueTone === 'red' && pace.revenueVsGoal != null) {
      list.push({ tone: 'amber', text: `Shopify revenue is ${(pace.revenueVsGoal * 100).toFixed(0)}% of today's goal.` });
    }

    if (breakevenRoas != null && data.today.roas > 0 && data.today.roas < breakevenRoas) {
      list.push({ tone: 'red', text: `Today Meta ROAS ${data.today.roas.toFixed(2)}× is below breakeven ${breakevenRoas.toFixed(2)}×.` });
    }

    if (data.aMer.available && data.aMer.l7 != null && breakevenRoas != null && data.aMer.l7 < breakevenRoas) {
      list.push({ tone: 'red', text: `L7 aMER ${data.aMer.l7.toFixed(2)}× (all channels) is below breakeven ${breakevenRoas.toFixed(2)}×.` });
    }

    const pauseCount = data.campaigns.filter(c => classifyCampaign(c, effTargetRoas, breakevenRoas).decision === 'pause').length;
    const scaleCount = data.campaigns.filter(c => classifyCampaign(c, effTargetRoas, breakevenRoas).decision === 'scale').length;

    if (pauseCount > 0) {
      list.push({ tone: 'red', text: `${pauseCount} campaign${pauseCount > 1 ? 's' : ''} burning (Meta spend with zero conversions) — pause now.` });
    }
    if (scaleCount > 0) {
      list.push({ tone: 'green', text: `${scaleCount} campaign${scaleCount > 1 ? 's' : ''} beating target — scale up.` });
    }

    return list.slice(0, 6);
  }, [data, effTargetRoas, breakevenRoas, pace, todayGoal, base]);

  const saveGoal = async (date: string, patch: Partial<GoalRow>) => {
    if (!authToken || !selectedBrandId || goalAccess !== 'write') return;
    const current = goalMap[date] || { date, revenueGoal: null, spendBudget: null, amerTarget: null };
    const next = { ...current, ...patch, date };
    setGoalMap((prev) => ({ ...prev, [date]: next }));
    const res = await fetch('/api/bfcm-goals', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        brandId: selectedBrandId,
        date,
        revenueGoal: next.revenueGoal,
        spendBudget: next.spendBudget,
        amerTarget: next.amerTarget,
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setGoalMap((prev) => ({ ...prev, [date]: current }));
      setGoalsError(json.error || 'Could not save goal');
    } else {
      setGoalsError(null);
    }
  };

  const saveBaseCurrency = (c: string) => {
    setBaseCurrency(c);
    localStorage.setItem('bfcm_base_currency', c);
  };

  if (loading) {
    return (
      <Navbar>
        <div className="flex items-center justify-center h-96" style={{ backgroundColor: '#0A0A0A' }}>
          <Loader className="animate-spin" size={24} style={{ color: '#C8B89A' }} />
        </div>
      </Navbar>
    );
  }

  return (
    <Navbar>
      <div className="min-h-screen" style={{ backgroundColor: '#0A0A0A', padding: '24px 32px' }}>
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center gap-3">
              <Zap size={24} style={{ color: '#C8B89A' }} />
              <h1 className="text-2xl font-bold" style={{ color: '#F5F5F8' }}>BFCM Command Center</h1>
            </div>
            <p className="text-sm mt-1" style={{ color: '#666' }}>
              Live Shopify sales, spend, MER and aMER — shop timezone
              {data?.timezone ? ` · ${data.timezone}` : ''}
            </p>
            {data?.shopify?.freshness && (
              <p className="text-xs mt-1" style={{ color: '#888' }}>
                Data as of {data.shopify.freshness.asOf
                  ? new Date(data.shopify.freshness.asOf).toLocaleString('en-US', { timeZone: data.timezone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
                  : 'no orders stored'}
                {' · '}{data.shopify.freshness.label}
              </p>
            )}
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {/* Brand selector */}
            <div className="relative">
              <button
                onClick={() => setShowBrandDropdown(!showBrandDropdown)}
                className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm transition-all"
                style={{ backgroundColor: '#111111', border: '1px solid rgba(255,255,255,0.08)', color: '#F5F5F8' }}
              >
                {brands.find(b => b.id === selectedBrandId)?.name || 'Select brand'}
                <ChevronDown size={14} style={{ color: '#666' }} />
              </button>
              {showBrandDropdown && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowBrandDropdown(false)} />
                  <div className="absolute right-0 mt-1 w-56 rounded-lg z-20 overflow-hidden"
                    style={{ backgroundColor: '#1a1a1a', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 16px 48px rgba(0,0,0,0.5)' }}>
                    {brands.map(b => (
                      <button
                        key={b.id}
                        onClick={() => {
                          setSelectedBrandId(b.id);
                          setShowBrandDropdown(false);
                          localStorage.setItem('melch_selected_brand', b.id);
                        }}
                        className="w-full text-left px-4 py-2.5 text-sm transition-colors"
                        style={{
                          color: b.id === selectedBrandId ? '#C8B89A' : '#ABABAB',
                          backgroundColor: b.id === selectedBrandId ? 'rgba(200,184,154,0.08)' : 'transparent',
                        }}
                      >
                        {b.name}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Currency selector */}
            <select
              value={baseCurrency}
              onChange={e => saveBaseCurrency(e.target.value)}
              className="rounded-lg px-3 py-2 text-sm"
              style={{ backgroundColor: '#111111', border: '1px solid rgba(255,255,255,0.08)', color: '#F5F5F8' }}
              title="Display currency — all figures converted to this base"
            >
              {BASE_CURRENCIES.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>

            {/* Refresh */}
            <button
              onClick={() => loadPacing(true)}
              className="rounded-lg p-2 transition-colors"
              style={{ backgroundColor: '#111111', border: '1px solid rgba(255,255,255,0.08)', color: '#888' }}
            >
              <RefreshCw size={16} className={fetchingData ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {/* Error banner */}
        {fetchError && (
          <div className="flex items-center gap-3 rounded-xl px-5 py-4 mb-6"
            style={{ backgroundColor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.15)' }}>
            <AlertTriangle size={18} style={{ color: '#EF4444' }} />
            <span className="text-sm" style={{ color: '#fca5a5' }}>
              {fetchError}{data ? ' Showing the last good refresh.' : ''}
            </span>
          </div>
        )}
        {data?.warnings && data.warnings.length > 0 && (
          <div className="flex items-start gap-3 rounded-xl px-5 py-4 mb-6"
            style={{ backgroundColor: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.18)' }}>
            <AlertTriangle size={18} style={{ color: '#F59E0B' }} />
            <span className="text-sm" style={{ color: '#fcd34d' }}>{data.warnings.join(' ')}</span>
          </div>
        )}

        {fetchingData && !data && (
          <div className="flex items-center justify-center h-64">
            <Loader className="animate-spin" size={24} style={{ color: '#C8B89A' }} />
          </div>
        )}

        {data && (
          <>
            {/* Currency notice */}
            <div className="flex items-center gap-2 text-xs mb-5" style={{ color: '#666' }}>
              <Info size={13} />
              Figures in <span style={{ color: '#C8B89A' }}>{base}</span>
              {native !== base && <> · converted from native {native}</>}
              {data.currencies.google && data.currencies.google !== native && <> · Google {data.currencies.google}</>}
            </div>

            {goalsError && (
              <div className="text-xs mb-4" style={{ color: '#F59E0B' }}>{goalsError}</div>
            )}
            <div className="flex flex-wrap items-end gap-4 mb-3">
              <GoalField
                label={`Revenue goal (${reportingCurrency})`}
                value={todayGoal?.revenueGoal ?? null}
                disabled={goalAccess !== 'write' || !data}
                onCommit={(value) => data && saveGoal(data.today.date, { revenueGoal: value })}
              />
              <GoalField
                label={`Spend budget (${reportingCurrency})`}
                value={todayGoal?.spendBudget ?? null}
                disabled={goalAccess !== 'write' || !data}
                onCommit={(value) => data && saveGoal(data.today.date, { spendBudget: value })}
              />
              <GoalField
                label="aMER target"
                value={todayGoal?.amerTarget ?? null}
                step={0.1}
                disabled={goalAccess !== 'write' || !data}
                onCommit={(value) => data && saveGoal(data.today.date, { amerTarget: value })}
              />
              <div className="flex items-center gap-2 text-xs pb-2" style={{ color: '#666' }}>
                <Target size={13} />
                {breakevenRoas != null
                  ? `Breakeven ${breakevenRoas.toFixed(2)}× (${data.grossMarginPct}% GM). Goals are shared and saved in ${reportingCurrency}.`
                  : `Goals are shared and saved in ${reportingCurrency}.`}
                {goalAccess !== 'write' ? ' View only.' : ''}
              </div>
            </div>
            {pace && (
              <div className="flex flex-wrap gap-4 text-xs mb-6" style={{ color: '#888' }}>
                <span style={{ color: TONE_COLOR[pace.revenueTone] }}>
                  Revenue {pace.revenueVsGoal == null ? '—' : `${(pace.revenueVsGoal * 100).toFixed(0)}% of goal`}
                  {pace.requiredHourlyRevenue != null ? ` · needs ${fmtMoney(pace.requiredHourlyRevenue, reportingCurrency)}/hr` : ''}
                </span>
                <span style={{ color: TONE_COLOR[pace.spendTone] }}>
                  Spend {pace.spendVsBudget == null ? '—' : `${(pace.spendVsBudget * 100).toFixed(0)}% of budget`}
                  {pace.requiredHourlySpend != null ? ` · ${fmtMoney(pace.requiredHourlySpend, reportingCurrency)}/hr left in budget` : ''}
                </span>
                <span style={{ color: TONE_COLOR[pace.amerTone] }}>
                  aMER {data.shopify?.amer != null ? fmtRoas(data.shopify.amer) : '—'}
                  {todayGoal?.amerTarget != null ? ` vs ${fmtRoas(todayGoal.amerTarget)}` : ''}
                </span>
              </div>
            )}

            {/* Alerts */}
            {alerts.length > 0 && (
              <div className="flex flex-col gap-2 mb-6">
                {alerts.map((a, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 rounded-xl px-4 py-3 text-sm"
                    style={{
                      backgroundColor: a.tone === 'red' ? 'rgba(239,68,68,0.08)' : a.tone === 'amber' ? 'rgba(245,158,11,0.08)' : 'rgba(34,197,94,0.08)',
                      border: `1px solid ${a.tone === 'red' ? 'rgba(239,68,68,0.2)' : a.tone === 'amber' ? 'rgba(245,158,11,0.2)' : 'rgba(34,197,94,0.2)'}`,
                    }}
                  >
                    {a.tone === 'red' ? <Flame size={16} style={{ color: '#EF4444' }} />
                      : a.tone === 'amber' ? <AlertTriangle size={16} style={{ color: '#F59E0B' }} />
                      : <TrendingUp size={16} style={{ color: '#22C55E' }} />}
                    <span style={{ color: a.tone === 'red' ? '#fca5a5' : a.tone === 'amber' ? '#fcd34d' : '#86efac' }}>
                      {a.text}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* KPI Cards */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
              <KpiCard
                label={`Shopify gross (${base})`}
                value={data.shopify ? fmtMoney(convert(data.shopify.today.revenue, data.shopify.currency), base) : '—'}
                accent="gold"
                sub={data.shopify
                  ? `${fmtNum(data.shopify.today.orders)} orders · AOV ${fmtMoney(convert(data.shopify.today.aov, data.shopify.currency), base)}`
                  : 'no Shopify orders'}
              />
              <KpiCard
                label="New vs returning"
                value={data.shopify ? `${fmtNum(data.shopify.today.ncOrders)} / ${fmtNum(data.shopify.today.rcOrders)}` : '—'}
                sub={data.shopify
                  ? `NC ${fmtMoney(convert(data.shopify.today.ncRevenue, data.shopify.currency), base)} · RC ${fmtMoney(convert(data.shopify.today.rcRevenue, data.shopify.currency), base)}`
                  : undefined}
              />
              <KpiCard
                label="MER today"
                value={data.shopify?.mer != null ? fmtRoas(data.shopify.mer) : '—'}
                sub="Shopify gross ÷ Meta + Google"
              />
              <KpiCard
                label="aMER today"
                value={data.shopify?.amer != null ? fmtRoas(data.shopify.amer) : '—'}
                accent={pace ? (pace.amerTone === 'neutral' ? 'default' : pace.amerTone) : 'default'}
                sub={todayGoal?.amerTarget != null ? `target ${fmtRoas(todayGoal.amerTarget)}` : 'NC gross ÷ Meta + Google'}
              />
              <KpiCard
                label={`Acquisition spend (${base})`}
                value={fmtMoney(acquisitionSpendBase, base)}
                sub={`Meta ${data.meta?.available === false ? 'n/a' : fmtMoney(metaSpendBase, base)} · Google ${data.google?.error ? 'unavailable' : data.google?.configured === false ? 'no account' : fmtMoney(googleSpendBase, base)}`}
                bar={todayGoal?.spendBudget ? { pct: budgetPct, color: pace?.spendTone === 'red' ? '#EF4444' : '#C8B89A' } : undefined}
              />
              <KpiCard
                label={data.google?.valueLabel === 'conversion value' ? 'Google value / ROAS' : 'Google'}
                value={data.google?.valueLabel === 'conversion value' && data.google.conversionValue != null
                  ? fmtMoney(convert(data.google.conversionValue, data.google.currency || native), base)
                  : data.google?.configured ? fmtMoney(googleSpendBase, base) : '—'}
                sub={data.google?.error
                  ? data.google.error
                  : data.google?.valueLabel === 'conversion value'
                    ? `ROAS ${data.google.roas != null ? fmtRoas(data.google.roas) : '—'} · spend ${fmtMoney(googleSpendBase, base)}`
                    : data.google?.configured === false
                      ? 'No Google Ads account'
                      : 'Google spend only'}
              />
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
              <KpiCard
                label="L7 avg daily gross"
                value={data.shopify ? fmtMoney(convert(data.shopify.l7DailyAvgRevenue, data.shopify.currency), base) : '—'}
                sub="L7 average daily gross, including quiet days"
              />
              <KpiCard
                label="vs last year sales"
                value={data.shopify?.lastYear.status === 'no_last_year_data'
                  ? 'no data'
                  : (() => {
                      const pct = vsBaselinePct(data.shopify?.today.revenue || 0, data.shopify?.lastYear.sales?.revenue || 0, data.shopify?.lastYear.status || 'no_last_year_data');
                      return pct == null ? '—' : fmtPct(pct);
                    })()}
                sub={data.shopify?.lastYear.status === 'ok'
                  ? `${data.shopify.lastYear.dayLabel} ${data.shopify.lastYear.date} · ${fmtMoney(convert(data.shopify.lastYear.sales?.revenue || 0, data.shopify.currency), base)}`
                  : data.shopify?.lastYear.earliestOrderDay
                    ? `Orders stored from ${data.shopify.lastYear.earliestOrderDay}`
                    : 'No stored orders'}
              />
              <KpiCard
                label="vs last year Meta spend"
                value={data.shopify?.lastYear.status === 'no_last_year_data' && !(lySameDay && lySameDay.totalSpend > 0)
                  ? 'no data'
                  : data.meta?.available && lySameDay && lySameDay.totalSpend > 0 ? fmtPct(vsLastYearSpendPct) : data.meta?.available ? '—' : 'n/a'}
                accent={data.meta?.available && lySameDay && lySameDay.totalSpend > 0 ? (vsLastYearSpendPct >= 0 ? 'green' : 'red') : 'default'}
                sub={lySameDay?.date ? `${lySameDay.dayLabel} ${lySameDay.date}` : 'no LY data'}
              />
            </div>

            {/* aMER breakdown strip */}
            {data.aMer.available && (
              <div className="rounded-xl px-5 py-3 mb-6 flex flex-wrap items-center gap-x-6 gap-y-1 text-xs" style={{ backgroundColor: '#111111', color: '#888' }}>
                <span className="font-medium" style={{ color: '#C8B89A' }}>aMER (7-day)</span>
                <span>NC revenue {fmtMoney(convert(data.aMer.l7NcRevenue), base)}</span>
                <span>Meta {fmtMoney(convert(data.aMer.l7MetaSpend), base)}</span>
                <span>Google {fmtMoney(convert(data.aMer.l7GoogleSpend, data.currencies.google || native), base)}</span>
                {data.aMer.l7OtherSpend > 0 && <span>Other {fmtMoney(convert(data.aMer.l7OtherSpend), base)}</span>}
                <span>→ {data.aMer.l7 != null ? fmtRoas(data.aMer.l7) : '—'}</span>
              </div>
            )}

            {data.shopify && (
              <div className="mb-6">
                <HourlySalesChart
                  today={data.shopify.today}
                  l7={data.shopify.l7HourlyAvg}
                  lastYear={data.shopify.lastYear.sales}
                  lastYearStatus={data.shopify.lastYear.status}
                  currency={base}
                  currentHour={currentHour}
                  factor={convert(1, data.shopify.currency)}
                />
              </div>
            )}

            {data.bfcmWindow.days && data.bfcmWindow.days.length > 0 && (
              <div className="rounded-xl p-5 mb-6" style={{ backgroundColor: '#111111' }}>
                <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
                  <h3 className="text-sm font-semibold" style={{ color: '#F5F5F8' }}>BFCM day goals</h3>
                  <label className="text-xs" style={{ color: '#777' }}>
                    Other date
                    <input
                      type="date"
                      value={extraGoalDate}
                      onChange={(event) => {
                        const date = event.target.value;
                        setExtraGoalDate(date);
                        if (!date || !authToken || !selectedBrandId) return;
                        fetch(`/api/bfcm-goals?brandId=${selectedBrandId}&from=${date}&to=${date}`, {
                          headers: { Authorization: `Bearer ${authToken}` },
                          cache: 'no-store',
                        })
                          .then(async (res) => {
                            const json = await res.json();
                            if (!res.ok) throw new Error(json.error || 'Goals unavailable');
                            const goal = (json.goals || [])[0];
                            if (goal) setGoalMap((prev) => ({ ...prev, [goal.date]: goal }));
                          })
                          .catch((err) => setGoalsError(err.message));
                      }}
                      className="ml-2 rounded-lg px-2 py-1"
                      style={{ backgroundColor: '#0A0A0A', color: '#F5F5F8', border: '1px solid rgba(255,255,255,0.08)' }}
                    />
                  </label>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr style={{ color: '#555' }}>
                        <th className="text-left py-2 pr-3 font-medium">Day</th>
                        <th className="text-left py-2 pr-3 font-medium">Revenue</th>
                        <th className="text-left py-2 pr-3 font-medium">Spend</th>
                        <th className="text-left py-2 font-medium">aMER</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(extraGoalDate && !data.bfcmWindow.days.some((day) => day.date === extraGoalDate)
                        ? [...data.bfcmWindow.days, { date: extraGoalDate, dayLabel: extraGoalDate }]
                        : data.bfcmWindow.days
                      ).map((day) => {
                        const goal = goalMap[day.date];
                        return (
                          <tr key={day.date} style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                            <td className="py-2 pr-3" style={{ color: day.date === data.today.date ? '#C8B89A' : '#F5F5F8' }}>
                              {day.dayLabel}<div style={{ color: '#555' }}>{day.date}</div>
                            </td>
                            <td className="py-2 pr-3"><GoalField compact label="" value={goal?.revenueGoal ?? null} disabled={goalAccess !== 'write'} onCommit={(value) => saveGoal(day.date, { revenueGoal: value })} /></td>
                            <td className="py-2 pr-3"><GoalField compact label="" value={goal?.spendBudget ?? null} disabled={goalAccess !== 'write'} onCommit={(value) => saveGoal(day.date, { spendBudget: value })} /></td>
                            <td className="py-2"><GoalField compact label="" value={goal?.amerTarget ?? null} step={0.1} disabled={goalAccess !== 'write'} onCommit={(value) => saveGoal(day.date, { amerTarget: value })} /></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Hourly curve */}
            <div className="mb-6">
              <HourlyCurveChart
                today={data.today}
                l7Baseline={data.l7Baseline}
                lastYearSameDay={data.lastYearBfcm.sameDay}
                currency={base}
                currentHour={currentHour}
                factor={convert(1)}
              />
            </div>

            {/* Campaign command table */}
            <div className="mb-6">
              <CampaignTable
                campaigns={data.campaigns}
                currency={base}
                targetRoas={effTargetRoas}
                breakevenRoas={breakevenRoas}
                factor={convert(1)}
              />
            </div>

            {/* BFCM window */}
            <div className="mb-6">
              <BfcmWindowChart
                thisYear={data.thisYearBfcm.fullWindow}
                lastYear={data.lastYearBfcm.fullWindow}
                currentDate={data.today.date}
                currency={base}
                factor={convert(1)}
                windowStart={data.bfcmWindow.start}
                windowEnd={data.bfcmWindow.end}
                earliestOrderDay={data.shopify?.lastYear.earliestOrderDay ?? null}
              />
            </div>

            {/* Footer */}
            <div className="mt-6 rounded-xl p-4 flex items-center gap-2 text-xs" style={{ backgroundColor: '#111111', color: '#555' }}>
              <Info size={14} />
              BFCM window {data.bfcmWindow.start} — {data.bfcmWindow.end} · {data.timezoneSource === 'ad_account' ? 'ad account' : 'shop'} timezone {data.timezone} · today cached 60s, history 15 min
            </div>
          </>
        )}
      </div>
    </Navbar>
  );
}
