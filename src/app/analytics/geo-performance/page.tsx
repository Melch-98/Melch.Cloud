'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  Loader, ChevronDown, ChevronRight, Check, RefreshCw,
  DollarSign, TrendingUp, Globe, ShoppingCart, Target,
  Layers, Play, Pause, AlertTriangle, BarChart3, Zap,
  ArrowUp, ArrowDown, Minus, Gauge, HelpCircle,
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
  raw_country: string;
}

interface CountryRow {
  country: string; country_name: string; flag: string;
  meta_spend: number; meta_purchases: number; meta_purchase_value: number;
  meta_roas: number; meta_currency: string;
  shopify_revenue: number; shopify_nc_revenue: number;
  shopify_currency: string; shopify_orders: number; shopify_nc_orders: number;
  shopify_connected: boolean;
  normalized_spend: number; normalized_revenue: number;
  normalized_nc_revenue: number; normalized_roas: number;
  amer: number | null; inc_roas: number; roas_vs_amer_gap: number | null;
  spend_rank: number; amer_rank: number;
  spend_efficiency: 'over' | 'healthy' | 'under';
  campaigns: CampaignRow[]; campaign_count: number;
  spend_share: number; cta: string | null;
}

interface GeoResponse {
  countries: CountryRow[];
  totals: {
    normalized_spend: number; normalized_revenue: number;
    normalized_nc_revenue: number; meta_roas: number; normalized_roas: number;
    amer: number | null; inc_roas: number; total_orders: number;
    total_nc_orders: number; total_purchases: number;
    base_currency: string; country_count: number; campaign_count: number;
    brand_gross_margin_pct: number; if_factor: number;
    shopify_connected: boolean;
  };
  base_currency: string; fx_rates: Record<string, number>;
  meta_currency: string;
  date_range: { from: string; to: string }; errors?: string[]; warnings?: string[];
}

type DateRange = 'last_7d' | 'last_14d' | 'last_30d' | 'last_90d' | 'this_month';
const DATE_RANGES: { value: DateRange; label: string }[] = [
  { value: 'last_7d', label: 'Last 7 Days' }, { value: 'last_14d', label: 'Last 14 Days' },
  { value: 'last_30d', label: 'Last 30 Days' }, { value: 'last_90d', label: 'Last 90 Days' },
  { value: 'this_month', label: 'This Month' },
];

const cSym = (code: string) => { const m: Record<string, string> = { USD: '$', CAD: 'C$', GBP: '£', EUR: '€', AUD: 'A$', NZD: 'NZ$' }; return m[code] || code; };
const fmtCurrency = (n: number, s = '$') => Math.abs(n) >= 1e6 ? `${s}${(n/1e6).toFixed(2)}M` : Math.abs(n) >= 1e4 ? `${s}${(n/1e3).toFixed(1)}K` : `${s}${n.toFixed(2)}`;
const fmtCompact = (n: number, s = '$') => Math.abs(n) >= 1e6 ? `${s}${(n/1e6).toFixed(1)}M` : Math.abs(n) >= 1e3 ? `${s}${(n/1e3).toFixed(1)}K` : `${s}${n.toFixed(0)}`;
const fmtNum = (n: number) => n.toLocaleString();
const fmtPct = (n: number) => `${n.toFixed(1)}%`;
const fmtRoas = (n: number) => `${n.toFixed(2)}×`;
const fmtRoasOrNA = (n: number | null) => n === null ? '—' : fmtRoas(n);
const fmtDec = (n: number) => n.toFixed(1);

function StatusBadge({ status }: { status: string }) {
  const s = status.toUpperCase(); const a = s === 'ACTIVE'; const p = s === 'PAUSED' || s === 'PAUSED_BY_USER';
  return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold uppercase" style={{ background: a ? 'rgba(34,197,94,0.12)' : p ? 'rgba(245,158,11,0.12)' : 'rgba(255,255,255,0.06)', color: a ? GREEN : p ? AMBER : '#666' }}>{a ? <Play size={8} /> : p ? <Pause size={8} /> : null}{status.replace(/_/g, ' ')}</span>;
}

function ObjBadge({ obj }: { obj: string }) {
  const isCap = obj === 'Demand Capture';
  return <span className="inline-flex items-center px-2 py-0.5 rounded text-[9px] font-medium uppercase" style={{ background: isCap ? 'rgba(96,165,250,0.08)' : 'rgba(167,139,250,0.08)', color: isCap ? BLUE : PURPLE, border: `1px solid ${isCap ? 'rgba(96,165,250,0.15)' : 'rgba(167,139,250,0.15)'}` }}>{obj}</span>;
}

function EffBadge({ eff }: { eff: 'over' | 'healthy' | 'under' }) {
  const c = { over: { icon: <ArrowDown size={10} />, label: 'Over', bg: 'rgba(239,68,68,0.1)', col: RED }, healthy: { icon: <Minus size={10} />, label: 'Steady', bg: 'rgba(245,158,11,0.1)', col: AMBER }, under: { icon: <ArrowUp size={10} />, label: 'Scale', bg: 'rgba(34,197,94,0.1)', col: GREEN } }[eff];
  return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold uppercase" style={{ background: c.bg, color: c.col }}>{c.icon}{c.label}</span>;
}

function SCard({ label, value, sub, icon, color }: { label: string; value: string; sub: string; icon: React.ReactNode; color: string }) {
  return <div className="rounded-xl p-4" style={{ background: '#111', border: '1px solid rgba(255,255,255,0.06)' }}><div className="flex items-center gap-2 mb-2" style={{ color }}>{icon}<span className="text-xs font-medium text-gray-500 uppercase tracking-wider">{label}</span></div><div className="text-xl font-bold text-[#F5F5F8] mb-1">{value}</div><div className="text-xs text-gray-500">{sub}</div></div>;
}

export default function GeoPerformancePage() {
  const router = useRouter(); const sup = createClient();
  const [brands, setBrands] = useState<Brand[]>([]);
  const [selBrandId, setSelBrandId] = useState('');
  const [dateRange, setDateRange] = useState<DateRange>('last_30d');
  const [baseCurr, setBaseCurr] = useState('USD');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<GeoResponse | null>(null);
  const [authToken, setAuthToken] = useState('');
  const [profile, setProfile] = useState<{ role: string; brand_id: string } | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [brandOpen, setBrandOpen] = useState(false); const [dateOpen, setDateOpen] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await sup.auth.getSession();
      if (!session) { router.push('/'); return; }
      setAuthToken(session.access_token);
      const { data: p } = await sup.from('users_profile').select('role, brand_id').eq('id', session.user.id).single();
      if (p) setProfile(p);
      const { data: bl } = await sup.from('brands').select('id, name, slug').is('archived_at', null).order('name');
      if (bl) { setBrands(bl); const sv = localStorage.getItem('melch_sel_geo'); if (sv && bl.find((b: any) => b.id === sv)) setSelBrandId(sv); else if (p?.brand_id && bl.find((b: any) => b.id === p.brand_id)) setSelBrandId(p.brand_id); else if (bl.length > 0) setSelBrandId(bl[0].id); }
    })();
  }, []); // eslint-disable-line

  const fetchData = async () => { if (!selBrandId || !authToken) return; setLoading(true); try { const r = await fetch(`/api/geo-performance?brandId=${selBrandId}&dateRange=${dateRange}&baseCurrency=${baseCurr}`, { headers: { Authorization: `Bearer ${authToken}` } }); const j = await r.json(); if (r.ok) setData(j); } catch {} setLoading(false); };
  useEffect(() => { fetchData(); }, [selBrandId, dateRange, baseCurr, authToken]); // eslint-disable-line
  useEffect(() => { if (selBrandId) localStorage.setItem('melch_sel_geo', selBrandId); }, [selBrandId]);

  const chartData = useMemo(() => data ? data.countries.slice(0, 6).map(c => ({ country: c.country, name: c.country_name, spend: c.normalized_spend, revenue: c.normalized_revenue })) : [], [data]);
  const scatterData = useMemo(() => data ? data.countries.map(c => ({ country: c.country, name: c.country_name, spend: c.normalized_spend, amer: c.amer ?? 0, eff: c.spend_efficiency, shopify: c.shopify_connected })) : [], [data]);
  const symbol = cSym(baseCurr); const selBrand = brands.find(b => b.id === selBrandId); const dateLabel = DATE_RANGES.find(d => d.value === dateRange)?.label || '';
  const toggleC = (cc: string) => setExpanded(p => { const n = new Set(p); n.has(cc) ? n.delete(cc) : n.add(cc); return n; });
  const shopifyOk = data?.totals?.shopify_connected ?? false;

  return (
    <div className="min-h-screen" style={{ background: '#0A0A0A' }}>
      <Navbar>
        <div className="p-6 max-w-7xl mx-auto">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
            <div>
              <h1 className="text-2xl font-bold text-white flex items-center gap-2"><Globe size={24} style={{ color: GOLD }} />Geo Performance</h1>
              <p className="text-sm text-gray-400 mt-1">
                Meta ROAS by delivery country · aMER from Shopify · IF={data?.totals?.if_factor || '…'}× · {data?.meta_currency || '?'}
              </p>
            </div>
            <button onClick={fetchData} disabled={loading} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium" style={{ background: GOLD_DIM, color: GOLD, border: '1px solid rgba(200,184,154,0.2)' }}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} />Refresh</button>
          </div>

          {/* Warnings */}
          {data?.warnings?.map((w, i) => (
            <div key={i} className="mb-4 p-3 rounded-lg flex items-start gap-2 text-sm" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.15)', color: AMBER }}>
              <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />{w}
            </div>
          ))}
          {data?.errors?.map((e, i) => (
            <div key={i} className="mb-4 p-3 rounded-lg flex items-start gap-2 text-sm" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#FCA5A5' }}>
              <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />{e}
            </div>
          ))}

          {/* Controls */}
          <div className="flex flex-wrap items-center gap-3 mb-6">
            <div className="relative"><button onClick={() => { setBrandOpen(!brandOpen); setDateOpen(false); }} className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium" style={{ background: '#111', border: '1px solid rgba(255,255,255,0.08)', color: '#F5F5F8' }}>{selBrand?.name || 'Select Brand'}<ChevronDown size={14} className={brandOpen ? 'rotate-180' : ''} /></button>
              {brandOpen && (<><div className="fixed inset-0 z-10" onClick={() => setBrandOpen(false)} /><div className="absolute top-full left-0 mt-1 w-56 rounded-lg z-20 py-1 max-h-64 overflow-y-auto" style={{ background: '#111', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }}>{brands.map(b => (<button key={b.id} onClick={() => { setSelBrandId(b.id); setBrandOpen(false); }} className="w-full flex items-center gap-2 px-4 py-2 text-sm text-left" style={{ color: b.id === selBrandId ? GOLD : '#888', background: b.id === selBrandId ? GOLD_DIM : 'transparent' }}>{b.id === selBrandId && <Check size={14} style={{ color: GOLD }} />}<span className={b.id === selBrandId ? '' : 'ml-[22px]'}>{b.name}</span></button>))}</div></>)}</div>
            <div className="relative"><button onClick={() => { setDateOpen(!dateOpen); setBrandOpen(false); }} className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium" style={{ background: '#111', border: '1px solid rgba(255,255,255,0.08)', color: '#F5F5F8' }}>{dateLabel}<ChevronDown size={14} className={dateOpen ? 'rotate-180' : ''} /></button>
              {dateOpen && (<><div className="fixed inset-0 z-10" onClick={() => setDateOpen(false)} /><div className="absolute top-full left-0 mt-1 w-48 rounded-lg z-20 py-1" style={{ background: '#111', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }}>{DATE_RANGES.map(d => (<button key={d.value} onClick={() => { setDateRange(d.value); setDateOpen(false); }} className="w-full flex items-center gap-2 px-4 py-2 text-sm text-left" style={{ color: d.value === dateRange ? GOLD : '#888', background: d.value === dateRange ? GOLD_DIM : 'transparent' }}>{d.value === dateRange && <Check size={14} style={{ color: GOLD }} />}<span className={d.value === dateRange ? '' : 'ml-[22px]'}>{d.label}</span></button>))}</div></>)}</div>
            {loading && <Loader size={18} className="animate-spin text-gray-500" />}
          </div>

          {/* Summary Cards */}
          {data && !loading && (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3 mb-8">
              <SCard label="Meta ROAS" value={fmtRoas(data.totals.meta_roas)} sub="Purchase value ÷ spend" icon={<TrendingUp size={18} />} color={data.totals.meta_roas >= 1.5 ? GREEN : data.totals.meta_roas >= 1 ? AMBER : RED} />
              <SCard label="aMER" value={fmtRoasOrNA(data.totals.amer)} sub={shopifyOk ? 'NC rev ÷ spend (CTC)' : 'No Shopify data'} icon={<Gauge size={18} />} color={!shopifyOk ? '#666' : (data.totals.amer ?? 0) >= 1.5 ? GREEN : (data.totals.amer ?? 0) >= 0.8 ? AMBER : RED} />
              <SCard label="Inc. ROAS" value={fmtRoas(data.totals.inc_roas)} sub={`Meta ROAS × IF(${data.totals.if_factor}×)`} icon={<Zap size={18} />} color={data.totals.inc_roas >= 2 ? GREEN : data.totals.inc_roas >= 1.2 ? AMBER : RED} />
              <SCard label="Total Spend" value={fmtCompact(data.totals.normalized_spend, symbol)} sub={`${data.totals.country_count} countries`} icon={<DollarSign size={18} />} color={GOLD} />
              <SCard label="NC Revenue" value={shopifyOk ? fmtCompact(data.totals.normalized_nc_revenue, symbol) : '—'} sub={shopifyOk ? `${fmtNum(data.totals.total_nc_orders)} NC orders` : 'Sync needed'} icon={<ShoppingCart size={18} />} color={shopifyOk ? BLUE : '#666'} />
              <SCard label="GM Context" value={`${data.totals.brand_gross_margin_pct}%`} sub={data.totals.brand_gross_margin_pct >= 35 ? 'Strong margin buffer' : 'Tight — watch aMER'} icon={<BarChart3 size={18} />} color={data.totals.brand_gross_margin_pct >= 35 ? GREEN : AMBER} />
              <SCard label="Top Country" value={data.countries.length > 0 ? `${data.countries[0].flag} ${data.countries[0].country_name}` : '—'} sub={data.countries.length > 0 ? `${fmtPct(data.countries[0].spend_share)} spend · ${fmtRoas(data.countries[0].meta_roas)}` : ''} icon={<Globe size={18} />} color={PINK} />
              <SCard label="Meta Acct" value={data.meta_currency} sub={`${data.totals.campaign_count} campaigns`} icon={<Layers size={18} />} color={GOLD} />
            </div>
          )}

          {loading && <div className="flex items-center justify-center py-20"><Loader size={32} className="animate-spin" style={{ color: GOLD }} /><span className="ml-3 text-gray-400">Loading…</span></div>}
          {!loading && !data && <div className="flex flex-col items-center justify-center py-20 text-gray-500"><Globe size={48} className="mb-4 opacity-30" /><p>Select a brand to view geo performance</p></div>}

          {/* Charts */}
          {!loading && chartData.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
              <div className="rounded-xl p-5" style={{ background: '#111', border: '1px solid rgba(255,255,255,0.06)' }}>
                <h3 className="text-sm font-semibold text-gray-300 mb-4">Spend vs Revenue by Country ({baseCurr})</h3>
                <ResponsiveContainer width="100%" height={260}><BarChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" /><XAxis dataKey="country" tick={{ fill: '#666', fontSize: 12 }} axisLine={{ stroke: 'rgba(255,255,255,0.06)' }} /><YAxis tick={{ fill: '#666', fontSize: 12 }} axisLine={{ stroke: 'rgba(255,255,255,0.06)' }} tickFormatter={(v: any) => fmtCompact(Number(v), symbol)} /><Tooltip contentStyle={{ background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', fontSize: '13px' }} formatter={(v: any, n: any) => [fmtCurrency(Number(v), symbol), String(n)]} /><Bar dataKey="spend" name="Spend" fill={GOLD} radius={[4, 4, 0, 0]} /><Bar dataKey="revenue" name="Revenue" fill={BLUE} radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer>
              </div>
              <div className="rounded-xl p-5" style={{ background: '#111', border: '1px solid rgba(255,255,255,0.06)' }}>
                <h3 className="text-sm font-semibold text-gray-300 mb-4">Spending Power — Spend vs aMER</h3>
                {scatterData.length > 0 && <ResponsiveContainer width="100%" height={260}><ScatterChart margin={{ top: 5, right: 20, left: 10, bottom: 5 }}><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" /><XAxis type="number" dataKey="spend" name="Spend" tick={{ fill: '#666', fontSize: 11 }} axisLine={{ stroke: 'rgba(255,255,255,0.06)' }} tickFormatter={(v: any) => fmtCompact(Number(v), symbol)} /><YAxis type="number" dataKey="amer" name="aMER" tick={{ fill: '#666', fontSize: 11 }} axisLine={{ stroke: 'rgba(255,255,255,0.06)' }} tickFormatter={(v: any) => fmtRoas(Number(v))} domain={[0, 'auto']} /><ZAxis range={[70, 70]} /><Tooltip cursor={{ strokeDasharray: '3 3' }} contentStyle={{ background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', fontSize: '12px' }} formatter={(v: any, n: any) => [n === 'amer' ? fmtRoasOrNA(Number(v)) : fmtCurrency(Number(v), symbol), n === 'amer' ? 'aMER' : 'Spend']} />{['over', 'healthy', 'under'].map(eff => <Scatter key={eff} name={eff} data={scatterData.filter(d => d.eff === eff)} fill={eff === 'over' ? RED : eff === 'under' ? GREEN : AMBER} />)}</ScatterChart></ResponsiveContainer>}
                <div className="flex items-center gap-4 mt-2 justify-center"><span className="text-[10px] flex items-center gap-1" style={{ color: RED }}><span className="w-2 h-2 rounded-full" style={{ background: RED }} />Over</span><span className="text-[10px] flex items-center gap-1" style={{ color: AMBER }}><span className="w-2 h-2 rounded-full" style={{ background: AMBER }} />Steady</span><span className="text-[10px] flex items-center gap-1" style={{ color: GREEN }}><span className="w-2 h-2 rounded-full" style={{ background: GREEN }} />Scale</span></div>
              </div>
            </div>
          )}

          {/* Country List */}
          {!loading && data && data.countries.length > 0 && (
            <div className="space-y-2">
              {/* Compact header */}
              <div className="flex items-center px-4 py-2 text-[10px] font-medium text-gray-600 uppercase tracking-wider">
                <div className="w-8" /><div className="flex-1">Country</div>
                <div className="w-20 text-right hidden sm:block">Spend</div>
                <div className="w-18 text-right">Meta ROAS</div>
                <div className="w-16 text-right">aMER</div>
                <div className="w-16 text-right hidden md:block">Inc. ROAS</div>
                <div className="w-16 text-right hidden sm:block">Orders</div>
                <div className="w-20 text-center">Signal</div>
              </div>
              {data.countries.map((c) => {
                const isExp = expanded.has(c.country);
                const maxSpend = data.countries[0]?.normalized_spend || 1;
                const barPct = Math.min((c.normalized_spend / maxSpend) * 100, 100);
                const isXX = c.country === 'XX';

                return (<div key={c.country}>
                  <button onClick={() => toggleC(c.country)} className="w-full rounded-xl transition-all" style={{ background: isExp ? 'rgba(200,184,154,0.04)' : '#111', border: `1px solid ${isExp ? 'rgba(200,184,154,0.2)' : isXX ? 'rgba(239,68,68,0.12)' : c.spend_efficiency === 'over' ? 'rgba(239,68,68,0.1)' : 'rgba(255,255,255,0.06)'}` }}>
                    <div className="flex items-center px-4 py-3.5">
                      <div className="w-8">{isExp ? <ChevronDown size={16} style={{ color: GOLD }} /> : <ChevronRight size={16} style={{ color: '#555' }} />}</div>
                      <div className="flex-1 flex items-center gap-2.5 min-w-0">
                        <span className="text-lg flex-shrink-0">{isXX ? <HelpCircle size={18} style={{ color: RED }} /> : c.flag}</span>
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-[#F5F5F8] truncate flex items-center gap-2">
                            {isXX ? <><span style={{ color: RED }}>Unknown</span><span className="text-[9px] font-normal text-gray-600">(Meta returned no country)</span></> : <>{c.country_name || c.country}<span className="text-[10px] font-normal" style={{ color: GOLD }}>#{c.spend_rank}</span></>}
                          </div>
                          {c.meta_currency !== c.shopify_currency && <div className="text-[9px] text-gray-600">Meta: {c.meta_currency} · Shopify: {c.shopify_currency}</div>}
                        </div>
                      </div>
                      <div className="w-20 text-right hidden sm:block"><div className="text-sm font-mono font-semibold text-[#F5F5F8]">{fmtCompact(c.normalized_spend, symbol)}</div><div className="text-[10px] text-gray-600">{fmtPct(c.spend_share)}</div></div>
                      <div className="w-18 text-right"><span className="text-sm font-mono font-bold" style={{ color: c.meta_roas >= 1.5 ? GREEN : c.meta_roas >= 1 ? AMBER : RED }}>{fmtRoas(c.meta_roas)}</span></div>
                      <div className="w-16 text-right"><span className="text-sm font-mono" style={{ color: !c.shopify_connected ? '#555' : (c.amer ?? 0) >= 1.5 ? GREEN : (c.amer ?? 0) >= 0.8 ? AMBER : RED }}>{fmtRoasOrNA(c.amer)}</span></div>
                      <div className="w-16 text-right hidden md:block"><span className="text-sm font-mono" style={{ color: c.inc_roas >= 2 ? GREEN : c.inc_roas >= 1.2 ? AMBER : '#888' }}>{fmtRoas(c.inc_roas)}</span></div>
                      <div className="w-16 text-right hidden sm:block"><span className="text-sm font-mono text-gray-400">{c.shopify_orders > 0 ? fmtNum(c.shopify_orders) : '—'}</span></div>
                      <div className="w-20 text-center"><EffBadge eff={c.spend_efficiency} />{c.cta && <div className="text-[9px] text-gray-600 mt-0.5 leading-tight">{c.cta}</div>}</div>
                    </div>
                  </button>
                  {/* Expanded campaigns */}
                  {isExp && (
                    <div className="ml-10 mt-1 mb-2 rounded-lg overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.04)' }}>
                      {/* Country detail bar */}
                      <div className="px-4 py-2.5 flex flex-wrap items-center gap-x-5 gap-y-1 text-[11px]" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', background: 'rgba(255,255,255,0.01)' }}>
                        <div><span className="text-gray-600">Meta ROAS: </span><span className="font-mono font-semibold" style={{ color: c.meta_roas >= 1.5 ? GREEN : AMBER }}>{fmtRoas(c.meta_roas)}</span></div>
                        <div><span className="text-gray-600">aMER: </span><span className="font-mono" style={{ color: c.amer !== null ? BLUE : '#555' }}>{fmtRoasOrNA(c.amer)}</span></div>
                        <div><span className="text-gray-600">Gap: </span><span className="font-mono text-gray-400">{c.roas_vs_amer_gap !== null ? fmtRoas(c.roas_vs_amer_gap) : '—'}</span></div>
                        <div><span className="text-gray-600">Orders: </span><span className="font-mono text-gray-400">{c.shopify_orders > 0 ? `${fmtNum(c.shopify_nc_orders)} NC / ${fmtNum(c.shopify_orders)}` : '—'}</span></div>
                        <div><span className="text-gray-600">Meta Purch: </span><span className="font-mono text-gray-400">{fmtNum(c.meta_purchases)}</span></div>
                        {!c.shopify_connected && <span className="text-[10px] px-2 py-0.5 rounded" style={{ background: 'rgba(245,158,11,0.1)', color: AMBER }}>No Shopify — aMER unavailable</span>}
                      </div>
                      {c.campaigns.length > 0 ? (
                        <table className="w-full text-sm"><thead><tr style={{ background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                          <th className="text-left py-2.5 px-4 text-[10px] font-medium text-gray-600 uppercase">Campaign</th>
                          <th className="text-left py-2.5 px-2 text-[10px] font-medium text-gray-600 uppercase hidden sm:table-cell">Obj</th>
                          <th className="text-left py-2.5 px-2 text-[10px] font-medium text-gray-600 uppercase">Status</th>
                          <th className="text-right py-2.5 px-3 text-[10px] font-medium text-gray-600 uppercase">Spend</th>
                          <th className="text-right py-2.5 px-3 text-[10px] font-medium text-gray-600 uppercase">ROAS</th>
                          <th className="text-right py-2.5 px-3 text-[10px] font-medium text-gray-600 uppercase">aMER</th>
                          <th className="text-center py-2.5 px-2 text-[10px] font-medium text-gray-600 uppercase hidden md:table-cell">Country</th>
                          <th className="py-2.5 px-3" style={{ width: '50px' }} />
                        </tr></thead><tbody>
                          {c.campaigns.map(camp => {
                            const campPct = c.normalized_spend > 0 ? (camp.normalized_spend / c.normalized_spend) * 100 : 0;
                            return (<tr key={camp.campaign_id} className="hover:bg-white/[0.02]" style={{ borderBottom: '1px solid rgba(255,255,255,0.02)' }}>
                              <td className="py-2.5 px-4"><div className="text-[#F5F5F8] font-medium text-[13px] truncate max-w-[180px]">{camp.campaign_name}</div></td>
                              <td className="py-2.5 px-2 hidden sm:table-cell"><ObjBadge obj={camp.campaign_type} /></td>
                              <td className="py-2.5 px-2"><StatusBadge status={camp.status} /></td>
                              <td className="py-2.5 px-3 text-right font-mono text-[13px] text-[#F5F5F8]">{fmtCompact(camp.normalized_spend, symbol)}<div className="text-[10px] text-gray-600">{fmtPct(campPct)}</div></td>
                              <td className="py-2.5 px-3 text-right font-mono text-[13px] font-bold"><span style={{ color: camp.normalized_roas >= 1.5 ? GREEN : camp.normalized_roas >= 1 ? AMBER : RED }}>{fmtRoas(camp.normalized_roas)}</span></td>
                              <td className="py-2.5 px-3 text-right font-mono text-[13px]"><span style={{ color: !c.shopify_connected ? '#555' : camp.amer >= 1.5 ? GREEN : camp.amer >= 0.8 ? AMBER : '#888' }}>{!c.shopify_connected ? '—' : fmtRoas(camp.amer)}</span></td>
                              <td className="py-2.5 px-2 text-center hidden md:table-cell"><span className="text-[10px] font-mono text-gray-600 bg-white/[0.03] px-1.5 py-0.5 rounded">{camp.raw_country}</span></td>
                              <td className="py-2.5 px-3"><div className="h-1 rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}><div className="h-full rounded-full" style={{ width: `${campPct}%`, background: camp.spend_efficiency === 'over' ? RED : GOLD, minWidth: campPct > 0 ? '2px' : 0 }} /></div></td>
                            </tr>);
                          })}
                        </tbody></table>
                      ) : (<div className="p-4 text-sm text-gray-600 text-center">No campaigns with spend in this country.</div>)}
                    </div>
                  )}
                </div>);
              })}
            </div>
          )}
        </div>
      </Navbar>
    </div>
  );
}
