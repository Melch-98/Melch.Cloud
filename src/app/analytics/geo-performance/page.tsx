'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  Loader, ChevronDown, ChevronRight, Check, RefreshCw,
  DollarSign, TrendingUp, Globe, ShoppingCart, Target,
  Activity, Layers, Play, Pause, X, AlertTriangle,
  BarChart3, Zap, TrendingDown, Minus, ArrowUp, ArrowDown,
  Gauge,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ScatterChart, Scatter, ZAxis,
} from 'recharts';
import Navbar from '@/components/Navbar';
import { createClient } from '@/lib/supabase';

const GOLD = '#C8B89A';
const GOLD_DIM = 'rgba(200,184,154,0.08)';
const GREEN = '#22C55E';
const RED = '#EF4444';
const BLUE = '#60A5FA';
const PURPLE = '#A78BFA';
const AMBER = '#F59E0B';
const PINK = '#F472B6';

interface Brand { id: string; name: string; slug: string; }

interface CampaignRow {
  campaign_id: string; campaign_name: string; campaign_type: string;
  status: string; spend: number; impressions: number; clicks: number;
  ctr: number; purchases: number; purchase_value: number; roas: number;
  meta_currency: string; normalized_spend: number; normalized_revenue: number;
  normalized_roas: number; amer: number; inc_roas: number;
  spend_rank: number; amer_rank: number;
  spend_efficiency: 'over' | 'healthy' | 'under';
}

interface CountryRow {
  country: string; country_name: string; flag: string;
  meta_spend: number; meta_currency: string; meta_purchases: number;
  meta_purchase_value: number; meta_roas: number;
  shopify_revenue: number; shopify_nc_revenue: number;
  shopify_currency: string; shopify_orders: number; shopify_nc_orders: number;
  normalized_spend: number; normalized_revenue: number;
  normalized_nc_revenue: number; normalized_roas: number;
  amer: number; inc_roas: number; roas_vs_amer_gap: number;
  spend_rank: number; amer_rank: number;
  spend_efficiency: 'over' | 'healthy' | 'under';
  campaigns: CampaignRow[]; campaign_count: number;
  spend_share: number; cta: string | null;
}

interface GeoResponse {
  countries: CountryRow[];
  totals: {
    normalized_spend: number; normalized_revenue: number;
    normalized_nc_revenue: number; normalized_roas: number;
    amer: number; inc_roas: number; total_orders: number;
    total_nc_orders: number; total_purchases: number;
    base_currency: string; country_count: number; campaign_count: number;
    brand_gross_margin_pct: number; if_factor: number;
  };
  base_currency: string; fx_rates: Record<string, number>;
  date_range: { from: string; to: string }; errors?: string[];
}

type DateRange = 'last_7d' | 'last_14d' | 'last_30d' | 'last_90d' | 'this_month';

const DATE_RANGES = [
  { value: 'last_7d' as DateRange, label: 'Last 7 Days' },
  { value: 'last_14d' as DateRange, label: 'Last 14 Days' },
  { value: 'last_30d' as DateRange, label: 'Last 30 Days' },
  { value: 'last_90d' as DateRange, label: 'Last 90 Days' },
  { value: 'this_month' as DateRange, label: 'This Month' },
];

const cSym = (code: string) => {
  const m: Record<string, string> = { USD: '$', CAD: 'C$', GBP: '£', EUR: '€', AUD: 'A$', NZD: 'NZ$', CHF: 'CHF', SEK: 'kr', NOK: 'kr', DKK: 'kr', JPY: '¥' };
  return m[code] || code;
};
const fmtCurrency = (n: number, sym = '$') => { if (Math.abs(n) >= 1e6) return `${sym}${(n/1e6).toFixed(2)}M`; if (Math.abs(n) >= 1e4) return `${sym}${(n/1e3).toFixed(1)}K`; return `${sym}${n.toFixed(2)}`; };
const fmtCompact = (n: number, sym = '$') => { if (Math.abs(n) >= 1e6) return `${sym}${(n/1e6).toFixed(1)}M`; if (Math.abs(n) >= 1e3) return `${sym}${(n/1e3).toFixed(1)}K`; return `${sym}${n.toFixed(0)}`; };
const fmtNum = (n: number) => n.toLocaleString();
const fmtPct = (n: number) => `${n.toFixed(1)}%`;
const fmtRoas = (n: number) => `${n.toFixed(2)}×`;
const fmtDec = (n: number) => n.toFixed(1);

function StatusBadge({ status }: { status: string }) {
  const s = status.toUpperCase(); const isActive = s === 'ACTIVE'; const isPaused = s === 'PAUSED' || s === 'PAUSED_BY_USER';
  return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider" style={{ backgroundColor: isActive ? 'rgba(34,197,94,0.12)' : isPaused ? 'rgba(245,158,11,0.12)' : 'rgba(255,255,255,0.06)', color: isActive ? GREEN : isPaused ? AMBER : '#666' }}>{isActive ? <Play size={8} /> : isPaused ? <Pause size={8} /> : null}{status.replace(/_/g, ' ')}</span>;
}

function ObjectiveBadge({ objective }: { objective: string }) {
  const isCapture = objective === 'Demand Capture';
  return <span className="inline-flex items-center px-2 py-0.5 rounded text-[9px] font-medium uppercase tracking-wider" style={{ backgroundColor: isCapture ? 'rgba(96,165,250,0.08)' : 'rgba(167,139,250,0.08)', color: isCapture ? BLUE : PURPLE, border: `1px solid ${isCapture ? 'rgba(96,165,250,0.15)' : 'rgba(167,139,250,0.15)'}` }}>{objective}</span>;
}

function EfficiencyBadge({ efficiency }: { efficiency: 'over' | 'healthy' | 'under' }) {
  const c = { over: { icon: <ArrowDown size={10} />, label: 'Over', bg: 'rgba(239,68,68,0.1)', color: RED }, healthy: { icon: <Minus size={10} />, label: 'Steady', bg: 'rgba(245,158,11,0.1)', color: AMBER }, under: { icon: <ArrowUp size={10} />, label: 'Scale', bg: 'rgba(34,197,94,0.1)', color: GREEN } }[efficiency];
  return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider" style={{ backgroundColor: c.bg, color: c.color }}>{c.icon}{c.label}</span>;
}

function SummaryCard({ label, value, sub, icon, color }: { label: string; value: string; sub: string; icon: React.ReactNode; color: string }) {
  return <div className="rounded-xl p-4" style={{ backgroundColor: '#111111', border: '1px solid rgba(255,255,255,0.06)' }}><div className="flex items-center gap-2 mb-2" style={{ color }}>{icon}<span className="text-xs font-medium text-gray-500 uppercase tracking-wider">{label}</span></div><div className="text-xl font-bold text-[#F5F5F8] mb-1">{value}</div><div className="text-xs text-gray-500">{sub}</div></div>;
}

export default function GeoPerformancePage() {
  const router = useRouter(); const supabase = createClient();
  const [brands, setBrands] = useState<Brand[]>([]);
  const [selectedBrandId, setSelectedBrandId] = useState('');
  const [dateRange, setDateRange] = useState<DateRange>('last_30d');
  const [baseCurrency, setBaseCurrency] = useState('USD');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<GeoResponse | null>(null);
  const [authToken, setAuthToken] = useState('');
  const [profile, setProfile] = useState<{ role: string; brand_id: string } | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [brandOpen, setBrandOpen] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);

  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push('/'); return; }
      setAuthToken(session.access_token);
      const { data: prof } = await supabase.from('users_profile').select('role, brand_id').eq('id', session.user.id).single();
      if (prof) setProfile(prof);
      const { data: blist } = await supabase.from('brands').select('id, name, slug').is('archived_at', null).order('name');
      if (blist) { setBrands(blist); const saved = localStorage.getItem('melch_sel_geo'); if (saved && blist.find((b: any) => b.id === saved)) setSelectedBrandId(saved); else if (prof?.brand_id && blist.find((b: any) => b.id === prof.brand_id)) setSelectedBrandId(prof.brand_id); else if (blist.length > 0) setSelectedBrandId(blist[0].id); }
    }; init();
  }, []); // eslint-disable-line

  const fetchData = async () => { if (!selectedBrandId || !authToken) return; setLoading(true); try { const res = await fetch(`/api/geo-performance?brandId=${selectedBrandId}&dateRange=${dateRange}&baseCurrency=${baseCurrency}`, { headers: { Authorization: `Bearer ${authToken}` } }); const json = await res.json(); if (res.ok) setData(json); } catch {} setLoading(false); };
  useEffect(() => { fetchData(); }, [selectedBrandId, dateRange, baseCurrency, authToken]); // eslint-disable-line
  useEffect(() => { if (selectedBrandId) localStorage.setItem('melch_sel_geo', selectedBrandId); }, [selectedBrandId]);

  const chartData = useMemo(() => { if (!data) return []; return data.countries.slice(0, 6).map(c => ({ country: c.country, name: c.country_name, spend: c.normalized_spend, revenue: c.normalized_nc_revenue, amer: c.amer })); }, [data]);
  const scatterData = useMemo(() => { if (!data) return []; return data.countries.map(c => ({ country: c.country, name: c.country_name, spend: c.normalized_spend, amer: c.amer, efficiency: c.spend_efficiency, cta: c.cta })); }, [data]);
  const symbol = cSym(baseCurrency); const selBrand = brands.find(b => b.id === selectedBrandId); const dateLabel = DATE_RANGES.find(d => d.value === dateRange)?.label || '';
  const toggleCountry = (cc: string) => setExpanded(prev => { const next = new Set(prev); if (next.has(cc)) next.delete(cc); else next.add(cc); return next; });

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#0A0A0A' }}>
      <Navbar>
        <div className="p-6 max-w-7xl mx-auto">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
            <div><h1 className="text-2xl font-bold text-white flex items-center gap-2"><Globe size={24} style={{ color: GOLD }} />Geo Performance</h1><p className="text-sm text-gray-400 mt-1">Country aMER · Spend efficiency · Campaign drill-down · IF={data?.totals?.if_factor || '...'}×</p></div>
            <button onClick={fetchData} disabled={loading} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium" style={{ backgroundColor: GOLD_DIM, color: GOLD, border: '1px solid rgba(200,184,154,0.2)' }}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} />Refresh</button>
          </div>

          {/* Controls */}
          <div className="flex flex-wrap items-center gap-3 mb-6">
            <div className="relative"><button onClick={() => { setBrandOpen(!brandOpen); setDateOpen(false); }} className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium" style={{ backgroundColor: '#111', border: '1px solid rgba(255,255,255,0.08)', color: '#F5F5F8' }}>{selBrand?.name || 'Select Brand'}<ChevronDown size={14} className={brandOpen ? 'rotate-180' : ''} /></button>
              {brandOpen && (<><div className="fixed inset-0 z-10" onClick={() => setBrandOpen(false)} /><div className="absolute top-full left-0 mt-1 w-56 rounded-lg z-20 py-1 max-h-64 overflow-y-auto" style={{ backgroundColor: '#111', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }}>{brands.map(b => (<button key={b.id} onClick={() => { setSelectedBrandId(b.id); setBrandOpen(false); }} className="w-full flex items-center gap-2 px-4 py-2 text-sm text-left" style={{ color: b.id === selectedBrandId ? GOLD : '#888', backgroundColor: b.id === selectedBrandId ? GOLD_DIM : 'transparent' }}>{b.id === selectedBrandId && <Check size={14} style={{ color: GOLD }} />}<span className={b.id === selectedBrandId ? '' : 'ml-[22px]'}>{b.name}</span></button>))}</div></>)}</div>
            <div className="relative"><button onClick={() => { setDateOpen(!dateOpen); setBrandOpen(false); }} className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium" style={{ backgroundColor: '#111', border: '1px solid rgba(255,255,255,0.08)', color: '#F5F5F8' }}>{dateLabel}<ChevronDown size={14} className={dateOpen ? 'rotate-180' : ''} /></button>
              {dateOpen && (<><div className="fixed inset-0 z-10" onClick={() => setDateOpen(false)} /><div className="absolute top-full left-0 mt-1 w-48 rounded-lg z-20 py-1" style={{ backgroundColor: '#111', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }}>{DATE_RANGES.map(d => (<button key={d.value} onClick={() => { setDateRange(d.value); setDateOpen(false); }} className="w-full flex items-center gap-2 px-4 py-2 text-sm text-left" style={{ color: d.value === dateRange ? GOLD : '#888', backgroundColor: d.value === dateRange ? GOLD_DIM : 'transparent' }}>{d.value === dateRange && <Check size={14} style={{ color: GOLD }} />}<span className={d.value === dateRange ? '' : 'ml-[22px]'}>{d.label}</span></button>))}</div></>)}</div>
            {loading && <Loader size={18} className="animate-spin text-gray-500" />}
          </div>

          {/* Errors */}
          {data?.errors && data.errors.length > 0 && <div className="mb-6 p-4 rounded-lg flex items-start gap-3" style={{ backgroundColor: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}><AlertTriangle size={16} style={{ color: RED, flexShrink: 0, marginTop: 1 }} /><div className="text-sm" style={{ color: '#FCA5A5' }}>{data.errors.map((e, i) => <div key={i}>{e}</div>)}</div></div>}

          {/* KB Summary Cards */}
          {data && !loading && (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3 mb-8">
              <SummaryCard label="aMER" value={fmtRoas(data.totals.amer)} sub="NC revenue ÷ spend (CTC)" icon={<Gauge size={18} />} color={data.totals.amer >= 1.5 ? GREEN : data.totals.amer >= 0.8 ? AMBER : RED} />
              <SummaryCard label="nROAS" value={fmtRoas(data.totals.normalized_roas)} sub="Blended Shopify ÷ spend" icon={<TrendingUp size={18} />} color={data.totals.normalized_roas >= 1.5 ? GREEN : data.totals.normalized_roas >= 1 ? AMBER : RED} />
              <SummaryCard label="Inc. ROAS" value={fmtRoas(data.totals.inc_roas)} sub={`nROAS × IF(${data.totals.if_factor}×)`} icon={<Zap size={18} />} color={data.totals.inc_roas >= 2 ? GREEN : data.totals.inc_roas >= 1.2 ? AMBER : RED} />
              <SummaryCard label="Total Spend" value={fmtCompact(data.totals.normalized_spend, symbol)} sub={`${data.totals.country_count} countries`} icon={<DollarSign size={18} />} color={GOLD} />
              <SummaryCard label="NC Revenue" value={fmtCompact(data.totals.normalized_nc_revenue, symbol)} sub={`${fmtNum(data.totals.total_nc_orders)} NC orders`} icon={<ShoppingCart size={18} />} color={BLUE} />
              <SummaryCard label="GM Context" value={`${data.totals.brand_gross_margin_pct}%`} sub={data.totals.brand_gross_margin_pct >= 35 ? 'Strong margin buffer' : 'Tight — watch aMER'} icon={<BarChart3 size={18} />} color={data.totals.brand_gross_margin_pct >= 35 ? GREEN : AMBER} />
              <SummaryCard label="Top Country" value={data.countries.length > 0 ? `${data.countries[0].flag} ${data.countries[0].country_name}` : '—'} sub={data.countries.length > 0 ? `${fmtPct(data.countries[0].spend_share)} spend · aMER ${fmtRoas(data.countries[0].amer)}` : ''} icon={<Globe size={18} />} color={PINK} />
              <SummaryCard label="Active Camps" value={String(data.totals.campaign_count)} sub={`${fmtDec(data.totals.campaign_count / Math.max(data.totals.country_count, 1))} per geo`} icon={<Layers size={18} />} color={GOLD} />
            </div>
          )}

          {loading && <div className="flex items-center justify-center py-20"><Loader size={32} className="animate-spin" style={{ color: GOLD }} /><span className="ml-3 text-gray-400">Loading geo performance...</span></div>}
          {!loading && !data && <div className="flex flex-col items-center justify-center py-20 text-gray-500"><Globe size={48} className="mb-4 opacity-30" /><p>Select a brand to view geo performance</p></div>}

          {/* Charts Row */}
          {!loading && chartData.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
              <div className="rounded-xl p-5" style={{ backgroundColor: '#111', border: '1px solid rgba(255,255,255,0.06)' }}>
                <h3 className="text-sm font-semibold text-gray-300 mb-4">Spend vs NC Revenue by Country ({baseCurrency})</h3>
                <ResponsiveContainer width="100%" height={260}><BarChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" /><XAxis dataKey="country" tick={{ fill: '#666', fontSize: 12 }} axisLine={{ stroke: 'rgba(255,255,255,0.06)' }} /><YAxis tick={{ fill: '#666', fontSize: 12 }} axisLine={{ stroke: 'rgba(255,255,255,0.06)' }} tickFormatter={(v: any) => fmtCompact(Number(v), symbol)} /><Tooltip contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', fontSize: '13px' }} formatter={(value: any, name: any) => [fmtCurrency(Number(value), symbol), String(name)]} /><Bar dataKey="spend" name="Spend" fill={GOLD} radius={[4, 4, 0, 0]} /><Bar dataKey="revenue" name="NC Revenue" fill={BLUE} radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer>
              </div>
              <div className="rounded-xl p-5" style={{ backgroundColor: '#111', border: '1px solid rgba(255,255,255,0.06)' }}>
                <h3 className="text-sm font-semibold text-gray-300 mb-4">Spending Power — Spend vs aMER</h3>
                {scatterData.length > 0 && <ResponsiveContainer width="100%" height={260}><ScatterChart margin={{ top: 5, right: 20, left: 10, bottom: 5 }}><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" /><XAxis dataKey="spend" name="Spend" tick={{ fill: '#666', fontSize: 11 }} axisLine={{ stroke: 'rgba(255,255,255,0.06)' }} tickFormatter={(v: any) => fmtCompact(Number(v), symbol)} type="number" /><YAxis dataKey="amer" name="aMER" tick={{ fill: '#666', fontSize: 11 }} axisLine={{ stroke: 'rgba(255,255,255,0.06)' }} tickFormatter={(v: any) => fmtRoas(Number(v))} domain={[0, 'auto']} type="number" /><ZAxis range={[60, 60]} /><Tooltip cursor={{ strokeDasharray: '3 3' }} contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', fontSize: '12px' }} formatter={(value: any, name: any) => [name === 'amer' ? fmtRoas(Number(value)) : fmtCurrency(Number(value), symbol), name === 'amer' ? 'aMER' : 'Spend']} labelFormatter={(l: any) => `Spend: ${fmtCurrency(Number(l), symbol)}`} />{['over', 'healthy', 'under'].map(eff => <Scatter key={eff} name={eff} data={scatterData.filter(d => d.efficiency === eff)} fill={eff === 'over' ? RED : eff === 'under' ? GREEN : AMBER} />)}</ScatterChart></ResponsiveContainer>}
                <div className="flex items-center gap-4 mt-2 justify-center"><span className="text-[10px] flex items-center gap-1" style={{ color: RED }}><span className="w-2 h-2 rounded-full" style={{ backgroundColor: RED }} />Overspending</span><span className="text-[10px] flex items-center gap-1" style={{ color: AMBER }}><span className="w-2 h-2 rounded-full" style={{ backgroundColor: AMBER }} />Steady</span><span className="text-[10px] flex items-center gap-1" style={{ color: GREEN }}><span className="w-2 h-2 rounded-full" style={{ backgroundColor: GREEN }} />Room to scale</span></div>
              </div>
            </div>
          )}

          {/* Country List */}
          {!loading && data && data.countries.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center px-4 py-2 text-[10px] font-medium text-gray-600 uppercase tracking-wider">
                <div className="w-8" /><div className="flex-1">Country</div><div className="w-24 text-right hidden sm:block">Spend</div><div className="w-16 text-right">aMER</div><div className="w-20 text-right">nROAS</div><div className="w-20 text-right hidden md:block">Inc. ROAS</div><div className="w-16 text-right">NC Rev</div><div className="w-20 text-center">Signal</div><div className="w-20 hidden lg:block" />
              </div>
              {data.countries.map((country) => {
                const isExp = expanded.has(country.country);
                const maxSpend = data.countries[0]?.normalized_spend || 1;
                const barPct = Math.min((country.normalized_spend / maxSpend) * 100, 100);
                const hasCurrMismatch = country.meta_currency !== country.shopify_currency;
                return (<div key={country.country}>
                  <button onClick={() => toggleCountry(country.country)} className="w-full rounded-xl transition-all" style={{ backgroundColor: isExp ? 'rgba(200,184,154,0.04)' : '#111', border: `1px solid ${isExp ? 'rgba(200,184,154,0.2)' : country.spend_efficiency === 'over' ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.06)'}` }}>
                    <div className="flex items-center px-4 py-3.5">
                      <div className="w-8">{isExp ? <ChevronDown size={16} style={{ color: GOLD }} /> : <ChevronRight size={16} style={{ color: '#555' }} />}</div>
                      <div className="flex-1 flex items-center gap-2.5 min-w-0"><span className="text-lg flex-shrink-0">{country.flag}</span><div className="min-w-0"><div className="text-sm font-semibold text-[#F5F5F8] truncate flex items-center gap-2">{country.country_name || country.country}<span className="text-[10px] font-normal" style={{ color: GOLD }}>#{country.spend_rank}</span></div>{hasCurrMismatch && <div className="text-[9px] text-gray-600">Meta: {country.meta_currency} · Shopify: {country.shopify_currency}</div>}</div></div>
                      <div className="w-24 text-right hidden sm:block"><div className="text-sm font-mono font-semibold text-[#F5F5F8]">{fmtCompact(country.normalized_spend, symbol)}</div><div className="text-[10px] text-gray-600">{fmtPct(country.spend_share)}</div></div>
                      <div className="w-16 text-right"><span className="text-sm font-mono font-bold" style={{ color: country.amer >= 1.5 ? GREEN : country.amer >= 0.8 ? AMBER : RED }}>{fmtRoas(country.amer)}</span></div>
                      <div className="w-20 text-right"><span className="text-sm font-mono text-gray-400">{fmtRoas(country.normalized_roas)}</span></div>
                      <div className="w-20 text-right hidden md:block"><span className="text-sm font-mono" style={{ color: country.inc_roas >= 2 ? GREEN : country.inc_roas >= 1.2 ? AMBER : '#888' }}>{fmtRoas(country.inc_roas)}</span></div>
                      <div className="w-16 text-right"><span className="text-sm font-mono" style={{ color: BLUE }}>{fmtCompact(country.normalized_nc_revenue, symbol)}</span></div>
                      <div className="w-20 text-center"><EfficiencyBadge efficiency={country.spend_efficiency} />{country.cta && <div className="text-[9px] text-gray-600 mt-0.5 leading-tight">{country.cta}</div>}</div>
                      <div className="w-20 hidden lg:block pl-3"><div className="h-1.5 rounded-full" style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}><div className="h-full rounded-full" style={{ width: `${barPct}%`, backgroundColor: country.spend_efficiency === 'over' ? RED : GOLD, minWidth: barPct > 0 ? '3px' : 0 }} /></div></div>
                    </div>
                  </button>
                  {isExp && (<div className="ml-10 mt-1 mb-2 rounded-lg overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.04)' }}>
                    <div className="px-4 py-3 flex flex-wrap items-center gap-4 text-[11px]" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', backgroundColor: 'rgba(255,255,255,0.01)' }}>
                      <div><span className="text-gray-600">Meta ROAS: </span><span className="font-mono" style={{ color: country.meta_roas >= 1.5 ? GREEN : country.meta_roas >= 1 ? AMBER : RED }}>{fmtRoas(country.meta_roas)}</span></div>
                      <div><span className="text-gray-600">aMER: </span><span className="font-mono font-semibold" style={{ color: country.amer >= 1.5 ? GREEN : AMBER }}>{fmtRoas(country.amer)}</span></div>
                      <div><span className="text-gray-600">RoAS−aMER: </span><span className="font-mono" style={{ color: country.roas_vs_amer_gap > 1 ? GREEN : '#888' }}>{fmtRoas(country.roas_vs_amer_gap)}</span></div>
                      <div><span className="text-gray-600">NC Orders: </span><span className="font-mono text-gray-400">{fmtNum(country.shopify_nc_orders)}</span><span className="text-gray-600">/{fmtNum(country.shopify_orders)}</span></div>
                      <div><span className="text-gray-600">Meta Purchases: </span><span className="font-mono text-gray-400">{fmtNum(country.meta_purchases)}</span></div>
                      <div><span className="text-gray-600">Spend #</span><span className="font-mono" style={{ color: GOLD }}>{country.spend_rank}</span><span className="text-gray-600"> · aMER #</span><span className="font-mono" style={{ color: BLUE }}>{country.amer_rank}</span></div>
                    </div>
                    {country.campaigns.length > 0 ? (<table className="w-full text-sm"><thead><tr style={{ backgroundColor: 'rgba(255,255,255,0.02)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}><th className="text-left py-2.5 px-4 text-[10px] font-medium text-gray-600 uppercase tracking-wider">Campaign</th><th className="text-left py-2.5 px-2 text-[10px] font-medium text-gray-600 uppercase tracking-wider hidden sm:table-cell">Objective</th><th className="text-left py-2.5 px-2 text-[10px] font-medium text-gray-600 uppercase tracking-wider">Status</th><th className="text-right py-2.5 px-3 text-[10px] font-medium text-gray-600 uppercase tracking-wider">Spend</th><th className="text-right py-2.5 px-3 text-[10px] font-medium text-gray-600 uppercase tracking-wider">aMER</th><th className="text-right py-2.5 px-3 text-[10px] font-medium text-gray-600 uppercase tracking-wider">nROAS</th><th className="text-right py-2.5 px-3 text-[10px] font-medium text-gray-600 uppercase tracking-wider hidden md:table-cell">Inc. ROAS</th><th className="text-center py-2.5 px-2 text-[10px] font-medium text-gray-600 uppercase tracking-wider">Signal</th><th className="py-2.5 px-3" style={{ width: '60px' }} /></tr></thead><tbody>{country.campaigns.map(camp => { const campPct = country.normalized_spend > 0 ? (camp.normalized_spend / country.normalized_spend) * 100 : 0; return (<tr key={camp.campaign_id} className="hover:bg-white/[0.02] transition-colors" style={{ borderBottom: '1px solid rgba(255,255,255,0.02)' }}><td className="py-2.5 px-4"><div className="text-[#F5F5F8] font-medium text-[13px] truncate max-w-[180px]">{camp.campaign_name}</div></td><td className="py-2.5 px-2 hidden sm:table-cell"><ObjectiveBadge objective={camp.campaign_type} /></td><td className="py-2.5 px-2"><StatusBadge status={camp.status} /></td><td className="py-2.5 px-3 text-right font-mono text-[13px] text-[#F5F5F8]">{fmtCompact(camp.normalized_spend, symbol)}<div className="text-[10px] text-gray-600">{fmtPct(campPct)}</div></td><td className="py-2.5 px-3 text-right font-mono text-[13px] font-bold"><span style={{ color: camp.amer >= 1.5 ? GREEN : camp.amer >= 0.8 ? AMBER : RED }}>{fmtRoas(camp.amer)}</span></td><td className="py-2.5 px-3 text-right font-mono text-[13px] text-gray-400">{fmtRoas(camp.normalized_roas)}</td><td className="py-2.5 px-3 text-right font-mono text-[13px] hidden md:table-cell" style={{ color: camp.inc_roas >= 2 ? GREEN : '#888' }}>{fmtRoas(camp.inc_roas)}</td><td className="py-2.5 px-2 text-center"><EfficiencyBadge efficiency={camp.spend_efficiency} /></td><td className="py-2.5 px-3"><div className="h-1 rounded-full" style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}><div className="h-full rounded-full" style={{ width: `${campPct}%`, backgroundColor: camp.spend_efficiency === 'over' ? RED : GOLD, minWidth: campPct > 0 ? '2px' : 0 }} /></div></td></tr>); })}</tbody></table>) : (<div className="p-4 text-sm text-gray-600 text-center">No Meta campaigns found in this country.</div>)}</div>)}
                </div>);
              })}
            </div>
          )}
        </div>
      </Navbar>
    </div>
  );
}
