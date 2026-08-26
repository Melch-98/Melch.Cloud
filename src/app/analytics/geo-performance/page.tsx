'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  Loader, ChevronDown, ChevronRight, Check, RefreshCw,
  DollarSign, TrendingUp, Globe, ShoppingCart, Target,
  Activity, Layers, Play, Pause, X, AlertTriangle,
  BarChart3,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts';
import Navbar from '@/components/Navbar';
import { createClient } from '@/lib/supabase';

// ─── Design Tokens ──────────────────────────────────────────────
const GOLD = '#C8B89A';
const GOLD_DIM = 'rgba(200,184,154,0.08)';
const GREEN = '#22C55E';
const RED = '#EF4444';
const BLUE = '#60A5FA';
const PURPLE = '#A78BFA';
const AMBER = '#F59E0B';

// ─── Types ──────────────────────────────────────────────────────

interface Brand {
  id: string;
  name: string;
  slug: string;
}

interface CampaignRow {
  campaign_id: string;
  campaign_name: string;
  campaign_type: string;
  status: string;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  purchases: number;
  purchase_value: number;
  roas: number;
  meta_currency: string;
  normalized_spend: number;
  normalized_revenue: number;
  normalized_roas: number;
}

interface CountryRow {
  country: string;
  country_name: string;
  flag: string;
  meta_spend: number;
  meta_currency: string;
  meta_purchases: number;
  meta_purchase_value: number;
  shopify_revenue: number;
  shopify_currency: string;
  shopify_orders: number;
  normalized_spend: number;
  normalized_revenue: number;
  normalized_roas: number;
  campaigns: CampaignRow[];
  campaign_count: number;
  spend_share: number;
}

interface GeoResponse {
  countries: CountryRow[];
  totals: {
    normalized_spend: number;
    normalized_revenue: number;
    normalized_roas: number;
    total_orders: number;
    total_purchases: number;
    base_currency: string;
    country_count: number;
    campaign_count: number;
  };
  base_currency: string;
  fx_rates: Record<string, number>;
  date_range: { from: string; to: string };
  errors?: string[];
}

type DateRange = 'last_7d' | 'last_14d' | 'last_30d' | 'last_90d' | 'this_month';

const DATE_RANGES: { value: DateRange; label: string }[] = [
  { value: 'last_7d', label: 'Last 7 Days' },
  { value: 'last_14d', label: 'Last 14 Days' },
  { value: 'last_30d', label: 'Last 30 Days' },
  { value: 'last_90d', label: 'Last 90 Days' },
  { value: 'this_month', label: 'This Month' },
];

// ─── Formatters ─────────────────────────────────────────────────

const cSym = (code: string): string => {
  const m: Record<string, string> = {
    USD: '$', CAD: 'C$', GBP: '£', EUR: '€', AUD: 'A$', NZD: 'NZ$',
    CHF: 'CHF', SEK: 'kr', NOK: 'kr', DKK: 'kr', JPY: '¥',
  };
  return m[code] || code;
};

const fmtCurrency = (n: number, sym = '$') => {
  if (Math.abs(n) >= 1000000) return `${sym}${(n / 1000000).toFixed(2)}M`;
  if (Math.abs(n) >= 10000) return `${sym}${(n / 1000).toFixed(1)}K`;
  return `${sym}${n.toFixed(2)}`;
};
const fmtCompact = (n: number, sym = '$') => {
  if (Math.abs(n) >= 1000000) return `${sym}${(n / 1000000).toFixed(1)}M`;
  if (Math.abs(n) >= 1000) return `${sym}${(n / 1000).toFixed(1)}K`;
  return `${sym}${n.toFixed(0)}`;
};
const fmtNum = (n: number) => n.toLocaleString();
const fmtPct = (n: number) => `${n.toFixed(1)}%`;
const fmtRoas = (n: number) => `${n.toFixed(2)}x`;
const fmtDec = (n: number) => n.toFixed(1);

// ─── Status Badge ───────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const s = status.toUpperCase();
  const isActive = s === 'ACTIVE';
  const isPaused = s === 'PAUSED' || s === 'PAUSED_BY_USER';
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider"
      style={{
        backgroundColor: isActive ? 'rgba(34,197,94,0.12)' : isPaused ? 'rgba(245,158,11,0.12)' : 'rgba(255,255,255,0.06)',
        color: isActive ? GREEN : isPaused ? AMBER : '#666',
      }}
    >
      {isActive ? <Play size={8} /> : isPaused ? <Pause size={8} /> : null}
      {status.replace(/_/g, ' ')}
    </span>
  );
}

// ─── Objective Badge ────────────────────────────────────────────

function ObjectiveBadge({ objective }: { objective: string }) {
  const label = objective.replace('OUTCOME_', '').replace(/_/g, ' ');
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-[9px] font-medium uppercase tracking-wider"
      style={{
        backgroundColor: 'rgba(200,184,154,0.08)',
        color: '#999',
        border: '1px solid rgba(255,255,255,0.04)',
      }}
    >
      {label}
    </span>
  );
}

// ─── Summary Card ───────────────────────────────────────────────

function SummaryCard({ label, value, sub, icon, color }: {
  label: string; value: string; sub: string; icon: React.ReactNode; color: string;
}) {
  return (
    <div
      className="rounded-xl p-4"
      style={{ backgroundColor: '#111111', border: '1px solid rgba(255,255,255,0.06)' }}
    >
      <div className="flex items-center gap-2 mb-2" style={{ color }}>
        {icon}
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">{label}</span>
      </div>
      <div className="text-xl font-bold text-[#F5F5F8] mb-1">{value}</div>
      <div className="text-xs text-gray-500">{sub}</div>
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────

export default function GeoPerformancePage() {
  const router = useRouter();
  const supabase = createClient();

  const [brands, setBrands] = useState<Brand[]>([]);
  const [selectedBrandId, setSelectedBrandId] = useState('');
  const [dateRange, setDateRange] = useState<DateRange>('last_30d');
  const [baseCurrency, setBaseCurrency] = useState('USD');

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<GeoResponse | null>(null);
  const [authToken, setAuthToken] = useState('');
  const [profile, setProfile] = useState<{ role: string; brand_id: string } | null>(null);

  // Expanded countries
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Dropdowns
  const [brandOpen, setBrandOpen] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);

  // ── Init ──

  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push('/'); return; }
      setAuthToken(session.access_token);

      const { data: prof } = await supabase
        .from('users_profile')
        .select('role, brand_id')
        .eq('id', session.user.id)
        .single();
      if (prof) setProfile(prof);

      const { data: blist } = await supabase
        .from('brands')
        .select('id, name, slug')
        .is('archived_at', null)
        .order('name');

      if (blist) {
        setBrands(blist);
        const saved = localStorage.getItem('melch_selected_brand_geo');
        if (saved && blist.find((b: any) => b.id === saved)) setSelectedBrandId(saved);
        else if (prof?.brand_id && blist.find((b: any) => b.id === prof.brand_id)) setSelectedBrandId(prof.brand_id);
        else if (blist.length > 0) setSelectedBrandId(blist[0].id);
      }
    };
    init();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fetch ──

  useEffect(() => {
    if (!selectedBrandId || !authToken) return;
    const fetchData = async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/geo-performance?brandId=${selectedBrandId}&dateRange=${dateRange}&baseCurrency=${baseCurrency}`,
          { headers: { Authorization: `Bearer ${authToken}` } }
        );
        const json = await res.json();
        if (res.ok) setData(json);
      } catch { /* handled by error state */ }
      setLoading(false);
    };
    fetchData();
  }, [selectedBrandId, dateRange, baseCurrency, authToken]);

  useEffect(() => {
    if (selectedBrandId) localStorage.setItem('melch_selected_brand_geo', selectedBrandId);
  }, [selectedBrandId]);

  // ── Chart data: top 6 countries by spend ──

  const chartData = useMemo(() => {
    if (!data) return [];
    return data.countries.slice(0, 6).map((c) => ({
      country: c.country,
      name: c.country_name,
      spend: c.normalized_spend,
      revenue: c.normalized_revenue,
      roas: c.normalized_roas,
    }));
  }, [data]);

  const symbol = cSym(baseCurrency);
  const selBrand = brands.find((b) => b.id === selectedBrandId);
  const dateLabel = DATE_RANGES.find((d) => d.value === dateRange)?.label || '';

  // ── Toggle country ──

  const toggleCountry = (cc: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(cc)) next.delete(cc);
      else next.add(cc);
      return next;
    });
  };

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#0A0A0A' }}>
      <Navbar>
        <div className="p-6 max-w-7xl mx-auto">
          {/* ── Header ── */}
          <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
            <div>
              <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                <Globe size={24} style={{ color: GOLD }} />
                Geo Performance
              </h1>
              <p className="text-sm text-gray-400 mt-1">
                Meta campaign performance by country — drill down to make spend decisions
              </p>
            </div>
            <button
              onClick={() => {
                if (selectedBrandId && authToken) {
                  setLoading(true);
                  fetch(`/api/geo-performance?brandId=${selectedBrandId}&dateRange=${dateRange}&baseCurrency=${baseCurrency}`, {
                    headers: { Authorization: `Bearer ${authToken}` },
                  }).then((r) => r.json()).then((j) => { setData(j); setLoading(false); });
                }
              }}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all"
              style={{
                backgroundColor: GOLD_DIM,
                color: GOLD,
                border: '1px solid rgba(200,184,154,0.2)',
              }}
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>

          {/* ── Controls ── */}
          <div className="flex flex-wrap items-center gap-3 mb-6">
            {/* Brand */}
            <div className="relative">
              <button
                onClick={() => { setBrandOpen(!brandOpen); setDateOpen(false); }}
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium"
                style={{ backgroundColor: '#111111', border: '1px solid rgba(255,255,255,0.08)', color: '#F5F5F8' }}
              >
                {selBrand?.name || 'Select Brand'}
                <ChevronDown size={14} className={brandOpen ? 'rotate-180 transition-transform' : 'transition-transform'} />
              </button>
              {brandOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setBrandOpen(false)} />
                  <div
                    className="absolute top-full left-0 mt-1 w-56 rounded-lg z-20 py-1 max-h-64 overflow-y-auto"
                    style={{ backgroundColor: '#111111', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }}
                  >
                    {brands.map((b) => (
                      <button
                        key={b.id}
                        onClick={() => { setSelectedBrandId(b.id); setBrandOpen(false); }}
                        className="w-full flex items-center gap-2 px-4 py-2 text-sm transition-colors text-left"
                        style={{ color: b.id === selectedBrandId ? GOLD : '#888', backgroundColor: b.id === selectedBrandId ? GOLD_DIM : 'transparent' }}
                      >
                        {b.id === selectedBrandId && <Check size={14} style={{ color: GOLD }} />}
                        <span className={b.id === selectedBrandId ? '' : 'ml-[22px]'}>{b.name}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Date */}
            <div className="relative">
              <button
                onClick={() => { setDateOpen(!dateOpen); setBrandOpen(false); }}
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium"
                style={{ backgroundColor: '#111111', border: '1px solid rgba(255,255,255,0.08)', color: '#F5F5F8' }}
              >
                {dateLabel}
                <ChevronDown size={14} className={dateOpen ? 'rotate-180 transition-transform' : 'transition-transform'} />
              </button>
              {dateOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setDateOpen(false)} />
                  <div
                    className="absolute top-full left-0 mt-1 w-48 rounded-lg z-20 py-1"
                    style={{ backgroundColor: '#111111', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }}
                  >
                    {DATE_RANGES.map((d) => (
                      <button
                        key={d.value}
                        onClick={() => { setDateRange(d.value); setDateOpen(false); }}
                        className="w-full flex items-center gap-2 px-4 py-2 text-sm transition-colors text-left"
                        style={{ color: d.value === dateRange ? GOLD : '#888', backgroundColor: d.value === dateRange ? GOLD_DIM : 'transparent' }}
                      >
                        {d.value === dateRange && <Check size={14} style={{ color: GOLD }} />}
                        <span className={d.value === dateRange ? '' : 'ml-[22px]'}>{d.label}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            {loading && <Loader size={18} className="animate-spin text-gray-500" />}
          </div>

          {/* ── Errors ── */}
          {data?.errors && data.errors.length > 0 && (
            <div
              className="mb-6 p-4 rounded-lg flex items-start gap-3"
              style={{ backgroundColor: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}
            >
              <AlertTriangle size={16} style={{ color: RED, flexShrink: 0, marginTop: 1 }} />
              <div className="text-sm" style={{ color: '#FCA5A5' }}>
                {data.errors.map((e, i) => <div key={i}>{e}</div>)}
              </div>
            </div>
          )}

          {/* ── Summary Cards ── */}
          {data && !loading && (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-8">
              <SummaryCard
                label="Total Spend"
                value={fmtCompact(data.totals.normalized_spend, symbol)}
                sub={`${data.totals.country_count} countries`}
                icon={<DollarSign size={18} />}
                color={GOLD}
              />
              <SummaryCard
                label="Total Revenue"
                value={fmtCompact(data.totals.normalized_revenue, symbol)}
                sub={`${fmtNum(data.totals.total_orders)} orders`}
                icon={<ShoppingCart size={18} />}
                color={BLUE}
              />
              <SummaryCard
                label="Blended ROAS"
                value={fmtRoas(data.totals.normalized_roas)}
                sub={`${data.totals.normalized_roas >= 1.5 ? 'Healthy' : data.totals.normalized_roas >= 1 ? 'Marginal' : 'Underwater'}`}
                icon={<TrendingUp size={18} />}
                color={data.totals.normalized_roas >= 1 ? GREEN : RED}
              />
              <SummaryCard
                label="Meta Purchases"
                value={fmtNum(data.totals.total_purchases)}
                sub={`${data.totals.campaign_count} campaigns`}
                icon={<Target size={18} />}
                color={PURPLE}
              />
              <SummaryCard
                label="Top Country"
                value={data.countries.length > 0 ? `${data.countries[0].flag} ${data.countries[0].country_name}` : '—'}
                sub={data.countries.length > 0 ? `${fmtPct(data.countries[0].spend_share)} of spend` : ''}
                icon={<Globe size={18} />}
                color={AMBER}
              />
              <SummaryCard
                label="Per-Country Avg"
                value={data.totals.country_count > 0
                  ? `${fmtCompact(data.totals.normalized_spend / data.totals.country_count, symbol)}`
                  : '—'}
                sub={`${data.totals.campaign_count > 0 ? fmtDec(data.totals.campaign_count / data.totals.country_count) : '0'} campaigns/geo`}
                icon={<BarChart3 size={18} />}
                color="#FB923C"
              />
            </div>
          )}

          {/* ── Loading ── */}
          {loading && (
            <div className="flex items-center justify-center py-20">
              <Loader size={32} className="animate-spin" style={{ color: GOLD }} />
              <span className="ml-3 text-gray-400">Loading country data...</span>
            </div>
          )}

          {/* ── Empty ── */}
          {!loading && !data && (
            <div className="flex flex-col items-center justify-center py-20 text-gray-500">
              <Globe size={48} className="mb-4 opacity-30" />
              <p>Select a brand to view geo performance</p>
            </div>
          )}

          {/* ── Chart ── */}
          {!loading && chartData.length > 0 && (
            <div
              className="rounded-xl p-5 mb-8"
              style={{ backgroundColor: '#111111', border: '1px solid rgba(255,255,255,0.06)' }}
            >
              <h3 className="text-sm font-semibold text-gray-300 mb-4">
                Top Countries — Meta Spend vs Shopify Revenue ({baseCurrency})
              </h3>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                  <XAxis
                    dataKey="country"
                    tick={{ fill: '#666', fontSize: 12 }}
                    axisLine={{ stroke: 'rgba(255,255,255,0.06)' }}
                  />
                  <YAxis
                    tick={{ fill: '#666', fontSize: 12 }}
                    axisLine={{ stroke: 'rgba(255,255,255,0.06)' }}
                    tickFormatter={(v: number) => fmtCompact(v, symbol)}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#1a1a1a',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '8px',
                      fontSize: '13px',
                    }}
                    formatter={(value: any, name: any) => [
                      fmtCurrency(Number(value), symbol),
                      String(name),
                    ]}
                  />
                  <Bar dataKey="spend" name="Spend" fill={GOLD} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="revenue" name="Revenue" fill={BLUE} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* ── Country List ── */}
          {!loading && data && data.countries.length > 0 && (
            <div className="space-y-2">
              {/* Column headers — subtle */}
              <div className="flex items-center px-4 py-2 text-[10px] font-medium text-gray-600 uppercase tracking-wider">
                <div className="w-8" />
                <div className="flex-1">Country</div>
                <div className="w-28 text-right">Spend</div>
                <div className="w-28 text-right">Revenue</div>
                <div className="w-16 text-right">ROAS</div>
                <div className="w-16 text-right hidden sm:block">Orders</div>
                <div className="w-16 text-right hidden sm:block">Purchases</div>
                <div className="w-20 text-right hidden md:block">Campaigns</div>
                <div className="w-24 hidden lg:block" />
              </div>

              {data.countries.map((country, i) => {
                const isExp = expanded.has(country.country);
                const maxSpend = data.countries[0]?.normalized_spend || 1;
                const barPct = Math.min((country.normalized_spend / maxSpend) * 100, 100);
                const hasCurrencyMismatch = country.meta_currency !== country.shopify_currency;

                return (
                  <div key={country.country}>
                    {/* Country row — clickable */}
                    <button
                      onClick={() => toggleCountry(country.country)}
                      className="w-full rounded-xl transition-all group"
                      style={{
                        backgroundColor: isExp ? 'rgba(200,184,154,0.04)' : '#111111',
                        border: `1px solid ${isExp ? 'rgba(200,184,154,0.2)' : 'rgba(255,255,255,0.06)'}`,
                      }}
                    >
                      <div className="flex items-center px-4 py-3.5">
                        {/* Expand chevron */}
                        <div className="w-8 flex items-center">
                          {isExp
                            ? <ChevronDown size={16} style={{ color: GOLD }} />
                            : <ChevronRight size={16} style={{ color: '#555' }} />
                          }
                        </div>

                        {/* Country identity */}
                        <div className="flex-1 flex items-center gap-2.5 min-w-0">
                          <span className="text-lg flex-shrink-0">{country.flag}</span>
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-[#F5F5F8] truncate">
                              {country.country_name || country.country}
                            </div>
                            {hasCurrencyMismatch && (
                              <div className="text-[9px] text-gray-600">
                                {country.meta_spend > 0 ? `Meta: ${country.meta_currency}` : ''}
                                {country.meta_spend > 0 && country.shopify_revenue > 0 ? ' · ' : ''}
                                {country.shopify_revenue > 0 ? `Shopify: ${country.shopify_currency}` : ''}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Spend */}
                        <div className="w-28 text-right">
                          <div className="text-sm font-mono font-semibold text-[#F5F5F8]">
                            {fmtCompact(country.normalized_spend, symbol)}
                          </div>
                          <div className="text-[10px] text-gray-600">{fmtPct(country.spend_share)}</div>
                        </div>

                        {/* Revenue */}
                        <div className="w-28 text-right">
                          <div className="text-sm font-mono font-semibold text-[#F5F5F8]">
                            {fmtCompact(country.normalized_revenue, symbol)}
                          </div>
                        </div>

                        {/* ROAS */}
                        <div className="w-16 text-right">
                          <span
                            className="text-sm font-mono font-bold"
                            style={{ color: country.normalized_roas >= 1.5 ? GREEN : country.normalized_roas >= 1 ? AMBER : RED }}
                          >
                            {fmtRoas(country.normalized_roas)}
                          </span>
                        </div>

                        {/* Orders (hidden on mobile) */}
                        <div className="w-16 text-right hidden sm:block">
                          <span className="text-sm font-mono text-gray-400">{fmtNum(country.shopify_orders)}</span>
                        </div>

                        {/* Meta Purchases (hidden on mobile) */}
                        <div className="w-16 text-right hidden sm:block">
                          <span className="text-sm font-mono text-gray-400">{fmtNum(country.meta_purchases)}</span>
                        </div>

                        {/* Campaign count (hidden on md-) */}
                        <div className="w-20 text-right hidden md:block">
                          <span
                            className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded"
                            style={{
                              backgroundColor: GOLD_DIM,
                              color: GOLD,
                            }}
                          >
                            <Layers size={10} />
                            {country.campaign_count}
                          </span>
                        </div>

                        {/* Spend bar (hidden on lg-) */}
                        <div className="w-24 hidden lg:block pl-3">
                          <div className="h-1.5 rounded-full" style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}>
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${barPct}%`,
                                backgroundColor: country.normalized_roas >= 1 ? GOLD : RED,
                                minWidth: barPct > 0 ? '3px' : 0,
                              }}
                            />
                          </div>
                        </div>
                      </div>
                    </button>

                    {/* Expanded campaigns */}
                    {isExp && country.campaigns.length > 0 && (
                      <div className="ml-10 mt-1 mb-2 rounded-lg overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.04)' }}>
                        <table className="w-full text-sm">
                          <thead>
                            <tr style={{ backgroundColor: 'rgba(255,255,255,0.02)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                              <th className="text-left py-2.5 px-4 text-[10px] font-medium text-gray-600 uppercase tracking-wider">
                                Campaign
                              </th>
                              <th className="text-left py-2.5 px-2 text-[10px] font-medium text-gray-600 uppercase tracking-wider hidden sm:table-cell">
                                Type
                              </th>
                              <th className="text-left py-2.5 px-2 text-[10px] font-medium text-gray-600 uppercase tracking-wider">
                                Status
                              </th>
                              <th className="text-right py-2.5 px-3 text-[10px] font-medium text-gray-600 uppercase tracking-wider">
                                Spend
                              </th>
                              <th className="text-right py-2.5 px-3 text-[10px] font-medium text-gray-600 uppercase tracking-wider hidden sm:table-cell">
                                Purchases
                              </th>
                              <th className="text-right py-2.5 px-3 text-[10px] font-medium text-gray-600 uppercase tracking-wider">
                                ROAS
                              </th>
                              <th className="text-right py-2.5 px-3 text-[10px] font-medium text-gray-600 uppercase tracking-wider hidden md:table-cell">
                                CTR
                              </th>
                              <th className="py-2.5 px-3" style={{ width: '80px' }} />
                            </tr>
                          </thead>
                          <tbody>
                            {country.campaigns.map((camp) => {
                              const campPct = country.normalized_spend > 0
                                ? (camp.normalized_spend / country.normalized_spend) * 100
                                : 0;
                              return (
                                <tr
                                  key={camp.campaign_id}
                                  className="hover:bg-white/[0.02] transition-colors"
                                  style={{ borderBottom: '1px solid rgba(255,255,255,0.02)' }}
                                >
                                  <td className="py-2.5 px-4">
                                    <div className="text-[#F5F5F8] font-medium text-[13px] truncate max-w-[200px]">
                                      {camp.campaign_name}
                                    </div>
                                  </td>
                                  <td className="py-2.5 px-2 hidden sm:table-cell">
                                    <ObjectiveBadge objective={camp.campaign_type} />
                                  </td>
                                  <td className="py-2.5 px-2">
                                    <StatusBadge status={camp.status} />
                                  </td>
                                  <td className="py-2.5 px-3 text-right font-mono text-[13px] text-[#F5F5F8]">
                                    {fmtCompact(camp.normalized_spend, symbol)}
                                    <div className="text-[10px] text-gray-600">{fmtPct(campPct)}</div>
                                  </td>
                                  <td className="py-2.5 px-3 text-right font-mono text-[13px] text-gray-400 hidden sm:table-cell">
                                    {fmtNum(camp.purchases)}
                                  </td>
                                  <td className="py-2.5 px-3 text-right font-mono text-[13px] font-bold">
                                    <span style={{ color: camp.roas >= 1.5 ? GREEN : camp.roas >= 1 ? AMBER : RED }}>
                                      {fmtRoas(camp.roas)}
                                    </span>
                                  </td>
                                  <td className="py-2.5 px-3 text-right font-mono text-[13px] text-gray-500 hidden md:table-cell">
                                    {fmtPct(camp.ctr)}
                                  </td>
                                  <td className="py-2.5 px-3">
                                    <div className="h-1 rounded-full" style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}>
                                      <div
                                        className="h-full rounded-full"
                                        style={{
                                          width: `${campPct}%`,
                                          backgroundColor: camp.roas >= 1 ? GOLD : RED,
                                          minWidth: campPct > 0 ? '2px' : 0,
                                        }}
                                      />
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* No campaigns */}
                    {isExp && country.campaigns.length === 0 && (
                      <div className="ml-10 mt-1 mb-2 rounded-lg p-4 text-sm text-gray-600 text-center"
                        style={{ backgroundColor: '#111111', border: '1px solid rgba(255,255,255,0.04)' }}>
                        No Meta campaigns found in this country for the selected period.
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Navbar>
    </div>
  );
}