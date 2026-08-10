'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  Loader,
  Zap,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  RefreshCw,
  Info,
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
  Legend,
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
}

interface BfcmPacingData {
  currency: string;
  bfcmWindow: { start: string; end: string };
  today: {
    date: string;
    dayLabel: string;
    hourlySpend: HourlyPoint[];
    totalSpendSoFar: number;
    projectedTotal: number;
  };
  l7Baseline: {
    hourlyAvg: HourlyPoint[];
    dailyAvg: number;
  };
  lastYearBfcm: {
    sameDay: { dayLabel: string; date: string; totalSpend: number; hourlySpend: HourlyPoint[] };
    fullWindow: DailyPoint[];
  };
  thisYearBfcm: {
    fullWindow: DailyPoint[];
  };
}

// ─── Formatters ─────────────────────────────────────────────────

const currencySymbols: Record<string, string> = {
  USD: '$', CAD: 'CA$', GBP: '£', EUR: '€', AUD: 'A$',
};

function fmtMoney(v: number, currency: string): string {
  const sym = currencySymbols[currency] || currency + ' ';
  if (v >= 1000) return `${sym}${(v / 1000).toFixed(1)}K`;
  return `${sym}${v.toFixed(0)}`;
}

function fmtPct(v: number): string {
  const sign = v >= 0 ? '+' : '';
  return `${sign}${v.toFixed(1)}%`;
}

// ─── KPI Card ───────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  sub,
  accent = 'default',
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: 'gold' | 'green' | 'red' | 'default';
}) {
  const accentColor =
    accent === 'gold' ? '#C8B89A'
    : accent === 'green' ? '#10B981'
    : accent === 'red' ? '#ef4444'
    : '#F5F5F8';
  return (
    <div
      className="rounded-xl p-5"
      style={{ backgroundColor: '#111111' }}
    >
      <div
        className="text-xs uppercase tracking-wider mb-2"
        style={{ color: '#ABABAB' }}
      >
        {label}
      </div>
      <div
        className="text-2xl font-semibold"
        style={{ color: accentColor }}
      >
        {value}
      </div>
      {sub && (
        <div className="text-xs mt-1.5" style={{ color: '#666' }}>
          {sub}
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
}: {
  today: BfcmPacingData['today'];
  l7Baseline: BfcmPacingData['l7Baseline'];
  lastYearSameDay: BfcmPacingData['lastYearBfcm']['sameDay'];
  currency: string;
}) {
  const currentHour = new Date().getHours();

  // Build cumulative data for all three series
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

  // Separate projected portion
  const actualData = data.filter(d => !d.isProjected);
  const projectedData = data.filter(d => d.isProjected);
  // Connect projected to actual: include last actual point in projected
  if (actualData.length > 0 && projectedData.length > 0) {
    projectedData.unshift(actualData[actualData.length - 1]);
  }

  const sym = currencySymbols[currency] || currency + ' ';

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
              <span
                className="w-3 h-0.5 rounded"
                style={{
                  backgroundColor: '#888',
                  backgroundImage: 'repeating-linear-gradient(90deg, #888 0px, #888 3px, transparent 3px, transparent 6px)',
                }}
              />
              Last Year
            </span>
          )}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={350}>
        <LineChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.04)" strokeDasharray="3 3" />
          <XAxis
            dataKey="hour"
            stroke="#555"
            tick={{ fontSize: 11, fill: '#555' }}
            tickLine={false}
          />
          <YAxis
            stroke="#555"
            tick={{ fontSize: 11, fill: '#555' }}
            tickLine={false}
            tickFormatter={(v: number) => `${sym}${v >= 1000 ? (v / 1000).toFixed(0) + 'K' : v.toFixed(0)}`}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#1a1a1a',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '8px',
              color: '#F5F5F8',
            }}
            formatter={(value: any, name: any) => [`${sym}${Number(value).toLocaleString()}`, String(name)]}
            />
          {/* Today solid gold */}
          <Line
            type="monotone"
            dataKey="today"
            stroke="#C8B89A"
            strokeWidth={2.5}
            dot={false}
            name="Today"
          />
          {/* L7 average */}
          <Line
            type="monotone"
            dataKey="l7"
            stroke="#666666"
            strokeWidth={1.5}
            dot={false}
            name="L7 Avg"
          />
          {/* Last year */}
          {lastYearSameDay?.totalSpend > 0 && (
            <Line
              type="monotone"
              dataKey="lastYear"
              stroke="#888888"
              strokeWidth={1.5}
              strokeDasharray="5 5"
              dot={false}
              name="Last Year"
            />
          )}
          {/* Current hour marker */}
          <ReferenceLine
            x={`${currentHour}:00`}
            stroke="rgba(200,184,154,0.4)"
            strokeDasharray="4 4"
            label={{
              value: 'Now',
              position: 'top',
              fill: '#C8B89A',
              fontSize: 10,
            }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── BFCM Window Bar Chart ──────────────────────────────────────

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
  const sym = currencySymbols[currency] || currency + ' ';

  // Build aligned data
  const data = thisYear.map((ty, i) => ({
    dayLabel: ty.dayLabel,
    shortLabel: ty.dayLabel === 'Thanksgiving' ? 'Thu 🦃'
      : ty.dayLabel === 'Black Friday' ? 'Fri BF'
      : ty.dayLabel === 'Cyber Monday' ? 'Mon CM'
      : ty.dayLabel.slice(0, 3),
    thisYear: ty.spend,
    lastYear: lastYear[i]?.spend || 0,
    isFuture: ty.date > currentDate,
  }));

  const tyTotal = thisYear.reduce((s, d) => s + d.spend, 0);
  const lyTotal = lastYear.reduce((s, d) => s + d.spend, 0);
  const yoyPct = lyTotal > 0 ? ((tyTotal - lyTotal) / lyTotal) * 100 : 0;

  return (
    <div className="rounded-xl p-6" style={{ backgroundColor: '#111111' }}>
      <h3 className="text-sm font-semibold mb-4" style={{ color: '#F5F5F8' }}>
        BFCM Window — Daily Breakdown
      </h3>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.04)" strokeDasharray="3 3" />
          <XAxis
            dataKey="shortLabel"
            stroke="#555"
            tick={{ fontSize: 11, fill: '#555' }}
            tickLine={false}
          />
          <YAxis
            stroke="#555"
            tick={{ fontSize: 11, fill: '#555' }}
            tickLine={false}
            tickFormatter={(v: number) => `${sym}${v >= 1000 ? (v / 1000).toFixed(0) + 'K' : v.toFixed(0)}`}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#1a1a1a',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '8px',
              color: '#F5F5F8',
            }}
            formatter={(value: any, name: any) => [`${sym}${Number(value).toLocaleString()}`, String(name)]}
          />
          <Bar dataKey="thisYear" fill="#C8B89A" name="This Year" maxBarSize={32} />
          <Bar dataKey="lastYear" fill="#444444" name="Last Year" maxBarSize={32} />
        </BarChart>
      </ResponsiveContainer>

      {/* Summary row */}
      <div
        className="flex flex-wrap gap-6 mt-4 pt-4 text-xs"
        style={{ borderTop: '1px solid rgba(255,255,255,0.06)', color: '#888' }}
      >
        <span>
          Window total: <span style={{ color: '#F5F5F8', fontWeight: 600 }}>{fmtMoney(tyTotal, currency)}</span>
        </span>
        <span>
          Last year: <span style={{ color: '#F5F5F8', fontWeight: 600 }}>{fmtMoney(lyTotal, currency)}</span>
        </span>
        {lyTotal > 0 && (
          <span>
            YoY:{' '}
            <span
              style={{
                color: yoyPct >= 0 ? '#10B981' : '#ef4444',
                fontWeight: 600,
              }}
            >
              {fmtPct(yoyPct)}
            </span>
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Daily Table ────────────────────────────────────────────────

function DailyTable({
  thisYear,
  lastYear,
  currency,
}: {
  thisYear: DailyPoint[];
  lastYear: DailyPoint[];
  currency: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const sym = currencySymbols[currency] || currency + ' ';

  let tyCum = 0;
  let lyCum = 0;

  const rows = thisYear.map((ty, i) => {
    const ly = lastYear[i];
    tyCum += ty.spend;
    if (ly) lyCum += ly.spend;
    const yoyPct = ly && ly.spend > 0 ? ((ty.spend - ly.spend) / ly.spend) * 100 : 0;
    return {
      date: ty.date,
      dayLabel: ty.dayLabel,
      thisYear: ty.spend,
      lastYear: ly?.spend || 0,
      yoyPct,
      tyCum,
      lyCum,
      hasLastYear: !!ly,
    };
  });

  const displayRows = expanded ? rows : rows.slice(0, 0);

  return (
    <div className="rounded-xl p-6" style={{ backgroundColor: '#111111' }}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-sm font-semibold mb-3 transition-colors"
        style={{ color: '#F5F5F8' }}
      >
        {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        Daily Table
      </button>

      {expanded && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <th className="text-left py-2 pr-4 font-medium" style={{ color: '#555' }}>Date</th>
                <th className="text-left py-2 pr-4 font-medium" style={{ color: '#555' }}>Day</th>
                <th className="text-right py-2 pr-4 font-medium" style={{ color: '#555' }}>This Year</th>
                <th className="text-right py-2 pr-4 font-medium" style={{ color: '#555' }}>Last Year</th>
                <th className="text-right py-2 pr-4 font-medium" style={{ color: '#555' }}>YoY %</th>
                <th className="text-right py-2 font-medium" style={{ color: '#555' }}>Cumulative</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr
                  key={row.date}
                  style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}
                >
                  <td className="py-2 pr-4" style={{ color: '#ABABAB' }}>{row.date}</td>
                  <td className="py-2 pr-4" style={{ color: '#F5F5F8' }}>{row.dayLabel}</td>
                  <td className="py-2 pr-4 text-right tabular-nums" style={{ color: '#F5F5F8' }}>
                    {sym}{row.thisYear.toLocaleString()}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums" style={{ color: '#888' }}>
                    {row.hasLastYear ? `${sym}${row.lastYear.toLocaleString()}` : '—'}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {row.hasLastYear ? (
                      <span style={{ color: row.yoyPct >= 0 ? '#10B981' : '#ef4444' }}>
                        {fmtPct(row.yoyPct)}
                      </span>
                    ) : (
                      <span style={{ color: '#555' }}>—</span>
                    )}
                  </td>
                  <td className="py-2 text-right tabular-nums" style={{ color: '#888' }}>
                    {sym}{row.tyCum.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────

export default function BfcmPacingPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  // Auth
  const [userRole, setUserRole] = useState<string | null>(null);
  const [userBrandId, setUserBrandId] = useState<string | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Brand
  const [brands, setBrands] = useState<Brand[]>([]);
  const [selectedBrandId, setSelectedBrandId] = useState<string>('');
  const [fetchingBrands, setFetchingBrands] = useState(false);
  const [showBrandDropdown, setShowBrandDropdown] = useState(false);

  // Data
  const [data, setData] = useState<BfcmPacingData | null>(null);
  const [fetchingData, setFetchingData] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());

  // ─── Auth init ──────────────────────────────────────────────

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

  // ─── Fetch brands ──────────────────────────────────────────

  useEffect(() => {
    if (!userRole || !['admin', 'strategist', 'founder'].includes(userRole)) return;
    const fetchBrands = async () => {
      setFetchingBrands(true);
      try {
        let query = supabase.from('brands').select('id, name, slug').is('archived_at', null).order('name');
        if (userRole === 'founder' && userBrandId) query = query.eq('id', userBrandId);
        else if (userRole === 'strategist' && userBrandId) query = query.eq('id', userBrandId);

        const { data: allBrands } = await query;
        setBrands(allBrands || []);
        if (allBrands && allBrands.length > 0 && !selectedBrandId) {
          const saved = localStorage.getItem('melch_selected_brand');
          const match = saved && allBrands.find((b: any) => b.id === saved);
          setSelectedBrandId(match ? saved : allBrands[0].id);
        }
      } catch (err) {
        console.error('Error fetching brands:', err);
      } finally {
        setFetchingBrands(false);
      }
    };
    fetchBrands();
  }, [userRole, supabase]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Fetch BFCM data ───────────────────────────────────────

  useEffect(() => {
    if (!authToken || !selectedBrandId) return;

    const fetchData = async () => {
      setFetchingData(true);
      setFetchError(null);
      try {
        const res = await fetch(
          `/api/bfcm-pacing?brandId=${selectedBrandId}&year=${selectedYear}`,
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
  }, [authToken, selectedBrandId, selectedYear]);

  // ─── Derived metrics ───────────────────────────────────────

  const l7WithThisHour = data
    ? data.l7Baseline.hourlyAvg
        .slice(0, new Date().getHours() + 1)
        .reduce((s, p) => s + p.spend, 0)
    : 0;

  const vsL7Pace = data && l7WithThisHour > 0
    ? ((data.today.totalSpendSoFar - l7WithThisHour) / l7WithThisHour) * 100
    : 0;

  const vsLastYearPct = data && data.lastYearBfcm.sameDay.totalSpend > 0
    ? ((data.today.totalSpendSoFar - data.lastYearBfcm.sameDay.totalSpend) / data.lastYearBfcm.sameDay.totalSpend) * 100
    : 0;

  const sym = data ? currencySymbols[data.currency] || data.currency + ' ' : '$';

  // ─── Loading / no brand ────────────────────────────────────

  if (loading) {
    return (
      <Navbar>
        <div className="flex items-center justify-center h-96" style={{ backgroundColor: '#0A0A0A' }}>
          <Loader className="animate-spin" size={24} style={{ color: '#C8B89A' }} />
        </div>
      </Navbar>
    );
  }

  // ─── Render ────────────────────────────────────────────────

  return (
    <Navbar>
      <div className="min-h-screen" style={{ backgroundColor: '#0A0A0A', padding: '24px 32px' }}>
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center gap-3">
              <Zap size={24} style={{ color: '#C8B89A' }} />
              <h1 className="text-2xl font-bold" style={{ color: '#F5F5F8' }}>
                BFCM Pacing
              </h1>
            </div>
            <p className="text-sm mt-1" style={{ color: '#666' }}>
              Live spend pace — today vs L7 baseline and last year&apos;s BFCM
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* Brand selector */}
            <div className="relative">
              <button
                onClick={() => setShowBrandDropdown(!showBrandDropdown)}
                className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm transition-all"
                style={{
                  backgroundColor: '#111111',
                  border: '1px solid rgba(255,255,255,0.08)',
                  color: '#F5F5F8',
                }}
              >
                {brands.find(b => b.id === selectedBrandId)?.name || 'Select brand'}
                <ChevronDown size={14} style={{ color: '#666' }} />
              </button>
              {showBrandDropdown && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowBrandDropdown(false)} />
                  <div
                    className="absolute right-0 mt-1 w-56 rounded-lg z-20 overflow-hidden"
                    style={{
                      backgroundColor: '#1a1a1a',
                      border: '1px solid rgba(255,255,255,0.08)',
                      boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
                    }}
                  >
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
                        onMouseEnter={(e) => {
                          if (b.id !== selectedBrandId) e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.04)';
                        }}
                        onMouseLeave={(e) => {
                          if (b.id !== selectedBrandId) e.currentTarget.style.backgroundColor = 'transparent';
                        }}
                      >
                        {b.name}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Year selector */}
            <select
              value={selectedYear}
              onChange={e => setSelectedYear(parseInt(e.target.value, 10))}
              className="rounded-lg px-4 py-2 text-sm"
              style={{
                backgroundColor: '#111111',
                border: '1px solid rgba(255,255,255,0.08)',
                color: '#F5F5F8',
              }}
            >
              {[2024, 2025, 2026, 2027].map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>

            {/* Refresh */}
            <button
              onClick={() => {
                if (!authToken || !selectedBrandId) return;
                setFetchingData(true);
                fetch(`/api/bfcm-pacing?brandId=${selectedBrandId}&year=${selectedYear}`, {
                  headers: { Authorization: `Bearer ${authToken}` },
                })
                  .then(r => r.json())
                  .then(d => { setData(d); setFetchingData(false); })
                  .catch(() => setFetchingData(false));
              }}
              className="rounded-lg p-2 transition-colors"
              style={{ backgroundColor: '#111111', border: '1px solid rgba(255,255,255,0.08)', color: '#888' }}
              onMouseEnter={(e) => { e.currentTarget.style.color = '#C8B89A'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = '#888'; }}
            >
              <RefreshCw size={16} className={fetchingData ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {/* Error banner */}
        {fetchError && (
          <div
            className="flex items-center gap-3 rounded-xl px-5 py-4 mb-6"
            style={{ backgroundColor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.15)' }}
          >
            <AlertTriangle size={18} style={{ color: '#ef4444' }} />
            <span className="text-sm" style={{ color: '#fca5a5' }}>{fetchError}</span>
            <button
              onClick={() => {
                if (!authToken || !selectedBrandId) return;
                setFetchingData(true);
                fetch(`/api/bfcm-pacing?brandId=${selectedBrandId}&year=${selectedYear}`, {
                  headers: { Authorization: `Bearer ${authToken}` },
                })
                  .then(r => r.json())
                  .then(d => { setData(d); setFetchError(null); setFetchingData(false); })
                  .catch(err => { setFetchError(err.message); setFetchingData(false); });
              }}
              className="ml-auto text-xs font-medium px-3 py-1 rounded"
              style={{ color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)' }}
            >
              Retry
            </button>
          </div>
        )}

        {/* Loading state */}
        {fetchingData && !data && (
          <div className="flex items-center justify-center h-64">
            <Loader className="animate-spin" size={24} style={{ color: '#C8B89A' }} />
          </div>
        )}

        {/* Data */}
        {data && (
          <>
            {/* KPI Cards */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
              <KpiCard
                label="Spend So Far"
                value={fmtMoney(data.today.totalSpendSoFar, data.currency)}
                accent="gold"
              />
              <KpiCard
                label="L7 Avg by This Hour"
                value={fmtMoney(l7WithThisHour, data.currency)}
                sub="same-hour baseline"
              />
              <KpiCard
                label="vs L7 Pace"
                value={fmtPct(vsL7Pace)}
                accent={vsL7Pace >= 0 ? 'gold' : 'red'}
              />
              <KpiCard
                label="Projected Today"
                value={fmtMoney(data.today.projectedTotal, data.currency)}
                sub={`L7 daily avg ${fmtMoney(data.l7Baseline.dailyAvg, data.currency)}`}
                accent="gold"
              />
              {data.lastYearBfcm.sameDay.totalSpend > 0 ? (
                <>
                  <KpiCard
                    label="vs Last Year Same Day"
                    value={fmtPct(vsLastYearPct)}
                    accent={vsLastYearPct >= 0 ? 'gold' : 'red'}
                  />
                  <KpiCard
                    label="Last Year Same Day"
                    value={fmtMoney(data.lastYearBfcm.sameDay.totalSpend, data.currency)}
                    sub={data.lastYearBfcm.sameDay.dayLabel}
                  />
                </>
              ) : (
                <>
                  <KpiCard
                    label="vs Last Year"
                    value="—"
                    sub="no data available"
                  />
                  <KpiCard
                    label="Last Year"
                    value="—"
                    sub="no data available"
                  />
                </>
              )}
            </div>

            {/* Hourly Spend Curve */}
            <div className="mb-6">
              <HourlyCurveChart
                today={data.today}
                l7Baseline={data.l7Baseline}
                lastYearSameDay={data.lastYearBfcm.sameDay}
                currency={data.currency}
              />
            </div>

            {/* BFCM Window Bar Chart */}
            <div className="mb-6">
              <BfcmWindowChart
                thisYear={data.thisYearBfcm.fullWindow}
                lastYear={data.lastYearBfcm.fullWindow}
                currentDate={data.today.date}
                currency={data.currency}
              />
            </div>

            {/* Daily Table */}
            <DailyTable
              thisYear={data.thisYearBfcm.fullWindow}
              lastYear={data.lastYearBfcm.fullWindow}
              currency={data.currency}
            />

            {/* BFCM window info */}
            <div
              className="mt-6 rounded-xl p-4 flex items-center gap-2 text-xs"
              style={{ backgroundColor: '#111111', color: '#555' }}
            >
              <Info size={14} />
              BFCM window: {data.bfcmWindow.start} — {data.bfcmWindow.end} (8 days, Mon before Thanksgiving through Cyber Monday)
            </div>
          </>
        )}
      </div>
    </Navbar>
  );
}
