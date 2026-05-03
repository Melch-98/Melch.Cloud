'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Loader,
  TrendingUp,
  DollarSign,
  Info,
  RefreshCw,
  Settings,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import Navbar from '@/components/Navbar';
import { createClient } from '@/lib/supabase';

// ─── Types ──────────────────────────────────────────────────────

interface Brand {
  id: string;
  name: string;
  slug: string;
  shopify_gross_margin_pct: number;
}

interface DailyPoint {
  date: string;
  spend: number;
  rev: number;
  daysBack: number;
}

interface HillFit {
  V: number;
  K: number;
  h: number;
  r2: number;
}

interface GoalDef {
  key: string;
  label: string;
  desc: string;
}

// ─── Hill Model Math ────────────────────────────────────────────

function hillRev(s: number, V: number, K: number, h: number): number {
  if (s <= 0) return 0;
  return (V * Math.pow(s, h)) / (Math.pow(K, h) + Math.pow(s, h));
}

function hillMargRoas(s: number, V: number, K: number, h: number): number {
  if (s <= 0) return Infinity;
  const sh = Math.pow(s, h), Kh = Math.pow(K, h);
  return (V * h * Kh * Math.pow(s, h - 1)) / Math.pow(Kh + sh, 2);
}

// ─── Hill Curve Fitting (two-pass grid search) ──────────────────

function fitHillCurve(points: DailyPoint[], halfLifeDays: number): HillFit {
  if (!points.length) return { V: 1, K: 1, h: 1, r2: 0 };

  const maxS = Math.max(...points.map(p => p.spend));
  const maxR = Math.max(...points.map(p => p.rev));
  if (maxS === 0 || maxR === 0) return { V: 1, K: 1, h: 1, r2: 0 };

  const weights = points.map(p => Math.pow(0.5, p.daysBack / halfLifeDays));

  function sse(V: number, K: number, h: number) {
    let s = 0, tw = 0;
    for (let i = 0; i < points.length; i++) {
      const pred = hillRev(points[i].spend, V, K, h);
      const err = points[i].rev - pred;
      s += weights[i] * err * err;
      tw += weights[i];
    }
    return s / tw;
  }

  // Coarse grid
  let bestV = 1, bestK = 1, bestH = 1, bestSSE = Infinity;
  for (let vi = 1; vi <= 16; vi++) {
    const V = maxR * 0.5 * vi;
    for (let ki = 1; ki <= 16; ki++) {
      const K = maxS * 0.1 * ki;
      for (let hi = 1; hi <= 8; hi++) {
        const h = 0.3 + hi * 0.3;
        const e = sse(V, K, h);
        if (e < bestSSE) { bestSSE = e; bestV = V; bestK = K; bestH = h; }
      }
    }
  }

  // Fine grid around best
  const fV = bestV, fK = bestK, fH = bestH;
  const vStep = maxR * 0.5 * 0.8;
  const kStep = maxS * 0.1 * 0.8;
  for (let vi = -5; vi <= 5; vi++) {
    const V = Math.max(1, fV + vi * vStep / 5);
    for (let ki = -5; ki <= 5; ki++) {
      const K = Math.max(1, fK + ki * kStep / 5);
      for (let hi = -3; hi <= 3; hi++) {
        const h = Math.max(0.3, fH + hi * 0.1);
        const e = sse(V, K, h);
        if (e < bestSSE) { bestSSE = e; bestV = V; bestK = K; bestH = h; }
      }
    }
  }

  // R²
  let ssTot = 0, ssRes = 0;
  const wSum = weights.reduce((a, b) => a + b, 0);
  const meanR = points.reduce((s, p, i) => s + weights[i] * p.rev, 0) / wSum;
  for (let i = 0; i < points.length; i++) {
    const pred = hillRev(points[i].spend, bestV, bestK, bestH);
    ssRes += weights[i] * (points[i].rev - pred) ** 2;
    ssTot += weights[i] * (points[i].rev - meanR) ** 2;
  }
  const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot;

  return { V: bestV, K: bestK, h: bestH, r2 };
}

// ─── Optimal Spend Finder ───────────────────────────────────────

const GOALS: GoalDef[] = [
  { key: 'maxCM', label: 'Max CM Today', desc: 'Maximize contribution margin today' },
  { key: 'max3m', label: 'Max 3m CM', desc: 'Max CM with 3-month LTV' },
  { key: 'max6m', label: 'Max 6m CM', desc: 'Max CM with 6-month LTV' },
  { key: 'max12m', label: 'Max 12m CM', desc: 'Max CM with 12-month LTV' },
  { key: 'maxRev', label: 'Max Revenue', desc: 'Maximize total revenue' },
  { key: 'maxNCRev', label: 'Max NC Revenue', desc: 'Max new customer revenue' },
  { key: 'targetRoas', label: 'Target ROAS', desc: 'Spend to target ROAS' },
];

interface Params {
  vc: number; nc: number; l3: number; l6: number; l12: number;
  hl: number; lam: number; tr: number; curSpend: number;
}

function findOptimalSpend(
  V: number, K: number, h: number,
  goal: string, params: Params
): number {
  const margin = 1 - params.vc / 100;
  const ncPct = params.nc / 100;
  const maxSearch = V * 2;
  const steps = 500;

  function cmAt(s: number, ltvMult: number) {
    return hillRev(s, V, K, h) * margin * ltvMult - s;
  }

  function bruteMax(fn: (s: number) => number) {
    let bestS = 0, bestVal = -Infinity;
    for (let i = 1; i <= steps; i++) {
      const s = maxSearch * i / steps;
      const v = fn(s);
      if (v > bestVal) { bestVal = v; bestS = s; }
    }
    return bestS;
  }

  switch (goal) {
    case 'maxCM': return bruteMax(s => cmAt(s, 1));
    case 'max3m': return bruteMax(s => cmAt(s, params.l3));
    case 'max6m': return bruteMax(s => cmAt(s, params.l6));
    case 'max12m': return bruteMax(s => cmAt(s, params.l12));
    case 'maxRev': return bruteMax(s => hillRev(s, V, K, h));
    case 'maxNCRev': return bruteMax(s => hillRev(s, V, K, h) * ncPct);
    case 'targetRoas': {
      for (let i = 1; i <= steps; i++) {
        const s = maxSearch * i / steps;
        const rev = hillRev(s, V, K, h);
        if (s > 0 && rev / s <= params.tr) return s;
      }
      return maxSearch;
    }
    default: return bruteMax(s => cmAt(s, 1));
  }
}

// ─── Formatting ─────────────────────────────────────────────────

const fmt = (n: number, d = 0) =>
  n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

// ─── Component ──────────────────────────────────────────────────

export default function EfficiencyPage() {
  const router = useRouter();
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [selectedBrand, setSelectedBrand] = useState<string>('');
  const [dailyPoints, setDailyPoints] = useState<DailyPoint[]>([]);
  const [selectedGoal, setSelectedGoal] = useState('maxCM');
  const [showSettings, setShowSettings] = useState(false);

  // Tunable params
  const [params, setParams] = useState<Params>({
    vc: 35, nc: 60, l3: 1.4, l6: 1.8, l12: 2.5,
    hl: 60, lam: 0, tr: 1.2, curSpend: 1200,
  });

  const updateParam = (key: keyof Params, val: number) =>
    setParams(prev => ({ ...prev, [key]: val }));

  // Auth + brands
  useEffect(() => {
    async function init() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push('/login'); return; }

      const { data: profile } = await supabase
        .from('users_profile')
        .select('role, brand_id')
        .eq('id', session.user.id)
        .single();

      if (profile?.brand_id) setSelectedBrand(profile.brand_id);

      const { data: brandList } = await supabase
        .from('brands')
        .select('id, name, slug, shopify_gross_margin_pct');

      if (brandList) {
        setBrands(brandList);
        // Set VC% from brand's gross margin
        if (profile?.brand_id) {
          const brand = brandList.find(b => b.id === profile.brand_id);
          if (brand) updateParam('vc', 100 - brand.shopify_gross_margin_pct);
        }
      }
    }
    init();
  }, []);

  // Load daily data
  useEffect(() => {
    if (!selectedBrand) return;
    async function fetchData() {
      setLoading(true);

      // Update VC from brand
      const brand = brands.find(b => b.id === selectedBrand);
      if (brand) updateParam('vc', 100 - brand.shopify_gross_margin_pct);

      const { data } = await supabase
        .from('daily_pnl')
        .select('date, nc_revenue, rc_revenue, gross_sales, meta_spend')
        .eq('brand_id', selectedBrand)
        .order('date', { ascending: true });

      if (data) {
        const now = new Date();
        const points: DailyPoint[] = data.map(row => {
          const d = new Date(row.date);
          const spend = Number(row.meta_spend || 0);
          const rev = Number(row.gross_sales || 0);
          const daysBack = Math.floor((now.getTime() - d.getTime()) / 86400000);
          return { date: row.date, spend, rev, daysBack };
        }).filter(p => p.spend > 0 && p.rev > 0);

        setDailyPoints(points);

        // Set current spend to recent average
        if (points.length >= 7) {
          const recent = points.slice(-7);
          const avgSpend = recent.reduce((s, p) => s + p.spend, 0) / recent.length;
          updateParam('curSpend', Math.round(avgSpend));
        }
      }
      setLoading(false);
    }
    fetchData();
  }, [selectedBrand]);

  // Compute everything
  const analysis = useMemo(() => {
    if (!dailyPoints.length) return null;

    // Apply adstock
    const adjustedPoints = params.lam > 0
      ? dailyPoints.map(p => ({ ...p, spend: p.spend / (1 - params.lam) }))
      : dailyPoints;

    const fit = fitHillCurve(adjustedPoints, params.hl);
    const { V, K, h, r2 } = fit;
    const margin = 1 - params.vc / 100;

    const optSpend = findOptimalSpend(V, K, h, selectedGoal, params);
    const optRev = hillRev(optSpend, V, K, h);
    const curRev = hillRev(params.curSpend, V, K, h);
    const curROAS = params.curSpend > 0 ? curRev / params.curSpend : 0;
    const optROAS = optSpend > 0 ? optRev / optSpend : 0;
    const curCM = curRev * margin - params.curSpend;
    const optCM = optRev * margin - optSpend;
    const curMROAS = hillMargRoas(params.curSpend, V, K, h);
    const spendDelta = params.curSpend > 0 ? ((optSpend / params.curSpend) - 1) * 100 : 0;

    // Curve data for display
    const maxS = Math.max(...adjustedPoints.map(d => d.spend), optSpend) * 1.3;
    const curveData = Array.from({ length: 200 }, (_, i) => {
      const s = maxS * (i + 1) / 200;
      return { spend: s, rev: hillRev(s, V, K, h), mroas: hillMargRoas(s, V, K, h) };
    });

    // Spend ladder
    const spendSet = new Set<number>();
    for (let s = 200; s <= maxS; s += 200) spendSet.add(Math.round(s));
    spendSet.add(Math.round(params.curSpend));
    spendSet.add(Math.round(optSpend));
    const ladder = [...spendSet].sort((a, b) => a - b).map(s => {
      const rev = hillRev(s, V, K, h);
      const roas = s > 0 ? rev / s : 0;
      const mr = hillMargRoas(s, V, K, h);
      const cm = rev * margin - s;
      const cmPct = rev > 0 ? cm / rev * 100 : 0;
      const cm3m = rev * margin * params.l3 - s;
      const cm12m = rev * margin * params.l12 - s;
      const isOpt = Math.abs(s - optSpend) < 50;
      const isCur = Math.abs(s - params.curSpend) < 50;
      return { spend: s, rev, roas, mr, cm, cmPct, cm3m, cm12m, isOpt, isCur };
    });

    return {
      fit, optSpend, optRev, curRev, curROAS, optROAS, curCM, optCM,
      curMROAS, spendDelta, curveData, ladder, adjustedPoints, maxS,
    };
  }, [dailyPoints, params, selectedGoal]);

  if (loading && !analysis) {
    return (
      <Navbar>
        <div className="flex items-center justify-center h-screen bg-[#0A0A0A]">
          <Loader className="animate-spin text-[#C8B89A]" size={32} />
        </div>
      </Navbar>
    );
  }

  const goalInfo = GOALS.find(g => g.key === selectedGoal)!;

  return (
    <Navbar>
      <div className="min-h-screen bg-[#0A0A0A] text-gray-200 p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-white">Marginal Efficiency Curve</h1>
            <p className="text-sm text-neutral-500 mt-1">
              Hill saturation model — find optimal daily Meta spend for each business goal
            </p>
          </div>
          <div className="flex items-center gap-3">
            <select
              value={selectedBrand}
              onChange={e => setSelectedBrand(e.target.value)}
              className="bg-[#1a1a1a] border border-neutral-700 text-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#C8B89A]"
            >
              <option value="">Select brand</option>
              {brands.map(b => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="flex items-center gap-1 bg-[#1a1a1a] border border-neutral-700 rounded-lg px-3 py-2 text-sm hover:border-[#C8B89A] transition-colors"
            >
              <Settings size={14} />
              Parameters
              {showSettings ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          </div>
        </div>

        {/* Settings Panel */}
        {showSettings && (
          <div className="bg-[#111] border border-[#1a1a1a] rounded-xl p-4 mb-6">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <ParamInput label="Current Daily Spend" value={params.curSpend} onChange={v => updateParam('curSpend', v)} step={50} />
              <ParamInput label="VC % (COGS)" value={params.vc} onChange={v => updateParam('vc', v)} min={0} max={100} />
              <ParamInput label="NC Share %" value={params.nc} onChange={v => updateParam('nc', v)} min={1} max={100} />
              <ParamInput label="Target ROAS" value={params.tr} onChange={v => updateParam('tr', v)} step={0.1} />
              <ParamInput label="Recency Half-Life (d)" value={params.hl} onChange={v => updateParam('hl', v)} min={7} max={365} />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-3">
              <ParamInput label="LTV 3m ×" value={params.l3} onChange={v => updateParam('l3', v)} step={0.05} />
              <ParamInput label="LTV 6m ×" value={params.l6} onChange={v => updateParam('l6', v)} step={0.05} />
              <ParamInput label="LTV 12m ×" value={params.l12} onChange={v => updateParam('l12', v)} step={0.05} />
              <ParamInput label="Adstock λ" value={params.lam} onChange={v => updateParam('lam', v)} step={0.05} min={0} max={0.95} />
            </div>
          </div>
        )}

        {/* Goal Tabs */}
        <div className="flex flex-wrap gap-2 mb-6">
          {GOALS.map(g => (
            <button
              key={g.key}
              onClick={() => setSelectedGoal(g.key)}
              className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                g.key === selectedGoal
                  ? 'bg-[#C8B89A] text-[#0A0A0A] border-[#C8B89A] font-semibold'
                  : 'bg-[#111] border-[#1a1a1a] text-neutral-500 hover:border-[#C8B89A] hover:text-[#C8B89A]'
              }`}
            >
              {g.label}
            </button>
          ))}
        </div>

        {analysis && (
          <>
            {/* KPI Cards */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
              <KpiCard
                label="Optimal Daily Spend"
                value={'$' + fmt(analysis.optSpend)}
                sub={`vs current $${fmt(params.curSpend)}`}
                color="text-[#C8B89A]"
              />
              <KpiCard
                label="Expected Revenue"
                value={'$' + fmt(analysis.optRev)}
                sub={`ROAS ${fmt(analysis.optROAS, 2)}×`}
              />
              <KpiCard
                label="Contribution Margin"
                value={'$' + fmt(analysis.optCM)}
                sub={`vs $${fmt(analysis.curCM)} today`}
                color="text-emerald-400"
              />
              <KpiCard
                label="Current Marginal ROAS"
                value={fmt(analysis.curMROAS, 2) + '×'}
                sub="next $ return"
              />
              <KpiCard
                label="Spend Change"
                value={`${analysis.spendDelta > 0 ? '+' : ''}${fmt(analysis.spendDelta, 1)}%`}
                sub={analysis.spendDelta > 0 ? 'Scale up' : 'Pull back'}
                color={analysis.spendDelta > 0 ? 'text-emerald-400' : 'text-red-400'}
              />
            </div>

            {/* Curve Fit Info */}
            <div className="bg-[#111] border border-[#1a1a1a] rounded-xl p-4 mb-6">
              <div className="text-xs font-semibold mb-2">
                Hill Curve Fit: r = V·s<sup>h</sup> / (K<sup>h</sup> + s<sup>h</sup>)
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs text-neutral-400">
                <div>V (ceiling) = <span className="text-white font-semibold">${fmt(analysis.fit.V)}</span></div>
                <div>K (half-sat) = <span className="text-white font-semibold">${fmt(analysis.fit.K)}</span></div>
                <div>h (shape) = <span className="text-white font-semibold">{fmt(analysis.fit.h, 2)}</span></div>
                <div>R² = <span className="text-white font-semibold">{fmt(analysis.fit.r2, 4)}</span></div>
              </div>
            </div>

            {/* Spend Ladder Table */}
            <div className="bg-[#111] border border-[#1a1a1a] rounded-xl overflow-x-auto mb-6">
              <div className="px-4 pt-4 pb-1 text-sm font-semibold text-white">
                Spend Ladder — Incremental Analysis
              </div>
              <div className="px-4 pb-3 text-xs text-neutral-500">
                {goalInfo.label}: {goalInfo.desc} · Green row = optimal
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr>
                    {['Daily Spend', 'Revenue', 'ROAS', 'Marg ROAS', 'CM', 'CM %', '3m CM', '12m CM', 'Note'].map(h => (
                      <th key={h} className="text-right px-3 py-2 border-b border-[#1a1a1a] text-neutral-500 text-[10px] uppercase tracking-wider last:text-left">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {analysis.ladder.map((row, i) => (
                    <tr
                      key={i}
                      className={`border-b border-[#1a1a1a] last:border-b-0 ${row.isOpt ? 'bg-[#C8B89A]/[0.06]' : ''}`}
                    >
                      <td className="px-3 py-2 text-right tabular-nums">${fmt(row.spend)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">${fmt(row.rev)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(row.roas, 2)}×</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${row.mr >= 1 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {fmt(row.mr, 2)}×
                      </td>
                      <td className={`px-3 py-2 text-right tabular-nums ${row.cm >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        ${fmt(row.cm)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(row.cmPct, 1)}%</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${row.cm3m >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        ${fmt(row.cm3m)}
                      </td>
                      <td className={`px-3 py-2 text-right tabular-nums ${row.cm12m >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        ${fmt(row.cm12m)}
                      </td>
                      <td className="px-3 py-2 text-left text-xs">
                        {row.isOpt && row.isCur && <span className="text-[#C8B89A] font-medium">● Current & Optimal</span>}
                        {row.isOpt && !row.isCur && <span className="text-emerald-400 font-medium">▲ Optimal</span>}
                        {!row.isOpt && row.isCur && <span className="text-blue-400 font-medium">● Current</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Data Points Info */}
            <div className="flex items-start gap-2 bg-[#111] border border-[#1a1a1a] rounded-xl p-4">
              <Info size={16} className="text-[#C8B89A] mt-0.5 shrink-0" />
              <div className="text-xs text-neutral-400">
                Fitted on <strong className="text-neutral-300">{analysis.adjustedPoints.length}</strong> daily data points.
                Recency half-life: {params.hl}d. Adstock decay: λ={params.lam}.
                The Hill model generalizes Michaelis-Menten by adding shape parameter h — when h=1, it reduces to the standard saturation curve.
                Higher h means a sharper inflection point.
              </div>
            </div>
          </>
        )}

        {/* Empty state */}
        {!analysis && !loading && (
          <div className="text-center py-20 text-neutral-500">
            <TrendingUp size={48} className="mx-auto mb-4 opacity-30" />
            <p className="text-lg">No spend data available</p>
            <p className="text-sm mt-2">Select a brand with daily P&L data to view the efficiency curve</p>
          </div>
        )}
      </div>
    </Navbar>
  );
}

// ─── Sub-components ─────────────────────────────────────────────

function KpiCard({ label, value, sub, color }: { label: string; value: string; sub: string; color?: string }) {
  return (
    <div className="bg-[#111] border border-[#1a1a1a] rounded-xl p-4">
      <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-1">{label}</div>
      <div className={`text-xl font-bold tabular-nums ${color || 'text-white'}`}>{value}</div>
      <div className="text-[11px] text-neutral-500 mt-1">{sub}</div>
    </div>
  );
}

function ParamInput({
  label, value, onChange, step = 1, min, max,
}: {
  label: string; value: number; onChange: (v: number) => void;
  step?: number; min?: number; max?: number;
}) {
  return (
    <div>
      <label className="block text-[10px] text-neutral-500 mb-1 uppercase tracking-wider">{label}</label>
      <input
        type="number"
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        step={step}
        min={min}
        max={max}
        className="w-full bg-[#1a1a1a] border border-neutral-700 text-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-[#C8B89A]"
      />
    </div>
  );
}
