'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Loader,
  Users,
  DollarSign,
  TrendingUp,
  AlertTriangle,
  Info,
  ChevronDown,
} from 'lucide-react';
import Navbar from '@/components/Navbar';
import { createClient } from '@/lib/supabase';

// ─── Types ──────────────────────────────────────────────────────

interface Brand {
  id: string;
  name: string;
  slug: string;
  gross_margin_pct: number;
}

interface CohortRow {
  label: string;
  ncCustomers: number;
  firstOrderAOV: number;
  cumRevPerCust: (number | null)[];
  cumGPPerCust: (number | null)[];
  repeatRate: number;
  adSpendMonth: number;
  cac: number | null;
  latestLTV: number;
  latestGPLTV: number;
  ltvCacRatio: number;
  gpLtvCacRatio: number;
  paybackMonth: number | null;
  monthsAge: number;
  suggestedNcPct: number | null;
}

interface OrderRow {
  customer_id: string | null;
  email: string | null;
  total_price: number;
  subtotal_price: number | null;
  financial_status: string | null;
  shopify_created_at: string;
}

interface DailyPnlRow {
  date: string;
  nc_orders: number;
  rc_orders: number;
  nc_revenue: number;
  meta_spend: number;
  google_spend: number;
  other_spend: number;
}

// ─── Helpers ────────────────────────────────────────────────────

const fmt = (n: number, d = 0) => {
  if (!isFinite(n)) return 'N/A';
  return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
};
const fmtCur = (n: number | null) => (n == null ? '—' : '$' + fmt(n, 2));
const fmtPct = (n: number) => fmt(n * 100, 1) + '%';

function ltvCacClass(ratio: number) {
  if (ratio >= 3) return 'text-emerald-400';
  if (ratio >= 2) return 'text-[#C8B89A]';
  return 'text-red-400';
}

function ltvCacBg(ratio: number) {
  if (ratio >= 3) return 'bg-emerald-500/15 text-emerald-400';
  if (ratio >= 2) return 'bg-[#C8B89A]/15 text-[#C8B89A]';
  return 'bg-red-500/15 text-red-400';
}

function ltvCacLabel(ratio: number) {
  if (ratio >= 3) return 'Healthy';
  if (ratio >= 2) return 'Acceptable';
  return 'Over-Acquiring';
}

function heatStyle(val: number | null, base: number) {
  if (val == null) return {};
  const ratio = val / base;
  if (ratio >= 1.5) return { background: 'rgba(16,185,129,0.2)', color: '#10B981' };
  if (ratio >= 1.2) return { background: 'rgba(16,185,129,0.1)', color: '#6ee7b7' };
  if (ratio >= 1.05) return { background: 'rgba(200,184,154,0.1)', color: '#C8B89A' };
  return {};
}

function calendarMonthDiff(a: Date, b: Date): number {
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

// ─── Build Cohorts from Real Data ───────────────────────────────

function buildCohorts(
  orders: OrderRow[],
  dailyPnl: DailyPnlRow[],
  ncSharePct: number,
  grossMarginPct: number,
): CohortRow[] {
  if (!orders.length) return [];

  const margin = grossMarginPct / 100;

  // Filter out voided/refunded orders
  const validOrders = orders.filter(o =>
    o.financial_status !== 'voided' &&
    o.financial_status !== 'refunded'
  );

  // Group orders by customer — deduplicate by email (lowercase), fall back to customer_id
  const customerOrders: Record<string, {
    firstDate: Date;
    orders: { date: Date; amount: number }[];
  }> = {};

  validOrders.forEach(o => {
    const d = new Date(o.shopify_created_at);
    // Use email as primary key for better deduplication, fall back to customer_id
    const cid = o.email?.toLowerCase().trim() || o.customer_id;
    if (!cid) return; // Skip orders with no customer identifier at all
    const amount = Number(o.subtotal_price ?? o.total_price) || 0;
    if (amount <= 0) return;

    if (!customerOrders[cid]) customerOrders[cid] = { firstDate: d, orders: [] };
    if (d < customerOrders[cid].firstDate) customerOrders[cid].firstDate = d;
    customerOrders[cid].orders.push({ date: d, amount });
  });

  // Group customers by acquisition month (first order month)
  const cohortMap: Record<string, {
    customers: string[];
    firstOrderTotal: number;
    cumulativeByMonth: Record<number, number>;
  }> = {};

  Object.entries(customerOrders).forEach(([cid, data]) => {
    const cohortKey = `${data.firstDate.getFullYear()}-${String(data.firstDate.getMonth() + 1).padStart(2, '0')}`;
    if (!cohortMap[cohortKey]) cohortMap[cohortKey] = { customers: [], firstOrderTotal: 0, cumulativeByMonth: {} };
    cohortMap[cohortKey].customers.push(cid);

    // Calculate revenue by month bucket using calendar month diff
    data.orders.sort((a, b) => a.date.getTime() - b.date.getTime());
    data.orders.forEach(o => {
      const monthsAfter = Math.max(0, calendarMonthDiff(data.firstDate, o.date));
      const m = Math.min(monthsAfter, 12);
      cohortMap[cohortKey].cumulativeByMonth[m] = (cohortMap[cohortKey].cumulativeByMonth[m] || 0) + o.amount;
    });

    // First order revenue
    if (data.orders.length > 0) {
      cohortMap[cohortKey].firstOrderTotal += data.orders[0].amount;
    }
  });

  // Build pnl by month for ad spend + NC suggestion
  const pnlByMonth: Record<string, { totalSpend: number; ncOrders: number; rcOrders: number }> = {};
  dailyPnl.forEach(row => {
    const d = new Date(row.date);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (!pnlByMonth[key]) pnlByMonth[key] = { totalSpend: 0, ncOrders: 0, rcOrders: 0 };
    pnlByMonth[key].totalSpend += Number(row.meta_spend || 0) + Number(row.google_spend || 0) + Number(row.other_spend || 0);
    pnlByMonth[key].ncOrders += Number(row.nc_orders || 0);
    pnlByMonth[key].rcOrders += Number(row.rc_orders || 0);
  });

  // Sort cohort keys chronologically
  const sortedKeys = Object.keys(cohortMap).sort();
  const now = new Date();

  return sortedKeys.map(key => {
    const cohort = cohortMap[key];
    const [year, month] = key.split('-').map(Number);
    const cohortDate = new Date(year, month - 1, 1);
    const monthsAge = calendarMonthDiff(cohortDate, now);
    const label = cohortDate.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });

    const ncCustomers = cohort.customers.length;
    const firstOrderAOV = ncCustomers > 0 ? cohort.firstOrderTotal / ncCustomers : 0;

    // Build cumulative rev per customer array [M0, M1, M2, ... M12]
    const cumRevPerCust: (number | null)[] = [];
    const cumGPPerCust: (number | null)[] = [];
    let runningTotal = 0;
    for (let m = 0; m <= 12; m++) {
      if (m > monthsAge) { cumRevPerCust.push(null); cumGPPerCust.push(null); continue; }
      runningTotal += cohort.cumulativeByMonth[m] || 0;
      const perCust = ncCustomers > 0 ? runningTotal / ncCustomers : 0;
      cumRevPerCust.push(perCust);
      cumGPPerCust.push(perCust * margin);
    }

    // Repeat rate: customers with 2+ orders
    const repeatCustomers = cohort.customers.filter(cid =>
      customerOrders[cid].orders.length >= 2
    ).length;
    const repeatRate = ncCustomers > 0 ? repeatCustomers / ncCustomers : 0;

    // CAC from pnl data
    const pnl = pnlByMonth[key];
    const adSpendMonth = pnl ? pnl.totalSpend : 0;
    const pnlNC = pnl ? pnl.ncOrders : 0;
    const cac: number | null = pnl && pnlNC > 0
      ? (adSpendMonth * ncSharePct / 100) / pnlNC
      : null;

    // Suggested NC% from actual data
    const suggestedNcPct = pnl && (pnl.ncOrders + pnl.rcOrders) > 0
      ? (pnl.ncOrders / (pnl.ncOrders + pnl.rcOrders)) * 100
      : null;

    const latestLTV = cumRevPerCust.filter(v => v !== null).pop() as number || firstOrderAOV;
    const latestGPLTV = latestLTV * margin;

    const ltvCacRatio = cac != null && cac > 0 ? latestLTV / cac : 0;
    const gpLtvCacRatio = cac != null && cac > 0 ? latestGPLTV / cac : 0;

    // Payback period: first month where cumulative GP per customer >= CAC
    let paybackMonth: number | null = null;
    if (cac != null && cac > 0) {
      for (let m = 0; m <= 12; m++) {
        const gp = cumGPPerCust[m];
        if (gp !== null && gp >= cac) { paybackMonth = m; break; }
      }
    }

    return {
      label, ncCustomers, firstOrderAOV, cumRevPerCust, cumGPPerCust, repeatRate,
      adSpendMonth, cac, latestLTV, latestGPLTV, ltvCacRatio, gpLtvCacRatio,
      paybackMonth, monthsAge, suggestedNcPct,
    };
  });
}

// ─── Component ──────────────────────────────────────────────────

export default function LTVCohortPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [loading, setLoading] = useState(true);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [selectedBrand, setSelectedBrand] = useState<string>('');
  const [ncShare, setNcShare] = useState(60);
  const [ncShareDebounced, setNcShareDebounced] = useState(60);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [dailyPnl, setDailyPnl] = useState<DailyPnlRow[]>([]);
  const [showGP, setShowGP] = useState(false);

  // Debounce NC share slider
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setNcShareDebounced(ncShare), 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [ncShare]);

  // Auth check + load brands
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
        .select('id, name, slug, gross_margin_pct')
        .is('archived_at', null);

      if (brandList) setBrands(brandList);

      if (profile?.brand_id) {
        setSelectedBrand(profile.brand_id);
      } else if (brandList && brandList.length > 0) {
        setSelectedBrand(brandList[0].id);
      } else {
        setLoading(false);
      }
    }
    init();
  }, []);

  // Load data when brand changes — paginate shopify_orders
  useEffect(() => {
    if (!selectedBrand) return;
    async function fetchData() {
      setLoading(true);
      setOrders([]);

      // Fetch ALL orders with pagination (filter out voided/refunded at query level)
      const allOrders: OrderRow[] = [];
      const PAGE_SIZE = 1000;
      let from = 0;
      let hasMore = true;
      while (hasMore) {
        const { data } = await supabase
          .from('shopify_orders')
          .select('customer_id, email, total_price, subtotal_price, financial_status, shopify_created_at')
          .eq('brand_id', selectedBrand)
          .not('financial_status', 'in', '("voided")')
          .order('shopify_created_at', { ascending: true })
          .range(from, from + PAGE_SIZE - 1);

        if (data && data.length > 0) {
          allOrders.push(...data);
          from += PAGE_SIZE;
          hasMore = data.length === PAGE_SIZE;
        } else {
          hasMore = false;
        }
      }

      const { data: pnlData } = await supabase
        .from('daily_pnl')
        .select('date, nc_orders, rc_orders, nc_revenue, meta_spend, google_spend, other_spend')
        .eq('brand_id', selectedBrand)
        .order('date', { ascending: true });

      setOrders(allOrders);
      if (pnlData) setDailyPnl(pnlData);
      setLoading(false);
    }
    fetchData();
  }, [selectedBrand]);

  const selectedBrandData = brands.find(b => b.id === selectedBrand);
  const grossMarginPct = selectedBrandData?.gross_margin_pct ?? 62;

  const cohorts = useMemo(
    () => buildCohorts(orders, dailyPnl, ncShareDebounced, grossMarginPct),
    [orders, dailyPnl, ncShareDebounced, grossMarginPct]
  );

  // Auto-suggest NC% from data
  const suggestedNcPct = useMemo(() => {
    const suggestions = cohorts.map(c => c.suggestedNcPct).filter((v): v is number => v !== null);
    if (suggestions.length === 0) return null;
    return Math.round(suggestions.reduce((a, b) => a + b, 0) / suggestions.length);
  }, [cohorts]);

  // KPI aggregates — weighted by cohort size
  const kpis = useMemo(() => {
    if (!cohorts.length) return null;
    const totalNC = cohorts.reduce((s, c) => s + c.ncCustomers, 0);
    if (totalNC === 0) return null;

    const avgAOV = cohorts.reduce((s, c) => s + c.firstOrderAOV * c.ncCustomers, 0) / totalNC;
    const avgRepeat = cohorts.reduce((s, c) => s + c.repeatRate * c.ncCustomers, 0) / totalNC;
    const avgLTV = cohorts.reduce((s, c) => s + c.latestLTV * c.ncCustomers, 0) / totalNC;
    const avgGPLTV = avgLTV * (grossMarginPct / 100);

    // Weighted CAC — only from cohorts with CAC data
    const cohortsWithCAC = cohorts.filter(c => c.cac !== null && c.cac > 0);
    const cacTotalNC = cohortsWithCAC.reduce((s, c) => s + c.ncCustomers, 0);
    const avgCAC = cacTotalNC > 0
      ? cohortsWithCAC.reduce((s, c) => s + c.cac! * c.ncCustomers, 0) / cacTotalNC
      : null;

    const avgLTVCAC = avgCAC != null && avgCAC > 0 ? avgLTV / avgCAC : 0;
    const avgGPLTVCAC = avgCAC != null && avgCAC > 0 ? avgGPLTV / avgCAC : 0;

    return {
      totalNC, avgAOV, avgRepeat, avgLTV, avgGPLTV, avgCAC,
      avgLTVCAC, avgGPLTVCAC, ltvMult: avgAOV > 0 ? avgLTV / avgAOV : 0,
    };
  }, [cohorts, grossMarginPct]);

  const periodLabels = ['1st Order', 'M1', 'M2', 'M3', 'M6', 'M9', 'M12'];
  const periodIndices = [0, 1, 2, 3, 6, 9, 12];

  if (loading && !cohorts.length) {
    return (
      <Navbar>
        <div className="flex items-center justify-center h-screen bg-[#0A0A0A]">
          <Loader className="animate-spin text-[#C8B89A]" size={32} />
        </div>
      </Navbar>
    );
  }

  return (
    <Navbar>
      <div className="min-h-screen bg-[#0A0A0A] text-gray-200 p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-white">LTV Cohort Report</h1>
            <p className="text-sm text-neutral-500 mt-1">
              Customer lifetime value by acquisition cohort — cumulative {showGP ? 'gross profit' : 'revenue'} per customer over time
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* Brand selector */}
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

            {/* Revenue vs GP toggle */}
            <button
              onClick={() => setShowGP(!showGP)}
              className={`px-3 py-2 rounded-lg text-xs font-medium border transition-all ${
                showGP
                  ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
                  : 'bg-[#1a1a1a] border-neutral-700 text-neutral-500 hover:border-[#C8B89A]'
              }`}
            >
              {showGP ? `GP (${grossMarginPct}% margin)` : 'Revenue'}
            </button>

            {/* NC Share */}
            <div className="flex items-center gap-2">
              <label className="text-xs text-neutral-500">NC%</label>
              <input
                type="number"
                value={ncShare}
                onChange={e => setNcShare(Number(e.target.value) || 60)}
                min={1} max={100}
                className="w-16 bg-[#1a1a1a] border border-neutral-700 text-gray-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:border-[#C8B89A]"
              />
              {suggestedNcPct !== null && Math.abs(suggestedNcPct - ncShare) > 5 && (
                <button
                  onClick={() => setNcShare(suggestedNcPct)}
                  className="text-[10px] text-[#C8B89A] hover:underline"
                  title={`Based on actual NC/RC order ratio from Shopify data`}
                >
                  suggest {suggestedNcPct}%
                </button>
              )}
            </div>
          </div>
        </div>

        {/* KPI Cards */}
        {kpis && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-3 mb-6">
            <KpiCard label="Total New Customers" value={fmt(kpis.totalNC)} sub={`across ${cohorts.length} cohorts`} />
            <KpiCard label="Avg First Order" value={fmtCur(kpis.avgAOV)} sub="AOV at acquisition" />
            <KpiCard label="Repeat Rate" value={fmtPct(kpis.avgRepeat)} sub="2+ orders" />
            <KpiCard label="Avg LTV" value={fmtCur(showGP ? kpis.avgGPLTV : kpis.avgLTV)} sub={`${fmt(kpis.ltvMult, 2)}× first order`} />
            <KpiCard label="Avg CAC" value={kpis.avgCAC != null ? fmtCur(kpis.avgCAC) : '—'} sub="ad spend ÷ NC" />
            <div className="bg-[#111] border border-[#1a1a1a] rounded-xl p-4">
              <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-1">
                {showGP ? 'GP' : 'Rev'} LTV:CAC
              </div>
              <div className="text-xl font-bold">
                {kpis.avgCAC != null ? (
                  <span className={`inline-block px-2 py-0.5 rounded ${ltvCacBg(showGP ? kpis.avgGPLTVCAC : kpis.avgLTVCAC)} text-sm font-semibold`}>
                    {fmt(showGP ? kpis.avgGPLTVCAC : kpis.avgLTVCAC, 1)}×
                  </span>
                ) : (
                  <span className="text-neutral-500 text-sm">No CAC data</span>
                )}
              </div>
              <div className="text-[11px] text-neutral-500 mt-1">
                {kpis.avgCAC != null ? ltvCacLabel(showGP ? kpis.avgGPLTVCAC : kpis.avgLTVCAC) : 'Missing ad spend data'}
              </div>
            </div>
            {showGP && (
              <KpiCard label="Gross Margin" value={`${grossMarginPct}%`} sub="from brand settings" />
            )}
          </div>
        )}

        {/* Cohort Table */}
        {cohorts.length > 0 && (
          <div className="bg-[#111] border border-[#1a1a1a] rounded-xl overflow-x-auto mb-6">
            <div className="px-4 pt-4 pb-1 text-sm font-semibold text-white">
              Cohort Analysis — Cumulative {showGP ? 'Gross Profit' : 'Revenue'} per Customer
            </div>
            <div className="px-4 pb-3 text-xs text-neutral-500">
              Each cell shows average cumulative {showGP ? 'gross profit' : 'spend'} per customer at that age, colored by LTV multiplier vs first order
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr>
                  <th className="text-left px-3 py-2 border-b border-[#1a1a1a] text-neutral-500 text-[10px] uppercase tracking-wider">Cohort</th>
                  <th className="text-right px-3 py-2 border-b border-[#1a1a1a] text-neutral-500 text-[10px] uppercase tracking-wider">NC</th>
                  <th className="text-right px-3 py-2 border-b border-[#1a1a1a] text-neutral-500 text-[10px] uppercase tracking-wider">CAC</th>
                  {periodLabels.map(p => (
                    <th key={p} className="text-right px-3 py-2 border-b border-[#1a1a1a] text-neutral-500 text-[10px] uppercase tracking-wider">{p}</th>
                  ))}
                  <th className="text-right px-3 py-2 border-b border-[#1a1a1a] text-neutral-500 text-[10px] uppercase tracking-wider">
                    {showGP ? 'GP' : 'Rev'} LTV:CAC
                  </th>
                  <th className="text-right px-3 py-2 border-b border-[#1a1a1a] text-neutral-500 text-[10px] uppercase tracking-wider">Payback</th>
                  <th className="text-left px-3 py-2 border-b border-[#1a1a1a] text-neutral-500 text-[10px] uppercase tracking-wider">Status</th>
                </tr>
              </thead>
              <tbody>
                {cohorts.map((c, i) => {
                  const displayData = showGP ? c.cumGPPerCust : c.cumRevPerCust;
                  const ratio = showGP ? c.gpLtvCacRatio : c.ltvCacRatio;
                  return (
                    <tr key={i} className="border-b border-[#1a1a1a] last:border-b-0">
                      <td className="px-3 py-2 text-[#C8B89A] font-medium">{c.label}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(c.ncCustomers)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{c.cac != null ? fmtCur(c.cac) : <span className="text-neutral-600">—</span>}</td>
                      {periodIndices.map((pi, j) => {
                        const val = displayData[pi];
                        const baseVal = displayData[0] || 1;
                        const style = pi === 0 ? {} : heatStyle(val, baseVal);
                        return (
                          <td key={j} className="px-3 py-2 text-right tabular-nums rounded" style={style}>
                            {fmtCur(val)}
                          </td>
                        );
                      })}
                      <td className="px-3 py-2 text-right">
                        {c.cac != null && ratio > 0 ? (
                          <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${ltvCacBg(ratio)}`}>
                            {fmt(ratio, 1)}×
                          </span>
                        ) : (
                          <span className="text-neutral-600">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {c.paybackMonth !== null ? (
                          <span className={c.paybackMonth <= 3 ? 'text-emerald-400' : c.paybackMonth <= 6 ? 'text-[#C8B89A]' : 'text-red-400'}>
                            M{c.paybackMonth}
                          </span>
                        ) : c.cac != null ? (
                          <span className="text-red-400 text-[10px]">Not yet</span>
                        ) : (
                          <span className="text-neutral-600">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {c.cac != null && ratio > 0 ? (
                          <span className={`text-[11px] ${ltvCacClass(ratio)}`}>
                            {ltvCacLabel(ratio)}
                          </span>
                        ) : (
                          <span className="text-neutral-600 text-[11px]">No CAC</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Info callout */}
        <div className="flex items-start gap-2 bg-[#111] border border-[#1a1a1a] rounded-xl p-4 mb-6">
          <Info size={16} className="text-[#C8B89A] mt-0.5 shrink-0" />
          <div className="text-xs text-neutral-400">
            <strong className="text-neutral-300">LTV:CAC Benchmarks ({showGP ? 'Gross Profit' : 'Revenue'}):</strong>{' '}
            <span className="text-emerald-400">≥ 3× Healthy</span> — sustainable growth.{' '}
            <span className="text-[#C8B89A]">2–3× Acceptable</span> — watch margins.{' '}
            <span className="text-red-400">&lt; 2× Over-Acquiring</span> — losing money on acquisition.
            {showGP ? (
              <> Uses gross profit LTV (revenue × {grossMarginPct}% margin) for accurate unit economics.</>
            ) : (
              <> Toggle to GP view for profit-based LTV:CAC — revenue-based ratios overstate health.</>
            )}
            <br />
            <span className="text-neutral-500 mt-1 block">
              Payback = month where cumulative gross profit per customer ≥ CAC.
              Customers deduplicated by email. Voided orders excluded. Uses subtotal (after discounts, before tax/shipping).
            </span>
          </div>
        </div>

        {/* Empty state */}
        {!cohorts.length && !loading && (
          <div className="text-center py-20 text-neutral-500">
            <Users size={48} className="mx-auto mb-4 opacity-30" />
            <p className="text-lg">No cohort data available</p>
            <p className="text-sm mt-2">Select a brand with Shopify order data to view LTV cohorts</p>
          </div>
        )}
      </div>
    </Navbar>
  );
}

// ─── Sub-components ─────────────────────────────────────────────

function KpiCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="bg-[#111] border border-[#1a1a1a] rounded-xl p-4">
      <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-1">{label}</div>
      <div className="text-xl font-bold tabular-nums">{value}</div>
      <div className="text-[11px] text-neutral-500 mt-1">{sub}</div>
    </div>
  );
}
