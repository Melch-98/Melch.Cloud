'use client';

import { useState, useEffect, useMemo } from 'react';
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

type Decision = 'scale' | 'hold' | 'watch' | 'pause' | 'low';

// ─── Formatters ─────────────────────────────────────────────────

const currencySymbols: Record<string, string> = {
  USD: '$', CAD: 'CA$', GBP: '£', EUR: '€', AUD: 'A$',
};

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

// ─── Decision classification ────────────────────────────────────

const MIN_JUDGE_SPEND = 50; // $ threshold below which a campaign is "too early to judge"

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
  // No breakeven known — fall back to a fraction of target
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

// ─── Hourly Spend Curve Chart ───────────────────────────────────

function HourlyCurveChart({
  today,
  l7Baseline,
  lastYearSameDay,
  currency,
  currentHour,
}: {
  today: BfcmPacingData['today'];
  l7Baseline: BfcmPacingData['l7Baseline'];
  lastYearSameDay: BfcmPacingData['lastYearBfcm']['sameDay'];
  currency: string;
  currentHour: number;
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
      today: Math.round(todayCum * 100) / 100,
      l7: Math.round(l7Cum * 100) / 100,
      lastYear: Math.round(lyCum * 100) / 100,
      isProjected: hour > currentHour,
    };
  });

  const s = sym(currency);

  return (
    <div className="rounded-xl p-6" style={{ backgroundColor: '#111111' }}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold" style={{ color: '#F5F5F8' }}>
          Hourly Cumulative Spend
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
}: {
  thisYear: DailyPoint[];
  lastYear: DailyPoint[];
  currentDate: string;
  currency: string;
}) {
  const [metric, setMetric] = useState<'spend' | 'roas'>('spend');
  const s = sym(currency);

  if (thisYear.length === 0) {
    const year = new Date().getFullYear();
    let thursdayCount = 0;
    let thanksgiving: Date | null = null;
    for (let d = 1; d <= 30; d++) {
      const date = new Date(year, 10, d);
      if (date.getDay() === 4) {
        thursdayCount++;
        if (thursdayCount === 4) { thanksgiving = date; break; }
      }
    }
    const mon = new Date(thanksgiving!);
    mon.setDate(mon.getDate() - 3);
    const cm = new Date(thanksgiving!);
    cm.setDate(cm.getDate() + 4);
    const daysAway = Math.max(0, Math.ceil((mon.getTime() - Date.now()) / 86400000));
    const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    return (
      <div className="rounded-xl p-6" style={{ backgroundColor: '#111111' }}>
        <h3 className="text-sm font-semibold mb-4" style={{ color: '#F5F5F8' }}>
          BFCM Window — Daily Breakdown
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
                data={lastYear.map(ly => ({ shortLabel: shortDay(ly.dayLabel), value: ly.spend }))}
                margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
              >
                <CartesianGrid stroke="rgba(255,255,255,0.04)" strokeDasharray="3 3" />
                <XAxis dataKey="shortLabel" stroke="#555" tick={{ fontSize: 11, fill: '#555' }} tickLine={false} />
                <YAxis stroke="#555" tick={{ fontSize: 11, fill: '#555' }} tickLine={false}
                  tickFormatter={(v: number) => `${s}${v >= 1000 ? (v / 1000).toFixed(0) + 'K' : v.toFixed(0)}`} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', color: '#F5F5F8' }}
                  formatter={(value: any, name: any) => [`${s}${Number(value).toLocaleString()}`, String(name)]} />
                <Bar dataKey="value" fill="#444444" name="Last Year Spend" maxBarSize={32} />
              </BarChart>
            </ResponsiveContainer>
            <div className="flex flex-wrap gap-6 mt-3 text-xs" style={{ color: '#888' }}>
              <span>
                Last year total:{' '}
                <span style={{ color: '#F5F5F8', fontWeight: 600 }}>
                  {fmtMoney(lastYear.reduce((sum, d) => sum + d.spend, 0), currency)}
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
    thisYear: metric === 'spend' ? ty.spend : ty.roas,
    lastYear: metric === 'spend' ? (lastYear[i]?.spend || 0) : (lastYear[i]?.roas || 0),
    isFuture: ty.date > currentDate,
  }));

  const tyTotal = thisYear.reduce((sum, d) => sum + d.spend, 0);
  const lyTotal = lastYear.reduce((sum, d) => sum + d.spend, 0);
  const yoyPct = lyTotal > 0 ? ((tyTotal - lyTotal) / lyTotal) * 100 : 0;
  const tyRoas = tyTotal > 0 ? thisYear.reduce((sum, d) => sum + d.purchaseValue, 0) / tyTotal : 0;

  return (
    <div className="rounded-xl p-6" style={{ backgroundColor: '#111111' }}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold" style={{ color: '#F5F5F8' }}>
          BFCM Window — Daily Breakdown
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
              metric === 'spend' ? `${s}${Number(value).toLocaleString()}` : `${Number(value).toFixed(2)}×`,
              String(name),
            ]}
          />
          <Bar dataKey="thisYear" fill="#C8B89A" name="This Year" maxBarSize={32} />
          <Bar dataKey="lastYear" fill="#444444" name="Last Year" maxBarSize={32} />
        </BarChart>
      </ResponsiveContainer>

      <div className="flex flex-wrap gap-6 mt-4 pt-4 text-xs" style={{ borderTop: '1px solid rgba(255,255,255,0.06)', color: '#888' }}>
        <span>
          Window spend: <span style={{ color: '#F5F5F8', fontWeight: 600 }}>{fmtMoney(tyTotal, currency)}</span>
        </span>
        <span>
          Last year: <span style={{ color: '#F5F5F8', fontWeight: 600 }}>{fmtMoney(lyTotal, currency)}</span>
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
}: {
  campaigns: CampaignToday[];
  currency: string;
  targetRoas: number;
  breakevenRoas: number | null;
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
        <h3 className="text-sm font-semibold mb-3" style={{ color: '#F5F5F8' }}>Campaign Command</h3>
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
        <h3 className="text-sm font-semibold" style={{ color: '#F5F5F8' }}>Campaign Command</h3>
        <div className="text-xs" style={{ color: '#555' }}>
          {campaigns.length} campaigns · target {fmtRoas(targetRoas)}
          {breakevenRoas != null ? ` · breakeven ${fmtRoas(breakevenRoas)}` : ''}
        </div>
      </div>
      <p className="text-xs mb-4" style={{ color: '#666' }}>
        Decision = today&apos;s ROAS vs target. Campaigns under ${MIN_JUDGE_SPEND} or paused are flagged low-priority.
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
                  <td className="py-2.5 pr-4 text-right tabular-nums" style={{ color: '#F5F5F8' }}>{fmtMoney(c.spend, currency)}</td>
                  <td className="py-2.5 pr-4 text-right tabular-nums" style={{ color: '#ABABAB' }}>{fmtMoney(c.purchaseValue, currency)}</td>
                  <td className="py-2.5 pr-4 text-right tabular-nums" style={{ color: c.roas >= targetRoas ? '#22C55E' : '#F5F5F8' }}>{fmtRoas(c.roas)}</td>
                  <td className="py-2.5 pr-4 text-right tabular-nums" style={{ color: '#ABABAB' }}>{c.cpa > 0 ? fmtMoney(c.cpa, currency) : '—'}</td>
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

  // Per-brand targets (persisted)
  const [targetBudget, setTargetBudget] = useState<number | null>(null);
  const [targetRoas, setTargetRoas] = useState<number | null>(null);

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

  useEffect(() => {
    if (!authToken || !selectedBrandId) return;
    const fetchData = async () => {
      setFetchingData(true);
      setFetchError(null);
      try {
        const res = await fetch(
          `/api/bfcm-pacing?brandId=${selectedBrandId}`,
          { headers: { Authorization: `Bearer ${authToken}` } }
        );
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Failed to fetch data');
        setData(json);
      } catch (err: any) {
        setFetchError(err.message || 'Failed to load BFCM pacing data');
        setData(null);
      } finally {
        setFetchingData(false);
      }
    };
    fetchData();
  }, [authToken, selectedBrandId]);

  // Load persisted targets when brand or data changes
  useEffect(() => {
    if (!selectedBrandId) return;
    const bb = localStorage.getItem(`bfcm_target_budget_${selectedBrandId}`);
    const tr = localStorage.getItem(`bfcm_target_roas_${selectedBrandId}`);
    setTargetBudget(bb ? parseFloat(bb) : null);
    setTargetRoas(tr ? parseFloat(tr) : null);
  }, [selectedBrandId]);

  // Derive break-even ROAS from gross margin
  const breakevenRoas = useMemo(() => {
    if (!data || data.grossMarginPct == null || data.grossMarginPct <= 0) return null;
    return 100 / data.grossMarginPct;
  }, [data]);

  // Effective target ROAS (persisted or default = breakeven × 1.5)
  const effTargetRoas = targetRoas != null
    ? targetRoas
    : breakevenRoas != null
      ? Math.round(breakevenRoas * 1.5 * 10) / 10
      : 2.0;

  // Effective target budget (persisted or default = L7 daily avg)
  const effTargetBudget = targetBudget != null
    ? targetBudget
    : data
      ? data.l7Baseline.dailyAvg
      : 0;

  const getAdAccountHour = (): number => {
    if (!data?.timezone) return new Date().getHours();
    try {
      const now = new Date();
      const formatter = new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        hour12: false,
        timeZone: data.timezone,
      });
      return parseInt(formatter.format(now), 10);
    } catch {
      return new Date().getHours();
    }
  };

  const currentHour = getAdAccountHour();

  const l7WithThisHour = data
    ? data.l7Baseline.hourlyAvg.slice(0, currentHour + 1).reduce((s, p) => s + p.spend, 0)
    : 0;

  // Projected EOD spend: assume remaining hours track L7 shape from here
  const projectedTotal = data && l7WithThisHour > 0
    ? (data.today.totalSpendSoFar / l7WithThisHour) * data.l7Baseline.dailyAvg
    : data
      ? data.today.totalSpendSoFar * (24 / (currentHour + 1))
      : 0;

  const budgetPct = effTargetBudget > 0 ? (data ? data.today.totalSpendSoFar / effTargetBudget * 100 : 0) : 0;

  const lySameDay = data?.lastYearBfcm?.sameDay;
  const vsLastYearSpendPct = data && lySameDay && lySameDay.totalSpend > 0
    ? ((data.today.totalSpendSoFar - lySameDay.totalSpend) / lySameDay.totalSpend) * 100
    : 0;
  const lyRoasDelta = data && lySameDay && lySameDay.totalSpend > 0
    ? data.today.roas - lySameDay.roas
    : 0;

  const hoursLeft = 24 - currentHour - 1;
  const neededRunRate = data && hoursLeft > 0 && effTargetBudget > 0
    ? (effTargetBudget - data.today.totalSpendSoFar) / hoursLeft
    : 0;

  // Alerts
  const alerts = useMemo(() => {
    if (!data) return [];
    const list: { tone: 'red' | 'amber' | 'green'; text: string }[] = [];

    if (effTargetBudget > 0) {
      const pct = data.today.totalSpendSoFar / effTargetBudget * 100;
      if (pct < 75 && currentHour >= 14) {
        list.push({ tone: 'amber', text: `Behind budget — ${fmtMoney(data.today.totalSpendSoFar, data.currency)} of ${fmtMoney(effTargetBudget, data.currency)} (${pct.toFixed(0)}%). Raise budget or scale winners.` });
      } else if (pct > 110) {
        list.push({ tone: 'amber', text: `Over budget pace — ${pct.toFixed(0)}% of target. Trim losers before you blow the day.` });
      }
    }

    if (breakevenRoas != null && data.today.roas > 0 && data.today.roas < breakevenRoas) {
      list.push({ tone: 'red', text: `Today ROAS ${data.today.roas.toFixed(2)}× is below breakeven ${breakevenRoas.toFixed(2)}×.` });
    }

    const pauseCount = data.campaigns.filter(c => classifyCampaign(c, effTargetRoas, breakevenRoas).decision === 'pause').length;
    const scaleCount = data.campaigns.filter(c => classifyCampaign(c, effTargetRoas, breakevenRoas).decision === 'scale').length;

    if (pauseCount > 0) {
      list.push({ tone: 'red', text: `${pauseCount} campaign${pauseCount > 1 ? 's' : ''} burning (spend with zero conversions) — pause now.` });
    }
    if (scaleCount > 0) {
      list.push({ tone: 'green', text: `${scaleCount} campaign${scaleCount > 1 ? 's' : ''} beating target — scale up.` });
    }

    return list.slice(0, 5);
  }, [data, effTargetRoas, breakevenRoas, effTargetBudget, currentHour]);

  const saveTargetBudget = (v: number) => {
    setTargetBudget(v);
    if (selectedBrandId) localStorage.setItem(`bfcm_target_budget_${selectedBrandId}`, String(v));
  };

  const saveTargetRoas = (v: number) => {
    setTargetRoas(v);
    if (selectedBrandId) localStorage.setItem(`bfcm_target_roas_${selectedBrandId}`, String(v));
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
              Live spend, revenue, ROAS and campaign-level decisions — one screen for the whole weekend
            </p>
          </div>

          <div className="flex items-center gap-3">
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

            {/* Refresh */}
            <button
              onClick={() => {
                if (!authToken || !selectedBrandId) return;
                setFetchingData(true);
                fetch(`/api/bfcm-pacing?brandId=${selectedBrandId}`, {
                  headers: { Authorization: `Bearer ${authToken}` },
                })
                  .then(r => r.json())
                  .then(d => { setData(d); setFetchingData(false); })
                  .catch(() => setFetchingData(false));
              }}
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
            <span className="text-sm" style={{ color: '#fca5a5' }}>{fetchError}</span>
          </div>
        )}

        {fetchingData && !data && (
          <div className="flex items-center justify-center h-64">
            <Loader className="animate-spin" size={24} style={{ color: '#C8B89A' }} />
          </div>
        )}

        {data && (
          <>
            {/* Target inputs */}
            <div className="flex flex-wrap items-end gap-4 mb-6">
              <div>
                <div className="text-xs uppercase tracking-wider mb-1.5" style={{ color: '#777' }}>Daily Budget Target</div>
                <div className="flex items-center gap-1">
                  <span className="text-sm" style={{ color: '#888' }}>{sym(data.currency)}</span>
                  <input
                    type="number"
                    min={0}
                    value={effTargetBudget === 0 ? '' : Math.round(effTargetBudget)}
                    placeholder="e.g. 5000"
                    onChange={e => saveTargetBudget(parseFloat(e.target.value) || 0)}
                    className="w-28 rounded-lg px-3 py-2 text-sm tabular-nums"
                    style={{ backgroundColor: '#111111', border: '1px solid rgba(255,255,255,0.08)', color: '#F5F5F8' }}
                  />
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wider mb-1.5" style={{ color: '#777' }}>Target ROAS</div>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    step={0.1}
                    min={0}
                    value={effTargetRoas}
                    onChange={e => saveTargetRoas(parseFloat(e.target.value) || 0)}
                    className="w-24 rounded-lg px-3 py-2 text-sm tabular-nums"
                    style={{ backgroundColor: '#111111', border: '1px solid rgba(255,255,255,0.08)', color: '#F5F5F8' }}
                  />
                  <span className="text-sm" style={{ color: '#888' }}>×</span>
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs pb-2" style={{ color: '#666' }}>
                <Target size={13} />
                {breakevenRoas != null
                  ? `Breakeven ${breakevenRoas.toFixed(2)}× (${data.grossMarginPct}% GM)`
                  : 'Set target ROAS to classify campaigns'}
              </div>
            </div>

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
                label="Spend Today"
                value={fmtMoney(data.today.totalSpendSoFar, data.currency)}
                accent="gold"
                sub={effTargetBudget > 0 ? `of ${fmtMoney(effTargetBudget, data.currency)} target` : `L7 avg ${fmtMoney(data.l7Baseline.dailyAvg, data.currency)}`}
                bar={effTargetBudget > 0 ? { pct: budgetPct, color: budgetPct <= 110 ? '#C8B89A' : '#EF4444' } : undefined}
              />
              <KpiCard
                label="Revenue Today"
                value={fmtMoney(data.today.purchaseValue, data.currency)}
                sub={`${fmtNum(data.today.purchases)} orders`}
              />
              <KpiCard
                label="ROAS Today"
                value={fmtRoas(data.today.roas)}
                accent={effTargetRoas > 0 ? (data.today.roas >= effTargetRoas ? 'green' : data.today.roas > 0 ? 'red' : 'default') : 'default'}
                sub={`target ${fmtRoas(effTargetRoas)}${breakevenRoas != null ? ` · BE ${fmtRoas(breakevenRoas)}` : ''}`}
              />
              <KpiCard
                label="Projected EOD"
                value={fmtMoney(projectedTotal, data.currency)}
                accent={effTargetBudget > 0 ? (projectedTotal >= effTargetBudget ? 'green' : 'amber') : 'gold'}
                sub={neededRunRate > 0 ? `needs ${fmtMoney(neededRunRate, data.currency)}/hr` : `${hoursLeft}h left`}
              />
              <KpiCard
                label="vs Last Year Spend"
                value={lySameDay && lySameDay.totalSpend > 0 ? fmtPct(vsLastYearSpendPct) : '—'}
                accent={vsLastYearSpendPct >= 0 ? 'green' : 'red'}
                sub={lySameDay && lySameDay.totalSpend > 0 ? `LY ${fmtMoney(lySameDay.totalSpend, data.currency)}` : 'no LY data'}
              />
              <KpiCard
                label="vs Last Year ROAS"
                value={lySameDay && lySameDay.totalSpend > 0 ? fmtRoasDelta(lyRoasDelta) : '—'}
                accent={lyRoasDelta >= 0 ? 'green' : 'red'}
                sub={lySameDay && lySameDay.totalSpend > 0 ? `LY ${fmtRoas(lySameDay.roas)}` : 'no LY data'}
              />
            </div>

            {/* Hourly curve */}
            <div className="mb-6">
              <HourlyCurveChart
                today={data.today}
                l7Baseline={data.l7Baseline}
                lastYearSameDay={data.lastYearBfcm.sameDay}
                currency={data.currency}
                currentHour={currentHour}
              />
            </div>

            {/* Campaign command table */}
            <div className="mb-6">
              <CampaignTable
                campaigns={data.campaigns}
                currency={data.currency}
                targetRoas={effTargetRoas}
                breakevenRoas={breakevenRoas}
              />
            </div>

            {/* BFCM window */}
            <div className="mb-6">
              <BfcmWindowChart
                thisYear={data.thisYearBfcm.fullWindow}
                lastYear={data.lastYearBfcm.fullWindow}
                currentDate={data.today.date}
                currency={data.currency}
              />
            </div>

            {/* Footer */}
            <div className="mt-6 rounded-xl p-4 flex items-center gap-2 text-xs" style={{ backgroundColor: '#111111', color: '#555' }}>
              <Info size={14} />
              BFCM window {data.bfcmWindow.start} — {data.bfcmWindow.end} · ad account timezone {data.timezone} · refreshed manually (5 min server cache)
            </div>
          </>
        )}
      </div>
    </Navbar>
  );
}
