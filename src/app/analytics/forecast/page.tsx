'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Loader,
  TrendingUp,
  DollarSign,
  Calendar,
  Target,
  BarChart3,
  ChevronDown,
  ChevronUp,
  Save,
  RefreshCw,
  Info,
  Check,
} from 'lucide-react';
import Navbar from '@/components/Navbar';
import { createClient } from '@/lib/supabase';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ComposedChart, Area,
  ReferenceLine,
} from 'recharts';

// ─── Types ──────────────────────────────────────────────────────

interface Brand {
  id: string;
  name: string;
  slug: string;
  shopify_gross_margin_pct: number;
}

interface DailyRow {
  date: string;
  gross_sales: number;
  nc_revenue: number;
  rc_revenue: number;
  meta_spend: number;
  google_spend: number;
  other_spend: number;
  nc_orders: number;
  rc_orders: number;
  discounts: number;
  refunds: number;
}

interface ScenarioRow {
  month_start: string; // YYYY-MM-DD
  planned_spend: number;
  target_amer: number;
  marketing_lift_pct: number;
  nc_share_pct: number;
  cod_pct: number;
}

type Scenario = 'conservative' | 'base' | 'stretch';

interface MonthForecast {
  month: string;       // YYYY-MM
  label: string;       // "Jan", "Feb", etc.
  isPast: boolean;
  daysInMonth: number;
  // Inputs (editable for future months)
  mktgLift: number;
  spend: number;
  targetAmer: number;
  ncSharePct: number;
  codPct: number;
  // Calculated
  totalRev: number;
  ncRev: number;
  rcRev: number;
  ncCM: number;
  returningCM: number;
  totalCM: number;
  totalOrderRev: number;
  // Actuals (only for past months)
  actualSpend: number | null;
  actualRev: number | null;
  actualCM: number | null;
  actualAmer: number | null;
}

interface DailyTarget {
  date: string;
  dow: string;
  dowWeight: number;
  forecastRev: number;
  forecastSpend: number;
  forecastCM: number;
  actualRev: number | null;
  actualSpend: number | null;
  actualCM: number | null;
  revDiffPct: number | null;
  cmDiffPct: number | null;
}

// ─── Constants ──────────────────────────────────────────────────

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const DOW_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

// Default monthly seasonality weights (DTC typical — editable)
const DEFAULT_SEASONALITY: Record<string, number> = {
  Jan: 5, Feb: 2, Mar: 3, Apr: 4, May: 2, Jun: 5,
  Jul: 8, Aug: 5, Sep: 5, Oct: 8, Nov: 6, Dec: 8,
};

const SCENARIO_LABELS: Record<Scenario, string> = {
  conservative: 'Conservative',
  base: 'Base',
  stretch: 'Stretch',
};

const SCENARIO_COLORS: Record<Scenario, string> = {
  conservative: '#ef4444',
  base: '#C8B89A',
  stretch: '#10B981',
};

// ─── Helpers ────────────────────────────────────────────────────

function fmt(n: number): string {
  if (Math.abs(n) >= 1_000_000) return '$' + (n / 1_000_000).toFixed(2) + 'M';
  if (Math.abs(n) >= 1_000) return '$' + (n / 1_000).toFixed(1) + 'K';
  return '$' + n.toFixed(0);
}

function fmtPct(n: number): string {
  return n.toFixed(1) + '%';
}

function fmtNum(n: number, d = 2): string {
  return n.toFixed(d);
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function getMonthStart(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-01`;
}

// ─── Component ──────────────────────────────────────────────────

export default function ForecastPage() {
  const router = useRouter();
  const supabase = createClient();

  // State
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [selectedBrand, setSelectedBrand] = useState('');
  const [dailyData, setDailyData] = useState<DailyRow[]>([]);
  const [scenario, setScenario] = useState<Scenario>('base');
  const [savedScenarios, setSavedScenarios] = useState<Record<Scenario, ScenarioRow[]>>({
    conservative: [], base: [], stretch: [],
  });
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null);
  const [showCharts, setShowCharts] = useState(true);

  // Forecast year — start from current year
  const now = new Date();
  const [forecastYear, setForecastYear] = useState(now.getFullYear());

  // DOW weights (computed from data)
  const [dowWeights, setDowWeights] = useState<number[]>([1,1,1,1,1,1,1]);

  // Monthly seasonality (editable)
  const [seasonality, setSeasonality] = useState<Record<string, number>>({ ...DEFAULT_SEASONALITY });

  // Editable scenario inputs per month
  const [monthInputs, setMonthInputs] = useState<Record<string, {
    spend: number;
    amer: number;
    lift: number;
    ncShare: number;
    cod: number;
  }>>({});

  // ─── Auth + brands ────────────────────────────────────────────
  useEffect(() => {
    async function init() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push('/login'); return; }

      const { data: profile } = await supabase
        .from('users_profile')
        .select('role, brand_id')
        .eq('id', session.user.id)
        .single();

      const { data: brandList } = await supabase
        .from('brands')
        .select('id, name, slug, shopify_gross_margin_pct');

      if (brandList) setBrands(brandList);

      const brandId = profile?.brand_id || (brandList && brandList.length > 0 ? brandList[0].id : '');
      if (brandId) {
        setSelectedBrand(brandId);
      } else {
        setLoading(false);
      }
    }
    init();
  }, []);

  // ─── Load daily_pnl + saved scenarios ─────────────────────────
  useEffect(() => {
    if (!selectedBrand) return;
    async function fetchData() {
      setLoading(true);

      // Fetch all daily_pnl for the brand
      const { data: pnl } = await supabase
        .from('daily_pnl')
        .select('date, gross_sales, nc_revenue, rc_revenue, meta_spend, google_spend, other_spend, nc_orders, rc_orders, discounts, refunds')
        .eq('brand_id', selectedBrand)
        .order('date', { ascending: true });

      if (pnl) {
        setDailyData(pnl.map(r => ({
          date: r.date,
          gross_sales: Number(r.gross_sales || 0),
          nc_revenue: Number(r.nc_revenue || 0),
          rc_revenue: Number(r.rc_revenue || 0),
          meta_spend: Number(r.meta_spend || 0),
          google_spend: Number(r.google_spend || 0),
          other_spend: Number(r.other_spend || 0),
          nc_orders: Number(r.nc_orders || 0),
          rc_orders: Number(r.rc_orders || 0),
          discounts: Number(r.discounts || 0),
          refunds: Number(r.refunds || 0),
        })));

        // Compute DOW weights from historical data
        const dowTotals = [0,0,0,0,0,0,0];
        const dowCounts = [0,0,0,0,0,0,0];
        pnl.forEach(r => {
          const d = new Date(r.date + 'T00:00:00');
          const dow = d.getDay();
          dowTotals[dow] += Number(r.gross_sales || 0);
          dowCounts[dow] += 1;
        });
        const dowAvgs = dowTotals.map((t, i) => dowCounts[i] > 0 ? t / dowCounts[i] : 0);
        const overallAvg = dowAvgs.reduce((a, b) => a + b, 0) / 7;
        if (overallAvg > 0) {
          setDowWeights(dowAvgs.map(a => a / overallAvg));
        }
      }

      // Fetch saved scenarios
      const { data: scenarios } = await supabase
        .from('forecast_scenarios')
        .select('*')
        .eq('brand_id', selectedBrand);

      if (scenarios) {
        const grouped: Record<Scenario, ScenarioRow[]> = { conservative: [], base: [], stretch: [] };
        scenarios.forEach((s: any) => {
          const sc = s.scenario as Scenario;
          if (grouped[sc]) {
            grouped[sc].push({
              month_start: s.month_start,
              planned_spend: Number(s.planned_spend),
              target_amer: Number(s.target_amer),
              marketing_lift_pct: Number(s.marketing_lift_pct),
              nc_share_pct: Number(s.nc_share_pct),
              cod_pct: Number(s.cod_pct),
            });
          }
        });
        setSavedScenarios(grouped);
      }

      setLoading(false);
    }
    fetchData();
  }, [selectedBrand]);

  // ─── Compute monthly actuals from daily_pnl ──────────────────
  const monthlyActuals = useMemo(() => {
    const map: Record<string, {
      spend: number; rev: number; ncRev: number; rcRev: number;
      ncOrders: number; rcOrders: number; days: number;
    }> = {};
    dailyData.forEach(r => {
      const m = r.date.substring(0, 7); // YYYY-MM
      if (!map[m]) map[m] = { spend: 0, rev: 0, ncRev: 0, rcRev: 0, ncOrders: 0, rcOrders: 0, days: 0 };
      map[m].spend += r.meta_spend + r.google_spend + r.other_spend;
      map[m].rev += r.gross_sales;
      map[m].ncRev += r.nc_revenue;
      map[m].rcRev += r.rc_revenue;
      map[m].ncOrders += r.nc_orders;
      map[m].rcOrders += r.rc_orders;
      map[m].days += 1;
    });
    return map;
  }, [dailyData]);

  // ─── Initialize month inputs when data loads ──────────────────
  useEffect(() => {
    if (!dailyData.length && !savedScenarios[scenario].length) return;

    const brand = brands.find(b => b.id === selectedBrand);
    const codPct = brand ? (100 - brand.shopify_gross_margin_pct) : 35;

    // Compute trailing run-rate from last 30 days
    const sorted = [...dailyData].sort((a, b) => b.date.localeCompare(a.date));
    const last30 = sorted.slice(0, 30);
    const avgDailySpend = last30.length > 0 ? last30.reduce((s, r) => s + r.meta_spend + r.google_spend + r.other_spend, 0) / last30.length : 1500;
    const avgDailyRev = last30.length > 0 ? last30.reduce((s, r) => s + r.gross_sales, 0) / last30.length : 8000;
    const runRateAmer = avgDailySpend > 0 ? avgDailyRev / avgDailySpend : 5;
    const ncShareFromData = last30.length > 0
      ? (last30.reduce((s, r) => s + r.nc_revenue, 0) / Math.max(last30.reduce((s, r) => s + r.gross_sales, 0), 1)) * 100
      : 60;

    const inputs: Record<string, { spend: number; amer: number; lift: number; ncShare: number; cod: number; }> = {};

    // Scenario multiplier
    const spendMult = scenario === 'conservative' ? 0.9 : scenario === 'stretch' ? 1.15 : 1;
    const amerAdj = scenario === 'conservative' ? -0.2 : scenario === 'stretch' ? 0.2 : 0;

    for (let m = 0; m < 12; m++) {
      const key = `${forecastYear}-${String(m + 1).padStart(2, '0')}`;
      const mStart = getMonthStart(forecastYear, m);
      const days = getDaysInMonth(forecastYear, m);
      const monthLabel = MONTHS[m];

      // Check if we have saved scenario data
      const savedRow = savedScenarios[scenario].find(s => s.month_start === mStart);

      // Check if we have actuals
      const actual = monthlyActuals[key];

      if (savedRow) {
        inputs[key] = {
          spend: savedRow.planned_spend,
          amer: savedRow.target_amer,
          lift: savedRow.marketing_lift_pct,
          ncShare: savedRow.nc_share_pct,
          cod: savedRow.cod_pct,
        };
      } else if (actual && actual.days >= 25) {
        // Past complete month — pre-fill with actuals
        inputs[key] = {
          spend: Math.round(actual.spend),
          amer: actual.spend > 0 ? Math.round((actual.rev / actual.spend) * 100) / 100 : runRateAmer,
          lift: (seasonality[monthLabel] || 5),
          ncShare: Math.round(ncShareFromData * 10) / 10,
          cod: codPct,
        };
      } else {
        // Future month — use run-rate * seasonality * scenario multiplier
        const baseMonthlySpend = avgDailySpend * days * spendMult;
        inputs[key] = {
          spend: Math.round(baseMonthlySpend),
          amer: Math.round((runRateAmer + amerAdj) * 100) / 100,
          lift: (seasonality[monthLabel] || 5),
          ncShare: Math.round(ncShareFromData * 10) / 10,
          cod: codPct,
        };
      }
    }

    setMonthInputs(inputs);
  }, [dailyData, scenario, forecastYear, savedScenarios]);

  // ─── Compute forecast from inputs ─────────────────────────────
  const forecast = useMemo<MonthForecast[]>(() => {
    const todayStr = now.toISOString().substring(0, 7);
    return Array.from({ length: 12 }, (_, m) => {
      const key = `${forecastYear}-${String(m + 1).padStart(2, '0')}`;
      const inp = monthInputs[key];
      if (!inp) return null;

      const days = getDaysInMonth(forecastYear, m);
      const isPast = key < todayStr;
      const isCurrent = key === todayStr;

      // Forecast calculations
      const totalRev = inp.spend * inp.amer;
      const ncRev = totalRev * (inp.ncShare / 100);
      const rcRev = totalRev - ncRev;
      const codFraction = inp.cod / 100;
      const ncCM = ncRev * (1 - codFraction) - inp.spend;
      const returningCM = rcRev * (1 - codFraction);
      const totalCM = ncCM + returningCM;
      const totalOrderRev = totalRev;

      // Actuals
      const actual = monthlyActuals[key];
      const actualSpend = actual ? actual.spend : null;
      const actualRev = actual ? actual.rev : null;
      const actualCM = actual && brands.find(b => b.id === selectedBrand)
        ? actual.rev * (1 - codFraction) - actual.spend
        : null;
      const actualAmer = actual && actual.spend > 0 ? actual.rev / actual.spend : null;

      return {
        month: key,
        label: MONTHS[m],
        isPast: isPast || false,
        daysInMonth: days,
        mktgLift: inp.lift,
        spend: inp.spend,
        targetAmer: inp.amer,
        ncSharePct: inp.ncShare,
        codPct: inp.cod,
        totalRev,
        ncRev,
        rcRev,
        ncCM,
        returningCM,
        totalCM,
        totalOrderRev,
        actualSpend,
        actualRev,
        actualCM,
        actualAmer,
      };
    }).filter(Boolean) as MonthForecast[];
  }, [monthInputs, forecastYear, monthlyActuals, brands, selectedBrand]);

  // ─── Totals ───────────────────────────────────────────────────
  const totals = useMemo(() => {
    let spend = 0, rev = 0, ncRev = 0, rcRev = 0, cm = 0;
    forecast.forEach(f => {
      spend += f.spend;
      rev += f.totalRev;
      ncRev += f.ncRev;
      rcRev += f.rcRev;
      cm += f.totalCM;
    });
    return { spend, rev, ncRev, rcRev, cm, amer: spend > 0 ? rev / spend : 0 };
  }, [forecast]);

  // ─── Daily breakdown for expanded month ───────────────────────
  const dailyBreakdown = useMemo<DailyTarget[]>(() => {
    if (!expandedMonth) return [];
    const mf = forecast.find(f => f.month === expandedMonth);
    if (!mf) return [];

    const [y, m] = expandedMonth.split('-').map(Number);
    const days = getDaysInMonth(y, m - 1);
    const monthlyRev = mf.totalRev;
    const monthlySpend = mf.spend;
    const codFrac = mf.codPct / 100;

    // Total weight for all days in month
    let totalWeight = 0;
    for (let d = 1; d <= days; d++) {
      const dt = new Date(y, m - 1, d);
      totalWeight += dowWeights[dt.getDay()];
    }

    const targets: DailyTarget[] = [];
    for (let d = 1; d <= days; d++) {
      const dt = new Date(y, m - 1, d);
      const dow = dt.getDay();
      const weight = dowWeights[dow];
      const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

      const forecastRev = (weight / totalWeight) * monthlyRev;
      const forecastSpend = (weight / totalWeight) * monthlySpend;
      const forecastCM = forecastRev * (1 - codFrac) - forecastSpend;

      // Find actual
      const actual = dailyData.find(r => r.date === dateStr);
      const actualRev = actual ? actual.gross_sales : null;
      const actualSpend = actual ? actual.meta_spend + actual.google_spend + actual.other_spend : null;
      const actualCM = actual ? actual.gross_sales * (1 - codFrac) - (actual.meta_spend + actual.google_spend + actual.other_spend) : null;

      targets.push({
        date: dateStr,
        dow: DOW_NAMES[dow],
        dowWeight: weight,
        forecastRev,
        forecastSpend,
        forecastCM,
        actualRev,
        actualSpend,
        actualCM,
        revDiffPct: actualRev !== null && forecastRev > 0 ? ((actualRev - forecastRev) / forecastRev) * 100 : null,
        cmDiffPct: actualCM !== null && Math.abs(forecastCM) > 0 ? ((actualCM - forecastCM) / Math.abs(forecastCM)) * 100 : null,
      });
    }
    return targets;
  }, [expandedMonth, forecast, dowWeights, dailyData]);

  // ─── Save scenarios to Supabase ───────────────────────────────
  const handleSave = useCallback(async () => {
    if (!selectedBrand) return;
    setSaving(true);

    const rows = Object.entries(monthInputs).map(([key, inp]) => ({
      brand_id: selectedBrand,
      scenario,
      month_start: key + '-01',
      planned_spend: inp.spend,
      target_amer: inp.amer,
      marketing_lift_pct: inp.lift,
      nc_share_pct: inp.ncShare,
      cod_pct: inp.cod,
      updated_at: new Date().toISOString(),
    }));

    // Upsert all months for this scenario
    const { error } = await supabase
      .from('forecast_scenarios')
      .upsert(rows, { onConflict: 'brand_id,scenario,month_start' });

    setSaving(false);
    if (!error) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  }, [selectedBrand, scenario, monthInputs]);

  // ─── Update a single month input ─────────────────────────────
  const updateMonthInput = (month: string, field: string, value: number) => {
    setMonthInputs(prev => ({
      ...prev,
      [month]: { ...prev[month], [field]: value },
    }));
  };

  // ─── Chart data ───────────────────────────────────────────────
  const chartData = useMemo(() => {
    return forecast.map(f => ({
      month: f.label,
      ncCM: Math.round(f.ncCM),
      totalCM: Math.round(f.totalCM),
      spend: Math.round(f.spend),
      amer: f.targetAmer,
      revenue: Math.round(f.totalRev),
      actualRev: f.actualRev ? Math.round(f.actualRev) : undefined,
      actualCM: f.actualCM ? Math.round(f.actualCM) : undefined,
    }));
  }, [forecast]);

  // ─── Diff color helper ────────────────────────────────────────
  const diffColor = (pct: number | null) => {
    if (pct === null) return '';
    if (pct >= 5) return '#10B981';
    if (pct >= 0) return '#C8B89A';
    if (pct >= -5) return '#f59e0b';
    return '#ef4444';
  };

  // ─── Styles ───────────────────────────────────────────────────
  const gold = '#C8B89A';
  const green = '#10B981';
  const red = '#ef4444';
  const bg = '#0A0A0A';
  const card = '#111111';
  const border = '#222222';
  const muted = '#888888';

  if (loading) {
    return (
      <Navbar>
        <div style={{ background: bg, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Loader className="animate-spin" size={32} style={{ color: gold }} />
        </div>
      </Navbar>
    );
  }

  return (
    <Navbar>
      <div style={{ background: bg, minHeight: '100vh', padding: '24px 32px', color: '#ffffff' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, color: '#fff' }}>
              12-Month Marketing Forecast
            </h1>
            <p style={{ fontSize: 13, color: muted, margin: '4px 0 0' }}>
              Plan spend, aMER targets, and contribution margin across 3 scenarios
            </p>
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            {/* Year selector */}
            <select
              value={forecastYear}
              onChange={e => setForecastYear(Number(e.target.value))}
              style={{
                background: card, border: `1px solid ${border}`, color: '#fff',
                padding: '6px 12px', borderRadius: 6, fontSize: 13,
              }}
            >
              <option value={2025}>2025</option>
              <option value={2026}>2026</option>
              <option value={2027}>2027</option>
            </select>

            {/* Brand selector (admin only) */}
            {brands.length > 1 && (
              <select
                value={selectedBrand}
                onChange={e => setSelectedBrand(e.target.value)}
                style={{
                  background: card, border: `1px solid ${border}`, color: '#fff',
                  padding: '6px 12px', borderRadius: 6, fontSize: 13,
                }}
              >
                {brands.map(b => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            )}

            {/* Save button */}
            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                background: gold, color: '#0A0A0A', padding: '8px 16px',
                borderRadius: 6, border: 'none', fontSize: 13, fontWeight: 600,
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
                opacity: saving ? 0.6 : 1,
              }}
            >
              {saved ? <Check size={14} /> : <Save size={14} />}
              {saved ? 'Saved' : saving ? 'Saving...' : 'Save Forecast'}
            </button>
          </div>
        </div>

        {/* Scenario Tabs */}
        <div style={{ display: 'flex', gap: 0, marginBottom: 20 }}>
          {(['conservative', 'base', 'stretch'] as Scenario[]).map(s => (
            <button
              key={s}
              onClick={() => setScenario(s)}
              style={{
                padding: '10px 24px',
                background: scenario === s ? card : 'transparent',
                color: scenario === s ? SCENARIO_COLORS[s] : muted,
                border: scenario === s ? `1px solid ${SCENARIO_COLORS[s]}` : `1px solid ${border}`,
                borderRadius: s === 'conservative' ? '8px 0 0 8px' : s === 'stretch' ? '0 8px 8px 0' : '0',
                fontSize: 13, fontWeight: scenario === s ? 700 : 400,
                cursor: 'pointer',
                borderLeft: s !== 'conservative' ? 'none' : undefined,
              }}
            >
              {SCENARIO_LABELS[s]}
            </button>
          ))}
        </div>

        {/* KPI Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 20 }}>
          {[
            { label: 'Annual Revenue', value: fmt(totals.rev), icon: DollarSign },
            { label: 'Annual Spend', value: fmt(totals.spend), icon: TrendingUp },
            { label: 'Blended aMER', value: fmtNum(totals.amer), icon: Target },
            { label: 'Annual CM', value: fmt(totals.cm), icon: BarChart3, color: totals.cm > 0 ? green : red },
            { label: 'CM %', value: totals.rev > 0 ? fmtPct(totals.cm / totals.rev * 100) : '—', icon: TrendingUp },
          ].map((kpi, i) => (
            <div key={i} style={{
              background: card, border: `1px solid ${border}`, borderRadius: 10,
              padding: '16px 18px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <kpi.icon size={14} style={{ color: muted }} />
                <span style={{ fontSize: 11, color: muted, textTransform: 'uppercase', letterSpacing: 0.5 }}>{kpi.label}</span>
              </div>
              <div style={{ fontSize: 22, fontWeight: 700, color: kpi.color || '#fff' }}>
                {kpi.value}
              </div>
            </div>
          ))}
        </div>

        {/* Charts Toggle */}
        <button
          onClick={() => setShowCharts(!showCharts)}
          style={{
            background: 'transparent', border: 'none', color: gold, fontSize: 12,
            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 12,
            padding: 0,
          }}
        >
          {showCharts ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          {showCharts ? 'Hide Charts' : 'Show Charts'}
        </button>

        {/* Charts */}
        {showCharts && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
            {/* Revenue + CM Chart */}
            <div style={{ background: card, border: `1px solid ${border}`, borderRadius: 10, padding: 16 }}>
              <div style={{ fontSize: 12, color: muted, marginBottom: 8, fontWeight: 600 }}>Revenue & CM Forecast</div>
              <ResponsiveContainer width="100%" height={220}>
                <ComposedChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={border} />
                  <XAxis dataKey="month" tick={{ fill: muted, fontSize: 10 }} />
                  <YAxis yAxisId="left" tick={{ fill: muted, fontSize: 10 }} tickFormatter={(v: any) => fmt(Number(v))} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fill: muted, fontSize: 10 }} />
                  <Tooltip
                    contentStyle={{ background: '#1a1a1a', border: `1px solid ${border}`, borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: '#fff' }}
                    formatter={(value: any, name: any) => [fmt(Number(value)), String(name)]}
                  />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Bar yAxisId="left" dataKey="revenue" name="Forecast Rev" fill={gold} opacity={0.3} />
                  <Bar yAxisId="left" dataKey="actualRev" name="Actual Rev" fill={gold} />
                  <Line yAxisId="right" dataKey="amer" name="aMER" stroke={green} strokeWidth={2} dot={{ r: 3 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {/* CM Chart */}
            <div style={{ background: card, border: `1px solid ${border}`, borderRadius: 10, padding: 16 }}>
              <div style={{ fontSize: 12, color: muted, marginBottom: 8, fontWeight: 600 }}>Contribution Margin by Month</div>
              <ResponsiveContainer width="100%" height={220}>
                <ComposedChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={border} />
                  <XAxis dataKey="month" tick={{ fill: muted, fontSize: 10 }} />
                  <YAxis tick={{ fill: muted, fontSize: 10 }} tickFormatter={(v: any) => fmt(Number(v))} />
                  <Tooltip
                    contentStyle={{ background: '#1a1a1a', border: `1px solid ${border}`, borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: '#fff' }}
                    formatter={(value: any, name: any) => [fmt(Number(value)), String(name)]}
                  />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Bar dataKey="ncCM" name="NC CM" fill={SCENARIO_COLORS[scenario]} opacity={0.6} />
                  <Bar dataKey="totalCM" name="Total CM" fill={SCENARIO_COLORS[scenario]} />
                  <Bar dataKey="actualCM" name="Actual CM" fill={green} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Monthly Forecast Table */}
        <div style={{ background: card, border: `1px solid ${border}`, borderRadius: 10, overflow: 'hidden', marginBottom: 24 }}>
          <div style={{ padding: '12px 16px', borderBottom: `1px solid ${border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>
              {SCENARIO_LABELS[scenario]} Forecast — {forecastYear}
            </span>
            <span style={{ fontSize: 11, color: muted }}>Click a month row to expand daily pacing</span>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${border}` }}>
                  {['Month', 'Mktg Lift', 'Spend', 'aMER', 'NC Share', 'Total Rev', 'NC Rev', 'RC Rev', 'COD%', 'NC CM', 'Ret CM', 'Total CM'].map(h => (
                    <th key={h} style={{ padding: '10px 8px', textAlign: 'right', color: muted, fontWeight: 600, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {forecast.map((f) => {
                  const isExpanded = expandedMonth === f.month;
                  const hasActuals = f.actualRev !== null;
                  const currentMonth = now.toISOString().substring(0, 7);
                  const isCurrent = f.month === currentMonth;

                  return (
                    <>
                      <tr
                        key={f.month}
                        onClick={() => setExpandedMonth(isExpanded ? null : f.month)}
                        style={{
                          borderBottom: `1px solid ${border}`,
                          cursor: 'pointer',
                          background: isCurrent ? 'rgba(200,184,154,0.06)' : isExpanded ? 'rgba(200,184,154,0.03)' : 'transparent',
                        }}
                      >
                        <td style={{ padding: '10px 8px', fontWeight: 600, color: isCurrent ? gold : '#fff', whiteSpace: 'nowrap' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                            {f.label}
                            {hasActuals && <span style={{ fontSize: 9, color: green, marginLeft: 4 }}>ACTUAL</span>}
                            {isCurrent && <span style={{ fontSize: 9, color: gold, marginLeft: 4 }}>NOW</span>}
                          </div>
                        </td>
                        <td style={{ padding: '10px 8px', textAlign: 'right', color: muted }}>{fmtPct(f.mktgLift)}</td>
                        <td style={{ padding: '10px 8px', textAlign: 'right' }}>
                          {hasActuals && f.actualSpend !== null ? (
                            <div>
                              <span style={{ color: '#fff' }}>{fmt(f.actualSpend)}</span>
                              <div style={{ fontSize: 9, color: muted }}>{fmt(f.spend)} plan</div>
                            </div>
                          ) : fmt(f.spend)}
                        </td>
                        <td style={{ padding: '10px 8px', textAlign: 'right' }}>
                          {hasActuals && f.actualAmer !== null ? (
                            <div>
                              <span style={{ color: f.actualAmer >= f.targetAmer ? green : red }}>{fmtNum(f.actualAmer)}</span>
                              <div style={{ fontSize: 9, color: muted }}>{fmtNum(f.targetAmer)} target</div>
                            </div>
                          ) : fmtNum(f.targetAmer)}
                        </td>
                        <td style={{ padding: '10px 8px', textAlign: 'right', color: muted }}>{fmtPct(f.ncSharePct)}</td>
                        <td style={{ padding: '10px 8px', textAlign: 'right' }}>
                          {hasActuals && f.actualRev !== null ? (
                            <div>
                              <span style={{ color: '#fff' }}>{fmt(f.actualRev)}</span>
                              <div style={{ fontSize: 9, color: f.actualRev >= f.totalRev ? green : red }}>
                                {f.totalRev > 0 ? (((f.actualRev - f.totalRev) / f.totalRev) * 100).toFixed(1) + '%' : '—'}
                              </div>
                            </div>
                          ) : fmt(f.totalRev)}
                        </td>
                        <td style={{ padding: '10px 8px', textAlign: 'right', color: '#fff' }}>{fmt(f.ncRev)}</td>
                        <td style={{ padding: '10px 8px', textAlign: 'right', color: '#fff' }}>{fmt(f.rcRev)}</td>
                        <td style={{ padding: '10px 8px', textAlign: 'right', color: muted }}>{fmtPct(f.codPct)}</td>
                        <td style={{ padding: '10px 8px', textAlign: 'right', color: f.ncCM >= 0 ? green : red, fontWeight: 600 }}>
                          {fmt(f.ncCM)}
                        </td>
                        <td style={{ padding: '10px 8px', textAlign: 'right', color: f.returningCM >= 0 ? green : red }}>
                          {fmt(f.returningCM)}
                        </td>
                        <td style={{ padding: '10px 8px', textAlign: 'right', fontWeight: 700, color: f.totalCM >= 0 ? green : red }}>
                          {hasActuals && f.actualCM !== null ? (
                            <div>
                              <span>{fmt(f.actualCM)}</span>
                              <div style={{ fontSize: 9, color: muted }}>{fmt(f.totalCM)} plan</div>
                            </div>
                          ) : fmt(f.totalCM)}
                        </td>
                      </tr>

                      {/* Daily Pacing Expanded Row */}
                      {isExpanded && (
                        <tr key={f.month + '-detail'}>
                          <td colSpan={12} style={{ padding: 0 }}>
                            <div style={{ background: 'rgba(17,17,17,0.8)', borderTop: `1px solid ${border}`, borderBottom: `1px solid ${border}` }}>
                              <div style={{ padding: '10px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ fontSize: 12, fontWeight: 600, color: gold }}>
                                  Daily Pacing — {f.label} {forecastYear}
                                </span>
                                {dailyBreakdown.length > 0 && (() => {
                                  const completed = dailyBreakdown.filter(d => d.actualRev !== null);
                                  const mtdActualRev = completed.reduce((s, d) => s + (d.actualRev || 0), 0);
                                  const mtdForecastRev = completed.reduce((s, d) => s + d.forecastRev, 0);
                                  const remaining = dailyBreakdown.filter(d => d.actualRev === null);
                                  const neededDaily = remaining.length > 0 ? (f.totalRev - mtdActualRev) / remaining.length : 0;
                                  return (
                                    <div style={{ display: 'flex', gap: 16, fontSize: 11 }}>
                                      <span style={{ color: muted }}>
                                        MTD: <span style={{ color: mtdActualRev >= mtdForecastRev ? green : red, fontWeight: 600 }}>{fmt(mtdActualRev)}</span> / {fmt(mtdForecastRev)} target
                                      </span>
                                      {remaining.length > 0 && (
                                        <span style={{ color: muted }}>
                                          Need <span style={{ color: '#fff', fontWeight: 600 }}>{fmt(neededDaily)}/day</span> for {remaining.length} remaining days
                                        </span>
                                      )}
                                    </div>
                                  );
                                })()}
                              </div>
                              <div style={{ maxHeight: 400, overflowY: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                                  <thead>
                                    <tr style={{ borderBottom: `1px solid ${border}` }}>
                                      {['Date', 'DOW', 'Weight', 'Fcst Rev', 'Actual Rev', '% Diff', 'Fcst Spend', 'Actual Spend', 'Fcst CM', 'Actual CM', 'CM % Diff'].map(h => (
                                        <th key={h} style={{ padding: '6px 6px', textAlign: 'right', color: muted, fontWeight: 600, fontSize: 9, textTransform: 'uppercase' }}>{h}</th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {dailyBreakdown.map(d => (
                                      <tr key={d.date} style={{ borderBottom: `1px solid rgba(34,34,34,0.5)` }}>
                                        <td style={{ padding: '5px 6px', textAlign: 'right', color: muted, fontSize: 10 }}>{d.date.substring(5)}</td>
                                        <td style={{ padding: '5px 6px', textAlign: 'right', color: muted }}>{d.dow}</td>
                                        <td style={{ padding: '5px 6px', textAlign: 'right', color: muted }}>{d.dowWeight.toFixed(2)}×</td>
                                        <td style={{ padding: '5px 6px', textAlign: 'right', color: '#fff' }}>{fmt(d.forecastRev)}</td>
                                        <td style={{ padding: '5px 6px', textAlign: 'right', color: d.actualRev !== null ? '#fff' : muted }}>
                                          {d.actualRev !== null ? fmt(d.actualRev) : '—'}
                                        </td>
                                        <td style={{ padding: '5px 6px', textAlign: 'right', color: diffColor(d.revDiffPct), fontWeight: 600 }}>
                                          {d.revDiffPct !== null ? (d.revDiffPct >= 0 ? '+' : '') + d.revDiffPct.toFixed(1) + '%' : '—'}
                                        </td>
                                        <td style={{ padding: '5px 6px', textAlign: 'right', color: '#fff' }}>{fmt(d.forecastSpend)}</td>
                                        <td style={{ padding: '5px 6px', textAlign: 'right', color: d.actualSpend !== null ? '#fff' : muted }}>
                                          {d.actualSpend !== null ? fmt(d.actualSpend) : '—'}
                                        </td>
                                        <td style={{ padding: '5px 6px', textAlign: 'right', color: d.forecastCM >= 0 ? green : red }}>{fmt(d.forecastCM)}</td>
                                        <td style={{ padding: '5px 6px', textAlign: 'right', color: d.actualCM !== null ? (d.actualCM >= 0 ? green : red) : muted }}>
                                          {d.actualCM !== null ? fmt(d.actualCM) : '—'}
                                        </td>
                                        <td style={{ padding: '5px 6px', textAlign: 'right', color: diffColor(d.cmDiffPct), fontWeight: 600 }}>
                                          {d.cmDiffPct !== null ? (d.cmDiffPct >= 0 ? '+' : '') + d.cmDiffPct.toFixed(1) + '%' : '—'}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}

                {/* Totals row */}
                <tr style={{ background: 'rgba(200,184,154,0.06)', borderTop: `2px solid ${gold}` }}>
                  <td style={{ padding: '10px 8px', fontWeight: 700, color: gold }}>TOTAL</td>
                  <td style={{ padding: '10px 8px', textAlign: 'right', color: muted }}>—</td>
                  <td style={{ padding: '10px 8px', textAlign: 'right', fontWeight: 700, color: '#fff' }}>{fmt(totals.spend)}</td>
                  <td style={{ padding: '10px 8px', textAlign: 'right', fontWeight: 700, color: '#fff' }}>{fmtNum(totals.amer)}</td>
                  <td style={{ padding: '10px 8px', textAlign: 'right', color: muted }}>—</td>
                  <td style={{ padding: '10px 8px', textAlign: 'right', fontWeight: 700, color: '#fff' }}>{fmt(totals.rev)}</td>
                  <td style={{ padding: '10px 8px', textAlign: 'right', fontWeight: 700, color: '#fff' }}>{fmt(totals.ncRev)}</td>
                  <td style={{ padding: '10px 8px', textAlign: 'right', fontWeight: 700, color: '#fff' }}>{fmt(totals.rcRev)}</td>
                  <td style={{ padding: '10px 8px', textAlign: 'right', color: muted }}>—</td>
                  <td style={{ padding: '10px 8px', textAlign: 'right', fontWeight: 700, color: green }}>{fmt(forecast.reduce((s, f) => s + f.ncCM, 0))}</td>
                  <td style={{ padding: '10px 8px', textAlign: 'right', fontWeight: 700, color: green }}>{fmt(forecast.reduce((s, f) => s + f.returningCM, 0))}</td>
                  <td style={{ padding: '10px 8px', textAlign: 'right', fontWeight: 700, color: totals.cm >= 0 ? green : red, fontSize: 14 }}>{fmt(totals.cm)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Seasonality & DOW reference */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {/* Monthly seasonality */}
          <div style={{ background: card, border: `1px solid ${border}`, borderRadius: 10, padding: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#fff', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Calendar size={14} style={{ color: gold }} />
              Monthly Seasonality Weights
            </div>
            <div style={{ fontSize: 10, color: muted, marginBottom: 12 }}>
              Marketing lift % used to adjust spend across the year. Edit in the forecast table above.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8 }}>
              {MONTHS.map(m => (
                <div key={m} style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 10, color: muted, marginBottom: 2 }}>{m}</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>{seasonality[m]}%</div>
                </div>
              ))}
            </div>
          </div>

          {/* DOW weights */}
          <div style={{ background: card, border: `1px solid ${border}`, borderRadius: 10, padding: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#fff', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
              <BarChart3 size={14} style={{ color: gold }} />
              Day-of-Week Pacing Weights
            </div>
            <div style={{ fontSize: 10, color: muted, marginBottom: 12 }}>
              Computed from historical revenue patterns. Used to distribute monthly targets across days.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8 }}>
              {DOW_NAMES.map((d, i) => (
                <div key={d} style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 10, color: muted, marginBottom: 2 }}>{d}</div>
                  <div style={{
                    fontSize: 14, fontWeight: 600,
                    color: dowWeights[i] >= 1 ? green : dowWeights[i] >= 0.95 ? '#fff' : red,
                  }}>
                    {dowWeights[i].toFixed(2)}×
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Info callout */}
        <div style={{
          marginTop: 20, padding: '12px 16px', background: 'rgba(200,184,154,0.06)',
          border: `1px solid rgba(200,184,154,0.15)`, borderRadius: 8,
          display: 'flex', gap: 8, alignItems: 'flex-start',
        }}>
          <Info size={14} style={{ color: gold, marginTop: 2, flexShrink: 0 }} />
          <div style={{ fontSize: 11, color: muted, lineHeight: 1.5 }}>
            <strong style={{ color: gold }}>How it works:</strong> Set monthly spend and aMER targets per scenario.
            Revenue = Spend × aMER. NC Revenue = Revenue × NC Share %. Contribution Margin = Revenue × (1 − COD%) − Spend.
            Daily targets are weighted by day-of-week patterns from your historical data.
            Past months auto-fill with actuals from your daily P&L. Click any month to see the daily forecast vs actuals breakdown.
          </div>
        </div>
      </div>
    </Navbar>
  );
}
