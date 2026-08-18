'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Loader,
  TrendingUp,
  DollarSign,
  Info,
  AlertTriangle,
  RefreshCw,
  Settings,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import Navbar from '@/components/Navbar';
import { createClient } from '@/lib/supabase';
import {
  DailyPoint,
  HillFit,
  GOALS,
  Params,
  MIN_DATA_POINTS,
  fitHillCurve,
  hillRev,
  hillMargRoas,
  findOptimalSpend,
} from '@/lib/hill-model';

// ─── Types ──────────────────────────────────────────────────────

interface Brand {
  id: string;
  name: string;
  slug: string;
  gross_margin_pct: number;
  target_roas: number | null;
  nc_share_pct: number | null;
  ltv_3m_mult: number | null;
  ltv_6m_mult: number | null;
  ltv_12m_mult: number | null;
}

// ─── Brand defaults ─────────────────────────────────────────────

function brandDefaults(brand?: Brand): Params {
  return {
    vc: 100 - (brand?.gross_margin_pct ?? 62),
    nc: brand?.nc_share_pct ?? 60,
    l3: brand?.ltv_3m_mult ?? 1.4,
    l6: brand?.ltv_6m_mult ?? 1.8,
    l12: brand?.ltv_12m_mult ?? 2.5,
    hl: 60,
    tr: brand?.target_roas ?? 1.5,
    curSpend: 1200,
    merchantFeePct: 2.9,
    fulfillmentPerOrder: 0,
    dateRange: '90d',
  };
}

// ─── Formatting ─────────────────────────────────────────────────

const fmt = (n: number, d = 0) => {
  if (!isFinite(n)) return 'N/A';
  return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
};

// ─── Component ──────────────────────────────────────────────────

export default function EfficiencyPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [loading, setLoading] = useState(true);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [selectedBrand, setSelectedBrand] = useState<string>('');
  const [dailyPoints, setDailyPoints] = useState<DailyPoint[]>([]);
  const [selectedGoal, setSelectedGoal] = useState('maxCM');
  const [showSettings, setShowSettings] = useState(false);
  const [goalTooltip, setGoalTooltip] = useState<string | null>(null);

  // Tunable params — initialized from brand settings, reset on brand switch
  const [params, setParams] = useState<Params>(brandDefaults());

  const updateParam = (key: keyof Params, val: number | string) =>
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

      const { data: brandList } = await supabase
        .from('brands')
        .select('id, name, slug, gross_margin_pct, target_roas, nc_share_pct, ltv_3m_mult, ltv_6m_mult, ltv_12m_mult')
        .is('archived_at', null);

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

  // Load daily data — reset params on brand switch
  useEffect(() => {
    if (!selectedBrand) return;
    async function fetchData() {
      setLoading(true);
      setDailyPoints([]);

      // Reset params from brand settings
      const brand = brands.find(b => b.id === selectedBrand);
      setParams(prev => ({ ...brandDefaults(brand), dateRange: prev.dateRange }));

      // Build date filter
      let dateFilter: string | null = null;
      const now = new Date();
      switch (params.dateRange) {
        case '30d': { const d = new Date(now); d.setDate(d.getDate() - 30); dateFilter = d.toISOString().split('T')[0]; break; }
        case '90d': { const d = new Date(now); d.setDate(d.getDate() - 90); dateFilter = d.toISOString().split('T')[0]; break; }
        case '180d': { const d = new Date(now); d.setDate(d.getDate() - 180); dateFilter = d.toISOString().split('T')[0]; break; }
        case '365d': { const d = new Date(now); d.setDate(d.getDate() - 365); dateFilter = d.toISOString().split('T')[0]; break; }
      }

      let query = supabase
        .from('daily_pnl')
        .select('date, nc_revenue, nc_orders, rc_revenue, gross_sales, meta_spend, google_spend, other_spend')
        .eq('brand_id', selectedBrand)
        .order('date', { ascending: true });

      if (dateFilter) query = query.gte('date', dateFilter);

      const { data } = await query;

      if (data) {
        const points: DailyPoint[] = data.map(row => {
          const d = new Date(row.date);
          const metaSpend = Number(row.meta_spend || 0);
          const googleSpend = Number(row.google_spend || 0);
          const otherSpend = Number(row.other_spend || 0);
          // Blended ad spend — always meta + google + other, regardless of which
          // channels a brand runs.
          const spend = metaSpend + googleSpend + otherSpend;
          const rev = Number(row.nc_revenue || 0);
          const ncRev = Number(row.nc_revenue || 0);
          const orders = Number(row.nc_orders || 0);
          const daysBack = Math.floor((now.getTime() - d.getTime()) / 86400000);
          return { date: row.date, spend, rev, ncRev, orders, daysBack };
        }).filter(p => p.spend > 0 && p.rev > 0);

        setDailyPoints(points);

        // Set current spend to recent average
        if (points.length >= 7) {
          const recent = points.slice(-7);
          const avgSpend = recent.reduce((s, p) => s + p.spend, 0) / recent.length;
          setParams(prev => ({ ...prev, curSpend: Math.round(avgSpend) }));
        }
      }
      setLoading(false);
    }
    fetchData();
  }, [selectedBrand, params.dateRange]);

  // Compute everything
  const analysis = useMemo(() => {
    if (dailyPoints.length < MIN_DATA_POINTS) return null;

    const fit = fitHillCurve(dailyPoints, params.hl);
    const { V, K, h, r2 } = fit;
    const grossMargin = 1 - params.vc / 100;

    // Effective margin matching the P&L's kbContribution: subtract merchant fee
    // (% of revenue) and fulfillment ($/order ÷ AOV). AOV = nc_revenue / nc_orders
    // across the fitted points, so fulfillment folds into a revenue-percentage.
    const totRev = dailyPoints.reduce((s, p) => s + p.rev, 0);
    const totOrders = dailyPoints.reduce((s, p) => s + p.orders, 0);
    const aov = totOrders > 0 ? totRev / totOrders : 0;
    const fulfillmentRate = aov > 0 ? params.fulfillmentPerOrder / aov : 0;
    const effMargin = grossMargin - params.merchantFeePct / 100 - fulfillmentRate;

    const optSpend = findOptimalSpend(V, K, h, selectedGoal, params, effMargin);
    const optRev = hillRev(optSpend, V, K, h);
    const curRev = hillRev(params.curSpend, V, K, h);
    const curROAS = params.curSpend > 0 ? curRev / params.curSpend : 0;
    const optROAS = optSpend > 0 ? optRev / optSpend : 0;
    const curCM = curRev * effMargin - params.curSpend;
    const optCM = optRev * effMargin - optSpend;
    const curMROAS = params.curSpend > 0 ? hillMargRoas(params.curSpend, V, K, h) : 0;
    const spendDelta = params.curSpend > 0 ? ((optSpend / params.curSpend) - 1) * 100 : 0;

    // Curve data for chart
    const maxS = Math.max(...dailyPoints.map(d => d.spend), optSpend) * 1.3;
    const curveData = Array.from({ length: 200 }, (_, i) => {
      const s = maxS * (i + 1) / 200;
      return { spend: s, rev: hillRev(s, V, K, h), mroas: hillMargRoas(s, V, K, h) };
    });

    // Spend ladder — limit to ~20 rows centered around current and optimal
    const spendSet = new Set<number>();
    const stepSize = Math.max(100, Math.round(maxS / 25 / 100) * 100);
    for (let s = stepSize; s <= maxS; s += stepSize) spendSet.add(Math.round(s));
    spendSet.add(Math.round(params.curSpend));
    spendSet.add(Math.round(optSpend));
    const ladder = Array.from(spendSet).sort((a, b) => a - b).map(s => {
      const rev = hillRev(s, V, K, h);
      const roas = s > 0 ? rev / s : 0;
      const mr = hillMargRoas(s, V, K, h);
      const cm = rev * effMargin - s;
      const cmPct = rev > 0 ? cm / rev * 100 : 0;
      const cm3m = rev * effMargin * params.l3 - s;
      const cm12m = rev * effMargin * params.l12 - s;
      const isOpt = Math.abs(s - optSpend) < stepSize * 0.5;
      const isCur = Math.abs(s - params.curSpend) < stepSize * 0.5;
      return { spend: s, rev, roas, mr, cm, cmPct, cm3m, cm12m, isOpt, isCur };
    });

    return {
      fit, optSpend, optRev, curRev, curROAS, optROAS, curCM, optCM,
      curMROAS, spendDelta, curveData, ladder, maxS,
    };
  }, [dailyPoints, params, selectedGoal]);

  // ─── Chart rendering (SVG) ──────────────────────────────────────
  const chartSvg = useMemo(() => {
    if (!analysis) return null;
    const { curveData, maxS, fit } = analysis;
    const W = 800, H = 340, PAD = { top: 20, right: 60, bottom: 40, left: 60 };
    const cw = W - PAD.left - PAD.right;
    const ch = H - PAD.top - PAD.bottom;
    const maxRev = Math.max(...curveData.map(d => d.rev));
    const maxMroas = Math.min(Math.max(...curveData.map(d => d.mroas)), 20);

    const sx = (s: number) => PAD.left + (s / maxS) * cw;
    const syRev = (r: number) => PAD.top + ch - (r / maxRev) * ch;
    const syMr = (m: number) => PAD.top + ch - (Math.min(m, maxMroas) / maxMroas) * ch;

    // Revenue curve path
    const revPath = curveData.map((d, i) =>
      `${i === 0 ? 'M' : 'L'}${sx(d.spend).toFixed(1)},${syRev(d.rev).toFixed(1)}`
    ).join(' ');

    // Marginal ROAS path
    const mroasPath = curveData.map((d, i) =>
      `${i === 0 ? 'M' : 'L'}${sx(d.spend).toFixed(1)},${syMr(d.mroas).toFixed(1)}`
    ).join(' ');

    // Y-axis ticks
    const revTicks = [0, 0.25, 0.5, 0.75, 1].map(p => ({ val: maxRev * p, y: syRev(maxRev * p) }));
    const mrTicks = [0, 0.25, 0.5, 0.75, 1].map(p => ({ val: maxMroas * p, y: syMr(maxMroas * p) }));

    // X-axis ticks
    const xTickCount = 6;
    const xTicks = Array.from({ length: xTickCount + 1 }, (_, i) => {
      const val = maxS * i / xTickCount;
      return { val, x: sx(val) };
    });

    return { revPath, mroasPath, revTicks, mrTicks, xTicks, W, H, PAD, sx, syRev, syMr, maxRev, maxMroas };
  }, [analysis]);

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
  const poorFit = analysis && analysis.fit.r2 < 0.5;
  const cautionFit = analysis && analysis.fit.r2 >= 0.5 && analysis.fit.r2 < 0.7;
  const insufficientData = dailyPoints.length > 0 && dailyPoints.length < MIN_DATA_POINTS;

  return (
    <Navbar>
      <div className="min-h-screen bg-[#0A0A0A] text-gray-200 p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-white">Marginal Efficiency Curve</h1>
            <p className="text-sm text-neutral-500 mt-1">
              Hill saturation model — find optimal daily ad spend for each business goal
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

            {/* Date range */}
            <select
              value={params.dateRange}
              onChange={e => updateParam('dateRange', e.target.value)}
              className="bg-[#1a1a1a] border border-neutral-700 text-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#C8B89A]"
            >
              <option value="30d">Last 30 days</option>
              <option value="90d">Last 90 days</option>
              <option value="180d">Last 180 days</option>
              <option value="365d">Last 365 days</option>
              <option value="all">All time</option>
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
              <ParamInput label="Merchant Fee %" value={params.merchantFeePct} onChange={v => updateParam('merchantFeePct', v)} step={0.1} />
              <ParamInput label="Fulfillment $/order" value={params.fulfillmentPerOrder} onChange={v => updateParam('fulfillmentPerOrder', v)} step={0.5} />
            </div>
          </div>
        )}

        {/* R² Warning Banners */}
        {poorFit && (
          <div className="flex items-center gap-3 bg-red-500/10 border border-red-500/20 rounded-xl p-4 mb-6">
            <AlertTriangle size={18} className="text-red-400 shrink-0" />
            <div className="text-sm text-red-400">
              <strong>Low model fit (R² = {fmt(analysis!.fit.r2, 3)})</strong> — the Hill curve can't reliably predict revenue from this spend data.
              This usually means revenue is driven by channels outside the plotted spend (organic, email, or other ad platforms), so a spend→revenue curve doesn't hold. Recommendations are hidden.
            </div>
          </div>
        )}
        {cautionFit && (
          <div className="flex items-center gap-3 bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-4 mb-6">
            <AlertTriangle size={18} className="text-yellow-400 shrink-0" />
            <div className="text-sm text-yellow-400">
              <strong>Moderate model fit (R² = {fmt(analysis!.fit.r2, 3)})</strong> — treat recommendations as directional guidance, not precise targets.
            </div>
          </div>
        )}

        {/* Insufficient data warning */}
        {insufficientData && (
          <div className="flex items-center gap-3 bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-4 mb-6">
            <AlertTriangle size={18} className="text-yellow-400 shrink-0" />
            <div className="text-sm text-yellow-400">
              Only {dailyPoints.length} data points available — need at least {MIN_DATA_POINTS} days of spend data to fit a reliable curve.
              Try a longer date range.
            </div>
          </div>
        )}

        {/* Goal Tabs */}
        <div className="flex flex-wrap gap-2 mb-6">
          {GOALS.map(g => (
            <div key={g.key} className="relative">
              <button
                onClick={() => setSelectedGoal(g.key)}
                onMouseEnter={() => setGoalTooltip(g.key)}
                onMouseLeave={() => setGoalTooltip(null)}
                className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                  g.key === selectedGoal
                    ? 'bg-[#C8B89A] text-[#0A0A0A] border-[#C8B89A] font-semibold'
                    : 'bg-[#111] border-[#1a1a1a] text-neutral-500 hover:border-[#C8B89A] hover:text-[#C8B89A]'
                }`}
              >
                {g.label}
              </button>
              {goalTooltip === g.key && (
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-3 rounded-lg text-xs text-neutral-300 z-50"
                  style={{ backgroundColor: '#1a1a1a', border: '1px solid rgba(200,184,154,0.2)', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
                  {g.tooltip}
                </div>
              )}
            </div>
          ))}
        </div>

        {analysis && (
          <>
            {/* KPI Cards — recommendation hidden when the fit is unreliable */}
            {!poorFit && (
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
            )}

            {/* ─── Efficiency Curve Chart ──────────────────────────── */}
            {chartSvg && (
              <div className="bg-[#111] border border-[#1a1a1a] rounded-xl p-4 mb-6">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-white">Efficiency Curve</h3>
                  <div className="flex items-center gap-4 text-[10px]">
                    <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 rounded" style={{ backgroundColor: '#C8B89A' }}></span> Revenue</span>
                    <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 rounded" style={{ backgroundColor: '#5B8DEE' }}></span> Marginal ROAS</span>
                    <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-400"></span> Optimal</span>
                    <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-blue-400"></span> Current</span>
                  </div>
                </div>
                <svg viewBox={`0 0 ${chartSvg.W} ${chartSvg.H}`} className="w-full" style={{ overflow: 'visible' }}>
                  {/* Grid lines */}
                  {chartSvg.revTicks.map((t, i) => (
                    <line key={`gy-${i}`} x1={chartSvg.PAD.left} x2={chartSvg.W - chartSvg.PAD.right} y1={t.y} y2={t.y}
                      stroke="rgba(255,255,255,0.04)" strokeWidth={1} />
                  ))}

                  {/* Scatter plot of actual data */}
                  {dailyPoints.map((p, i) => (
                    <circle key={`dp-${i}`} cx={chartSvg.sx(p.spend)} cy={chartSvg.syRev(p.rev)}
                      r={2.5} fill="rgba(200,184,154,0.25)" />
                  ))}

                  {/* Revenue curve */}
                  <path d={chartSvg.revPath} fill="none" stroke="#C8B89A" strokeWidth={2.5} />

                  {/* Marginal ROAS curve */}
                  <path d={chartSvg.mroasPath} fill="none" stroke="#5B8DEE" strokeWidth={1.5} strokeDasharray="6,3" />

                  {/* Marginal ROAS = 1 line */}
                  {1 <= chartSvg.maxMroas && (
                    <line x1={chartSvg.PAD.left} x2={chartSvg.W - chartSvg.PAD.right}
                      y1={chartSvg.syMr(1)} y2={chartSvg.syMr(1)}
                      stroke="rgba(248,113,113,0.3)" strokeWidth={1} strokeDasharray="4,4" />
                  )}

                  {/* Current spend line */}
                  <line x1={chartSvg.sx(params.curSpend)} x2={chartSvg.sx(params.curSpend)}
                    y1={chartSvg.PAD.top} y2={chartSvg.H - chartSvg.PAD.bottom}
                    stroke="#60A5FA" strokeWidth={1.5} strokeDasharray="4,3" />
                  <text x={chartSvg.sx(params.curSpend)} y={chartSvg.PAD.top - 6}
                    textAnchor="middle" fill="#60A5FA" fontSize={9}>Current</text>

                  {/* Optimal spend line */}
                  <line x1={chartSvg.sx(analysis.optSpend)} x2={chartSvg.sx(analysis.optSpend)}
                    y1={chartSvg.PAD.top} y2={chartSvg.H - chartSvg.PAD.bottom}
                    stroke="#34D399" strokeWidth={1.5} strokeDasharray="4,3" />
                  <text x={chartSvg.sx(analysis.optSpend)} y={chartSvg.PAD.top - 6}
                    textAnchor="middle" fill="#34D399" fontSize={9}>Optimal</text>

                  {/* Left Y-axis labels (Revenue) */}
                  {chartSvg.revTicks.map((t, i) => (
                    <text key={`rl-${i}`} x={chartSvg.PAD.left - 8} y={t.y + 3}
                      textAnchor="end" fill="#888" fontSize={9}>
                      ${t.val >= 1000 ? `${(t.val / 1000).toFixed(0)}k` : fmt(t.val)}
                    </text>
                  ))}

                  {/* Right Y-axis labels (MROAS) */}
                  {chartSvg.mrTicks.map((t, i) => (
                    <text key={`ml-${i}`} x={chartSvg.W - chartSvg.PAD.right + 8} y={t.y + 3}
                      textAnchor="start" fill="#5B8DEE" fontSize={9}>
                      {t.val.toFixed(1)}×
                    </text>
                  ))}

                  {/* X-axis labels */}
                  {chartSvg.xTicks.map((t, i) => (
                    <text key={`xl-${i}`} x={t.x} y={chartSvg.H - chartSvg.PAD.bottom + 16}
                      textAnchor="middle" fill="#888" fontSize={9}>
                      ${t.val >= 1000 ? `${(t.val / 1000).toFixed(0)}k` : fmt(t.val)}
                    </text>
                  ))}

                  {/* Axis labels */}
                  <text x={chartSvg.W / 2} y={chartSvg.H - 4} textAnchor="middle" fill="#666" fontSize={10}>
                    Daily Ad Spend
                  </text>
                </svg>
              </div>
            )}

            {/* Curve Fit Info */}
            <div className="bg-[#111] border border-[#1a1a1a] rounded-xl p-4 mb-6">
              <div className="text-xs font-semibold mb-2">
                Hill Curve Fit: r = V·s<sup>h</sup> / (K<sup>h</sup> + s<sup>h</sup>)
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs text-neutral-400">
                <div title="Maximum possible daily revenue at infinite spend">
                  V (ceiling) = <span className="text-white font-semibold">${fmt(analysis.fit.V)}</span>
                </div>
                <div title="The spend level where you achieve half of maximum revenue">
                  K (half-sat) = <span className="text-white font-semibold">${fmt(analysis.fit.K)}</span>
                </div>
                <div title="Curve steepness — higher h means a sharper inflection point">
                  h (shape) = <span className="text-white font-semibold">{fmt(analysis.fit.h, 2)}</span>
                </div>
                <div>
                  R² = <span className={`font-semibold ${poorFit ? 'text-red-400' : cautionFit ? 'text-yellow-400' : 'text-white'}`}>
                    {fmt(analysis.fit.r2, 4)}
                  </span>
                </div>
              </div>
            </div>

            {/* Spend Ladder Table — hidden when the fit is unreliable */}
            {!poorFit && (
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
            )}

            {/* Data Points Info */}
            <div className="flex items-start gap-2 bg-[#111] border border-[#1a1a1a] rounded-xl p-4">
              <Info size={16} className="text-[#C8B89A] mt-0.5 shrink-0" />
              <div className="text-xs text-neutral-400">
                Fitted on <strong className="text-neutral-300">{dailyPoints.length}</strong> daily data points
                (total ad spend vs new customer revenue).
                Recency half-life: {params.hl}d.
                The Hill model generalizes Michaelis-Menten by adding shape parameter h — when h=1, it reduces to the standard saturation curve.
                Higher h means a sharper inflection point.
                <br />
                <span className="text-neutral-500 mt-1 block">
                  Note: This model attributes new customer revenue to ad spend and does not separate channel-specific attribution.
                  Use as directional guidance for budget allocation.
                </span>
              </div>
            </div>
          </>
        )}

        {/* Empty state */}
        {!analysis && !loading && !insufficientData && (
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
