'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  Loader,
  Users,
  DollarSign,
  TrendingUp,
  RefreshCw,
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
  shopify_gross_margin_pct: number;
}

interface CohortRow {
  label: string;
  ncCustomers: number;
  firstOrderAOV: number;
  cumRevPerCust: (number | null)[];
  repeatRate: number;
  adSpendMonth: number;
  cac: number;
  latestLTV: number;
  ltvCacRatio: number;
  monthsAge: number;
}

interface OrderRow {
  customer_id: string;
  total_price: number;
  shopify_created_at: string;
}

interface DailyPnlRow {
  date: string;
  nc_orders: number;
  nc_revenue: number;
  meta_spend: number;
  google_spend: number;
  other_spend: number;
}

// ─── Helpers ────────────────────────────────────────────────────

const fmt = (n: number, d = 0) =>
  n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
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

// ─── Build Cohorts from Real Data ───────────────────────────────

function buildCohorts(
  orders: OrderRow[],
  dailyPnl: DailyPnlRow[],
  ncSharePct: number,
): CohortRow[] {
  if (!orders.length) return [];

  // Group orders by customer, find first order date
  const customerOrders: Record<string, { firstDate: Date; orders: { date: Date; amount: number }[] }> = {};
  orders.forEach(o => {
    const d = new Date(o.shopify_created_at);
    const cid = o.customer_id;
    if (!customerOrders[cid]) customerOrders[cid] = { firstDate: d, orders: [] };
    if (d < customerOrders[cid].firstDate) customerOrders[cid].firstDate = d;
    customerOrders[cid].orders.push({ date: d, amount: Number(o.total_price) });
  });

  // Group customers by acquisition month (first order month)
  const cohortMap: Record<string, {
    customers: string[];
    firstOrderTotal: number;
    cumulativeByMonth: Record<number, number>; // monthsAfter -> total rev
  }> = {};

  Object.entries(customerOrders).forEach(([cid, data]) => {
    const cohortKey = `${data.firstDate.getFullYear()}-${String(data.firstDate.getMonth() + 1).padStart(2, '0')}`;
    if (!cohortMap[cohortKey]) cohortMap[cohortKey] = { customers: [], firstOrderTotal: 0, cumulativeByMonth: {} };
    cohortMap[cohortKey].customers.push(cid);

    // Calculate cumulative revenue at each month mark
    data.orders.sort((a, b) => a.date.getTime() - b.date.getTime());
    let cumRev = 0;
    data.orders.forEach(o => {
      cumRev += o.amount;
      const monthsAfter = Math.floor((o.date.getTime() - data.firstDate.getTime()) / (30.44 * 86400000));
      const m = Math.min(monthsAfter, 12);
      cohortMap[cohortKey].cumulativeByMonth[m] = (cohortMap[cohortKey].cumulativeByMonth[m] || 0) + o.amount;
    });

    // First order revenue
    if (data.orders.length > 0) {
      cohortMap[cohortKey].firstOrderTotal += data.orders[0].amount;
    }
  });

  // Build pnl by month for ad spend
  const pnlByMonth: Record<string, { totalSpend: number; ncOrders: number }> = {};
  dailyPnl.forEach(row => {
    const d = new Date(row.date);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (!pnlByMonth[key]) pnlByMonth[key] = { totalSpend: 0, ncOrders: 0 };
    pnlByMonth[key].totalSpend += Number(row.meta_spend || 0) + Number(row.google_spend || 0) + Number(row.other_spend || 0);
    pnlByMonth[key].ncOrders += Number(row.nc_orders || 0);
  });

  // Sort cohort keys chronologically
  const sortedKeys = Object.keys(cohortMap).sort();
  const now = new Date();

  return sortedKeys.map(key => {
    const cohort = cohortMap[key];
    const [year, month] = key.split('-').map(Number);
    const cohortDate = new Date(year, month - 1, 1);
    const monthsAge = Math.floor((now.getTime() - cohortDate.getTime()) / (30.44 * 86400000));
    const label = cohortDate.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });

    const ncCustomers = cohort.customers.length;
    const firstOrderAOV = ncCustomers > 0 ? cohort.firstOrderTotal / ncCustomers : 0;

    // Build cumulative rev per customer array [M0, M1, M2, ... M12]
    const cumRevPerCust: (number | null)[] = [];
    let runningTotal = 0;
    for (let m = 0; m <= 12; m++) {
      if (m > monthsAge) { cumRevPerCust.push(null); continue; }
      runningTotal += cohort.cumulativeByMonth[m] || 0;
      cumRevPerCust.push(ncCustomers > 0 ? runningTotal / ncCustomers : 0);
    }

    // Repeat rate: customers with 2+ orders
    const repeatCustomers = cohort.customers.filter(cid =>
      customerOrders[cid].orders.length >= 2
    ).length;
    const repeatRate = ncCustomers > 0 ? repeatCustomers / ncCustomers : 0;

    // CAC from pnl data
    const pnl = pnlByMonth[key];
    const adSpendMonth = pnl ? pnl.totalSpend : 0;
    const pnlNC = pnl ? pnl.ncOrders : ncCustomers;
    const cac = pnlNC > 0 ? (adSpendMonth * ncSharePct / 100) / pnlNC : 0;

    const latestLTV = cumRevPerCust.filter(v => v !== null).pop() as number || firstOrderAOV;
    const ltvCacRatio = cac > 0 ? latestLTV / cac : 0;

    return {
      label, ncCustomers, firstOrderAOV, cumRevPerCust, repeatRate,
      adSpendMonth, cac, latestLTV, ltvCacRatio, monthsAge,
    };
  });
}

// ─── Component ──────────────────────────────────────────────────

export default function LTVCohortPage() {
  const router = useRouter();
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [selectedBrand, setSelectedBrand] = useState<string>('');
  const [ncShare, setNcShare] = useState(60);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [dailyPnl, setDailyPnl] = useState<DailyPnlRow[]>([]);

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

      if (profile?.brand_id) {
        setSelectedBrand(profile.brand_id);
      }

      const { data: brandList } = await supabase
        .from('brands')
        .select('id, name, slug, shopify_gross_margin_pct');

      if (brandList) setBrands(brandList);
    }
    init();
  }, []);

  // Load data when brand changes
  useEffect(() => {
    if (!selectedBrand) return;
    async function fetchData() {
      setLoading(true);

      const [ordersRes, pnlRes] = await Promise.all([
        supabase
          .from('shopify_orders')
          .select('customer_id, total_price, shopify_created_at')
          .eq('brand_id', selectedBrand)
          .order('shopify_created_at', { ascending: true }),
        supabase
          .from('daily_pnl')
          .select('date, nc_orders, nc_revenue, meta_spend, google_spend, other_spend')
          .eq('brand_id', selectedBrand)
          .order('date', { ascending: true }),
      ]);

      if (ordersRes.data) setOrders(ordersRes.data);
      if (pnlRes.data) setDailyPnl(pnlRes.data);
      setLoading(false);
    }
    fetchData();
  }, [selectedBrand]);

  const cohorts = useMemo(
    () => buildCohorts(orders, dailyPnl, ncShare),
    [orders, dailyPnl, ncShare]
  );

  // KPI aggregates
  const kpis = useMemo(() => {
    if (!cohorts.length) return null;
    const totalNC = cohorts.reduce((s, c) => s + c.ncCustomers, 0);
    const avgAOV = cohorts.reduce((s, c) => s + c.firstOrderAOV, 0) / cohorts.length;
    const avgRepeat = cohorts.reduce((s, c) => s + c.repeatRate, 0) / cohorts.length;
    const avgLTV = cohorts.reduce((s, c) => s + c.latestLTV, 0) / cohorts.length;
    const avgCAC = cohorts.reduce((s, c) => s + c.cac, 0) / cohorts.length;
    const avgLTVCAC = avgCAC > 0 ? avgLTV / avgCAC : 0;
    return { totalNC, avgAOV, avgRepeat, avgLTV, avgCAC, avgLTVCAC, ltvMult: avgAOV > 0 ? avgLTV / avgAOV : 0 };
  }, [cohorts]);

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
              Customer lifetime value by acquisition cohort — cumulative revenue per customer over time
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
            </div>
          </div>
        </div>

        {/* KPI Cards */}
        {kpis && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
            <KpiCard label="Total New Customers" value={fmt(kpis.totalNC)} sub={`across ${cohorts.length} cohorts`} />
            <KpiCard label="Avg First Order" value={fmtCur(kpis.avgAOV)} sub="AOV at acquisition" />
            <KpiCard label="Repeat Rate" value={fmtPct(kpis.avgRepeat)} sub="2+ orders" />
            <KpiCard label="Avg LTV" value={fmtCur(kpis.avgLTV)} sub={`${fmt(kpis.ltvMult, 2)}× first order`} />
            <KpiCard label="Avg CAC" value={fmtCur(kpis.avgCAC)} sub="ad spend ÷ NC" />
            <div className="bg-[#111] border border-[#1a1a1a] rounded-xl p-4">
              <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-1">LTV : CAC</div>
              <div className="text-xl font-bold">
                <span className={`inline-block px-2 py-0.5 rounded ${ltvCacBg(kpis.avgLTVCAC)} text-sm font-semibold`}>
                  {fmt(kpis.avgLTVCAC, 1)}×
                </span>
              </div>
              <div className="text-[11px] text-neutral-500 mt-1">{ltvCacLabel(kpis.avgLTVCAC)}</div>
            </div>
          </div>
        )}

        {/* Cohort Table */}
        <div className="bg-[#111] border border-[#1a1a1a] rounded-xl overflow-x-auto mb-6">
          <div className="px-4 pt-4 pb-1 text-sm font-semibold text-white">
            Cohort Analysis — Cumulative Revenue per Customer
          </div>
          <div className="px-4 pb-3 text-xs text-neutral-500">
            Each cell shows average cumulative spend per customer at that age, colored by LTV multiplier vs first order
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
                <th className="text-right px-3 py-2 border-b border-[#1a1a1a] text-neutral-500 text-[10px] uppercase tracking-wider">LTV:CAC</th>
                <th className="text-left px-3 py-2 border-b border-[#1a1a1a] text-neutral-500 text-[10px] uppercase tracking-wider">Status</th>
              </tr>
            </thead>
            <tbody>
              {cohorts.map((c, i) => (
                <tr key={i} className="border-b border-[#1a1a1a] last:border-b-0">
                  <td className="px-3 py-2 text-[#C8B89A] font-medium">{c.label}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(c.ncCustomers)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtCur(c.cac)}</td>
                  {periodIndices.map((pi, j) => {
                    const val = c.cumRevPerCust[pi];
                    const style = pi === 0 ? {} : heatStyle(val, c.cumRevPerCust[0] || 1);
                    return (
                      <td key={j} className="px-3 py-2 text-right tabular-nums rounded" style={style}>
                        {fmtCur(val)}
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 text-right">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${ltvCacBg(c.ltvCacRatio)}`}>
                      {fmt(c.ltvCacRatio, 1)}×
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`text-[11px] ${ltvCacClass(c.ltvCacRatio)}`}>
                      {ltvCacLabel(c.ltvCacRatio)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Info callout */}
        <div className="flex items-start gap-2 bg-[#111] border border-[#1a1a1a] rounded-xl p-4 mb-6">
          <Info size={16} className="text-[#C8B89A] mt-0.5 shrink-0" />
          <div className="text-xs text-neutral-400">
            <strong className="text-neutral-300">LTV:CAC Benchmarks:</strong>{' '}
            <span className="text-emerald-400">≥ 3× Healthy</span> — sustainable growth.{' '}
            <span className="text-[#C8B89A]">2–3× Acceptable</span> — watch margins.{' '}
            <span className="text-red-400">&lt; 2× Over-Acquiring</span> — losing money on acquisition.
            CAC is calculated as (monthly ad spend × NC share %) ÷ new customers acquired that month.
            LTV uses cumulative revenue per customer from Shopify order data.
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
