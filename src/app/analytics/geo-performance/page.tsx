'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  Loader, ChevronDown, ChevronRight, Check, RefreshCw,
  DollarSign, TrendingUp, Globe, ShoppingCart, Target,
  Layers, Play, Pause, AlertTriangle, BarChart3, Zap,
  ArrowUp, ArrowDown, Minus, Gauge, HelpCircle, MousePointerClick,
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
const TEAL = '#2DD4BF';
const INDIGO = '#6366F1';

// ─── Types ──────────────────────────────────────────────────────

interface Brand { id: string; name: string; slug: string; }

interface CampaignRow {
  campaign_id: string; campaign_name: string; campaign_type: string;
  status: string; spend: number; impressions: number; clicks: number;
  ctr: number; purchases: number; purchase_value: number; roas: number;
  aov: number; cpa: number;
  meta_currency: string; normalized_spend: number; normalized_revenue: number;
  normalized_roas: number; spend_rank: number; raw_country: string;
}

interface CountryRow {
  country: string; country_name: string; flag: string;
  meta_spend: number; meta_purchases: number; meta_purchase_value: number;
  meta_roas: number; meta_currency: string;
  shopify_revenue: number; shopify_nc_revenue: number;
  shopify_currency: string; shopify_orders: number; shopify_nc_orders: number;
  shopify_connected: boolean;
  nc_aov: number | null; ncac: number | null;
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
  baseCurrency: string; fxRates: Record<string, number>;
  meta_currency: string;
  date_range: { from: string; to: string }; errors?: string[]; warnings?: string[];
}

type DateRange = 'last_7d' | 'last_14d' | 'last_30d' | 'last_90d' | 'this_month';
const DATE_RANGES: { value: DateRange; label: string }[] = [
  { value: 'last_7d', label: 'Last 7 Days' }, { value: 'last_14d', label: 'Last 14 Days' },
  { value: 'last_30d', label: 'Last 30 Days' }, { value: 'last_90d', label: 'Last 90 Days' },
  { value: 'this_month', label: 'This Month' },
];

// ─── Formatters ─────────────────────────────────────────────────

const cSym = (code: string) => { const m: Record<string, string> = { USD: '$', CAD: 'C$', GBP: '£', EUR: '€', AUD: 'A$', NZD: 'NZ$' }; return m[code] || code; };
const F = (n: number, s = '$') => Math.abs(n) >= 1e6 ? `${s}${(n/1e6).toFixed(2)}M` : Math.abs(n) >= 1e4 ? `${s}${(n/1e3).toFixed(1)}K` : `${s}${n.toFixed(2)}`;
const Fc = (n: number, s = '$') => Math.abs(n) >= 1e6 ? `${s}${(n/1e6).toFixed(1)}M` : Math.abs(n) >= 1e3 ? `${s}${(n/1e3).toFixed(1)}K` : `${s}${n.toFixed(0)}`;
const N = (n: number) => n.toLocaleString();
const P = (n: number) => `${n.toFixed(1)}%`;
const Rx = (n: number) => `${n.toFixed(2)}×`;
const Rna = (n: number | null) => n === null ? '—' : Rx(n);
const Vna = (n: number | null, s: string) => n === null ? '—' : Fc(n, s);

function SBadge({ status }: { status: string }) {
  const s = status.toUpperCase(); const a = s === 'ACTIVE'; const p = s === 'PAUSED' || s === 'PAUSED_BY_USER';
  return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold uppercase" style={{ background: a ? 'rgba(34,197,94,0.12)' : p ? 'rgba(245,158,11,0.12)' : 'rgba(255,255,255,0.06)', color: a ? GREEN : p ? AMBER : '#666' }}>{a ? <Play size={8} /> : p ? <Pause size={8} /> : null}{status.replace(/_/g, ' ')}</span>;
}

function OBadge({ obj }: { obj: string }) {
  const isC = obj === 'Demand Capture';
  return <span className="inline-flex items-center px-2 py-0.5 rounded text-[9px] font-medium uppercase" style={{ background: isC ? 'rgba(96,165,250,0.08)' : 'rgba(167,139,250,0.08)', color: isC ? BLUE : PURPLE, border: `1px solid ${isC ? 'rgba(96,165,250,0.15)' : 'rgba(167,139,250,0.15)'}` }}>{obj}</span>;
}

function EBadge({ eff }: { eff: 'over' | 'healthy' | 'under' }) {
  const c = { over: { i: <ArrowDown size={10} />, l: 'Over', bg: 'rgba(239,68,68,0.1)', col: RED }, healthy: { i: <Minus size={10} />, l: 'Steady', bg: 'rgba(245,158,11,0.1)', col: AMBER }, under: { i: <ArrowUp size={10} />, l: 'Scale', bg: 'rgba(34,197,94,0.1)', col: GREEN } }[eff];
  return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold uppercase" style={{ background: c.bg, color: c.col }}>{c.i}{c.l}</span>;
}

function Card({ l, v, s, i, c }: { l: string; v: string; s: string; i: React.ReactNode; c: string }) {
  return <div className="rounded-xl p-4" style={{ background: '#111', border: '1px solid rgba(255,255,255,0.06)' }}><div className="flex items-center gap-2 mb-2" style={{ color: c }}>{i}<span className="text-xs font-medium text-gray-500 uppercase">{l}</span></div><div className="text-xl font-bold text-[#F5F5F8] mb-1">{v}</div><div className="text-xs text-gray-500">{s}</div></div>;
}

// ─── Page ───────────────────────────────────────────────────────

export default function GeoPerformancePage() {
  const router = useRouter(); const sup = createClient();
  const [brands, setBrands] = useState<Brand[]>([]);
  const [bid, setBid] = useState('');
  const [dr, setDr] = useState<DateRange>('last_30d');
  const [bc, setBc] = useState('USD');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<GeoResponse | null>(null);
  const [token, setToken] = useState('');
  const [profile, setProfile] = useState<{ role: string; brand_id: string } | null>(null);
  const [exp, setExp] = useState<Set<string>>(new Set());
  const [bo, setBo] = useState(false); const [do_, setDo] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await sup.auth.getSession();
      if (!session) { router.push('/'); return; }
      setToken(session.access_token);
      const { data: p } = await sup.from('users_profile').select('role, brand_id').eq('id', session.user.id).single();
      if (p) setProfile(p);
      const { data: bl } = await sup.from('brands').select('id, name, slug').is('archived_at', null).order('name');
      if (bl) { setBrands(bl); const sv = localStorage.getItem('melch_sel_geo'); if (sv && bl.find((b: any) => b.id === sv)) setBid(sv); else if (p?.brand_id && bl.find((b: any) => b.id === p.brand_id)) setBid(p.brand_id); else if (bl.length > 0) setBid(bl[0].id); }
    })();
  }, []); // eslint-disable-line

  const fetchData = async () => { if (!bid || !token) return; setLoading(true); try { const r = await fetch(`/api/geo-performance?brandId=${bid}&dateRange=${dr}&baseCurrency=${bc}`, { headers: { Authorization: `Bearer ${token}` } }); const j = await r.json(); if (r.ok) setData(j); } catch {} setLoading(false); };
  useEffect(() => { fetchData(); }, [bid, dr, bc, token]); // eslint-disable-line
  useEffect(() => { if (bid) localStorage.setItem('melch_sel_geo', bid); }, [bid]);

  const chartData = useMemo(() => data ? data.countries.slice(0, 6).map(c => ({ country: c.country, name: c.country_name, spend: c.normalized_spend, revenue: c.normalized_revenue })) : [], [data]);
  const scatterData = useMemo(() => data ? data.countries.map(c => ({ country: c.country, name: c.country_name, spend: c.normalized_spend, amer: c.amer ?? 0, eff: c.spend_efficiency })) : [], [data]);
  const sym = cSym(bc); const sb = brands.find(b => b.id === bid); const dl = DATE_RANGES.find(d => d.value === dr)?.label || '';
  const toggle = (cc: string) => setExp(p => { const n = new Set(p); n.has(cc) ? n.delete(cc) : n.add(cc); return n; });
  const so = data?.totals?.shopify_connected ?? false;

  return (
    <div className="min-h-screen" style={{ background: '#0A0A0A' }}>
      <Navbar>
        <div className="p-6 max-w-7xl mx-auto">
          {/* Header */}
          <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
            <div>
              <h1 className="text-2xl font-bold text-white flex items-center gap-2"><Globe size={24} style={{ color: GOLD }} />Geo Performance</h1>
              <p className="text-sm text-gray-400 mt-1">Meta ROAS by delivery country · aMER from Shopify · IF={data?.totals?.if_factor || '…'}× · {data?.meta_currency || '?'}</p>
            </div>
            <button onClick={fetchData} disabled={loading} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium" style={{ background: GOLD_DIM, color: GOLD, border: '1px solid rgba(200,184,154,0.2)' }}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} />Refresh</button>
          </div>

          {/* Warnings / Errors */}
          {data?.warnings?.map((w, i) => (<div key={i} className="mb-4 p-3 rounded-lg flex items-start gap-2 text-sm" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.15)', color: AMBER }}><AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />{w}</div>))}
          {data?.errors?.map((e, i) => (<div key={i} className="mb-4 p-3 rounded-lg flex items-start gap-2 text-sm" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#FCA5A5' }}><AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />{e}</div>))}

          {/* Controls */}
          <div className="flex flex-wrap items-center gap-3 mb-6">
            <div className="relative"><button onClick={() => { setBo(!bo); setDo(false); }} className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium" style={{ background: '#111', border: '1px solid rgba(255,255,255,0.08)', color: '#F5F5F8' }}>{sb?.name || 'Select Brand'}<ChevronDown size={14} className={bo ? 'rotate-180' : ''} /></button>
              {bo && (<><div className="fixed inset-0 z-10" onClick={() => setBo(false)} /><div className="absolute top-full left-0 mt-1 w-56 rounded-lg z-20 py-1 max-h-64 overflow-y-auto" style={{ background: '#111', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }}>{brands.map(b => (<button key={b.id} onClick={() => { setBid(b.id); setBo(false); }} className="w-full flex items-center gap-2 px-4 py-2 text-sm text-left" style={{ color: b.id === bid ? GOLD : '#888', background: b.id === bid ? GOLD_DIM : 'transparent' }}>{b.id === bid && <Check size={14} style={{ color: GOLD }} />}<span className={b.id === bid ? '' : 'ml-[22px]'}>{b.name}</span></button>))}</div></>)}</div>
            <div className="relative"><button onClick={() => { setDo(!do_); setBo(false); }} className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium" style={{ background: '#111', border: '1px solid rgba(255,255,255,0.08)', color: '#F5F5F8' }}>{dl}<ChevronDown size={14} className={do_ ? 'rotate-180' : ''} /></button>
              {do_ && (<><div className="fixed inset-0 z-10" onClick={() => setDo(false)} /><div className="absolute top-full left-0 mt-1 w-48 rounded-lg z-20 py-1" style={{ background: '#111', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }}>{DATE_RANGES.map(d => (<button key={d.value} onClick={() => { setDr(d.value); setDo(false); }} className="w-full flex items-center gap-2 px-4 py-2 text-sm text-left" style={{ color: d.value === dr ? GOLD : '#888', background: d.value === dr ? GOLD_DIM : 'transparent' }}>{d.value === dr && <Check size={14} style={{ color: GOLD }} />}<span className={d.value === dr ? '' : 'ml-[22px]'}>{d.label}</span></button>))}</div></>)}</div>
            {loading && <Loader size={18} className="animate-spin text-gray-500" />}
          </div>

          {/* Top Stats Cards */}
          {data && !loading && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
              <Card l="Meta ROAS" v={Rx(data.totals.meta_roas)} s="Purchase value ÷ spend" i={<TrendingUp size={18} />} c={data.totals.meta_roas >= 1.5 ? GREEN : data.totals.meta_roas >= 1 ? AMBER : RED} />
              <Card l="aMER" v={Rna(data.totals.amer)} s={so ? 'NC rev ÷ spend (CTC)' : 'No Shopify'} i={<Gauge size={18} />} c={!so ? '#666' : (data.totals.amer ?? 0) >= 1.5 ? GREEN : (data.totals.amer ?? 0) >= 0.8 ? AMBER : RED} />
              <Card l="Inc. ROAS" v={Rx(data.totals.inc_roas)} s={`×IF(${data.totals.if_factor}×)`} i={<Zap size={18} />} c={data.totals.inc_roas >= 2 ? GREEN : data.totals.inc_roas >= 1.2 ? AMBER : RED} />
              <Card l="GM Context" v={`${data.totals.brand_gross_margin_pct}%`} s={data.totals.brand_gross_margin_pct >= 35 ? 'Strong buffer' : 'Tight'} i={<BarChart3 size={18} />} c={data.totals.brand_gross_margin_pct >= 35 ? GREEN : AMBER} />
            </div>
          )}

          {loading && <div className="flex items-center justify-center py-20"><Loader size={32} className="animate-spin" style={{ color: GOLD }} /><span className="ml-3 text-gray-400">Loading…</span></div>}
          {!loading && !data && <div className="flex flex-col items-center justify-center py-20 text-gray-500"><Globe size={48} className="mb-4 opacity-30" /><p>Select a brand to view geo performance</p></div>}

          {/* Charts */}
          {!loading && chartData.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
              <div className="rounded-xl p-5" style={{ background: '#111', border: '1px solid rgba(255,255,255,0.06)' }}>
                <h3 className="text-sm font-semibold text-gray-300 mb-4">Spend vs Revenue by Country ({bc})</h3>
                <ResponsiveContainer width="100%" height={260}><BarChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" /><XAxis dataKey="country" tick={{ fill: '#666', fontSize: 12 }} axisLine={{ stroke: 'rgba(255,255,255,0.06)' }} /><YAxis tick={{ fill: '#666', fontSize: 12 }} axisLine={{ stroke: 'rgba(255,255,255,0.06)' }} tickFormatter={(v: any) => Fc(Number(v), sym)} /><Tooltip contentStyle={{ background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', fontSize: '13px' }} formatter={(v: any, n: any) => [F(Number(v), sym), String(n)]} /><Bar dataKey="spend" name="Spend" fill={GOLD} radius={[4, 4, 0, 0]} /><Bar dataKey="revenue" name="Revenue" fill={BLUE} radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer>
              </div>
              <div className="rounded-xl p-5" style={{ background: '#111', border: '1px solid rgba(255,255,255,0.06)' }}>
                <h3 className="text-sm font-semibold text-gray-300 mb-4">Spending Power — Spend vs aMER</h3>
                {scatterData.length > 0 && <ResponsiveContainer width="100%" height={260}><ScatterChart margin={{ top: 5, right: 20, left: 10, bottom: 5 }}><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" /><XAxis type="number" dataKey="spend" name="Spend" tick={{ fill: '#666', fontSize: 11 }} axisLine={{ stroke: 'rgba(255,255,255,0.06)' }} tickFormatter={(v: any) => Fc(Number(v), sym)} /><YAxis type="number" dataKey="amer" name="aMER" tick={{ fill: '#666', fontSize: 11 }} axisLine={{ stroke: 'rgba(255,255,255,0.06)' }} tickFormatter={(v: any) => Rx(Number(v))} domain={[0, 'auto']} /><ZAxis range={[70, 70]} /><Tooltip cursor={{ strokeDasharray: '3 3' }} contentStyle={{ background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', fontSize: '12px' }} formatter={(v: any, n: any) => [n === 'amer' ? Rna(Number(v)) : F(Number(v), sym), n === 'amer' ? 'aMER' : 'Spend']} />{['over', 'healthy', 'under'].map(e => <Scatter key={e} name={e} data={scatterData.filter(d => d.eff === e)} fill={e === 'over' ? RED : e === 'under' ? GREEN : AMBER} />)}</ScatterChart></ResponsiveContainer>}
                <div className="flex items-center gap-4 mt-2 justify-center"><span className="text-[10px] flex items-center gap-1" style={{ color: RED }}><span className="w-2 h-2 rounded-full" style={{ background: RED }} />Over</span><span className="text-[10px] flex items-center gap-1" style={{ color: AMBER }}><span className="w-2 h-2 rounded-full" style={{ background: AMBER }} />Steady</span><span className="text-[10px] flex items-center gap-1" style={{ color: GREEN }}><span className="w-2 h-2 rounded-full" style={{ background: GREEN }} />Scale</span></div>
              </div>
            </div>
          )}

          {/* ═══════════════ Country Cards ═══════════════ */}
          {!loading && data && data.countries.length > 0 && (
            <div className="space-y-2">
              {/* Column header */}
              <div className="flex items-center px-4 py-1.5 text-[10px] font-medium text-gray-600 uppercase tracking-wider">
                <div className="w-8" /><div className="flex-1">Country</div>
                <div className="w-22 text-right">Spend</div>
                <div className="w-18 text-right">Meta ROAS</div>
                <div className="w-16 text-right">aMER</div>
                <div className="w-18 text-right">NC AOV</div>
                <div className="w-18 text-right">NCAC</div>
                <div className="w-18 text-center">Signal</div>
              </div>

              {data.countries.map((c) => {
                const isX = exp.has(c.country);
                const isXX = c.country === 'XX';
                const maxSp = data.countries[0]?.normalized_spend || 1;
                const bp = Math.min((c.normalized_spend / maxSp) * 100, 100);

                return (<div key={c.country}>
                  {/* ── Country row ── */}
                  <button onClick={() => toggle(c.country)} className="w-full rounded-xl transition-all"
                    style={{ background: isX ? 'rgba(200,184,154,0.04)' : '#111', border: `1px solid ${isX ? 'rgba(200,184,154,0.2)' : isXX ? 'rgba(239,68,68,0.12)' : 'rgba(255,255,255,0.06)'}` }}>
                    <div className="flex items-center px-4 py-3.5">
                      <div className="w-8">{isX ? <ChevronDown size={16} style={{ color: GOLD }} /> : <ChevronRight size={16} style={{ color: '#555' }} />}</div>
                      <div className="flex-1 flex items-center gap-2.5 min-w-0">
                        <span className="text-lg flex-shrink-0">{isXX ? <HelpCircle size={18} style={{ color: RED }} /> : c.flag}</span>
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-[#F5F5F8] truncate flex items-center gap-2">
                            {isXX ? <span style={{ color: RED }}>Unknown</span> : c.country_name || c.country}
                            <span className="text-[10px] font-normal" style={{ color: GOLD }}>#{c.spend_rank}</span>
                            <span className="text-[9px] font-normal text-gray-600">{P(c.spend_share)}</span>
                          </div>
                          {c.meta_currency !== c.shopify_currency && <div className="text-[9px] text-gray-600">{c.meta_currency} / {c.shopify_currency}</div>}
                        </div>
                      </div>
                      <div className="w-22 text-right"><span className="text-sm font-mono font-semibold text-[#F5F5F8]">{Fc(c.normalized_spend, sym)}</span></div>
                      <div className="w-18 text-right"><span className="text-sm font-mono font-bold" style={{ color: c.meta_roas >= 1.5 ? GREEN : c.meta_roas >= 1 ? AMBER : RED }}>{Rx(c.meta_roas)}</span></div>
                      <div className="w-16 text-right"><span className="text-sm font-mono" style={{ color: !c.shopify_connected ? '#555' : (c.amer ?? 0) >= 1.5 ? GREEN : (c.amer ?? 0) >= 0.8 ? AMBER : RED }}>{Rna(c.amer)}</span></div>
                      <div className="w-18 text-right"><span className="text-sm font-mono" style={{ color: !c.shopify_connected ? '#555' : c.nc_aov !== null && c.nc_aov > 0 ? BLUE : '#888' }}>{Vna(c.nc_aov, sym)}</span></div>
                      <div className="w-18 text-right"><span className="text-sm font-mono" style={{ color: !c.shopify_connected ? '#555' : c.ncac !== null && c.ncac > 0 ? (c.ncac < (c.nc_aov ?? 0) ? GREEN : AMBER) : '#888' }}>{Vna(c.ncac, sym)}</span></div>
                      <div className="w-18 text-center"><EBadge eff={c.spend_efficiency} />{c.cta && <div className="text-[8px] text-gray-600 mt-0.5 leading-tight">{c.cta}</div>}</div>
                    </div>
                  </button>

                  {/* ── Expanded: Country detail + Campaign table ── (SEPARATED) */}
                  {isX && (
                    <div className="ml-10 mt-1 mb-2 space-y-2">
                      {/* ── Country Detail Card ── */}
                      <div className="rounded-lg p-4" style={{ background: 'rgba(200,184,154,0.03)', border: '1px solid rgba(200,184,154,0.08)' }}>
                        <div className="flex items-center gap-2 mb-3">
                          <span className="text-lg">{c.flag}</span>
                          <span className="text-sm font-semibold text-[#F5F5F8]">{c.country_name || c.country}</span>
                          <span className="text-[10px] text-gray-600">· {c.campaign_count} campaigns · {Fc(c.normalized_spend, sym)} spend</span>
                          {!c.shopify_connected && <span className="text-[10px] px-2 py-0.5 rounded" style={{ background: 'rgba(245,158,11,0.1)', color: AMBER }}>No Shopify — aMER/NC metrics unavailable</span>}
                        </div>

                        {/* Two-column metric grid */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-2 text-[11px]">
                          {/* Meta metrics */}
                          <div>
                            <div><span className="text-gray-600">Meta ROAS </span><span className="font-mono font-semibold" style={{ color: c.meta_roas >= 1.5 ? GREEN : AMBER }}>{Rx(c.meta_roas)}</span></div>
                            <div><span className="text-gray-600">Meta Spend </span><span className="font-mono text-gray-400">{Fc(c.normalized_spend, sym)}</span></div>
                            <div><span className="text-gray-600">Meta Purchases </span><span className="font-mono text-gray-400">{N(c.meta_purchases)}</span></div>
                            <div><span className="text-gray-600">Inc. ROAS </span><span className="font-mono" style={{ color: c.inc_roas >= 2 ? GREEN : '#888' }}>{Rx(c.inc_roas)}</span></div>
                          </div>
                          {/* Shopify / NC metrics */}
                          <div>
                            <div><span className="text-gray-600">aMER </span><span className="font-mono" style={{ color: c.amer !== null && c.amer >= 1.5 ? GREEN : c.amer !== null && c.amer >= 0.8 ? AMBER : '#888' }}>{Rna(c.amer)}</span></div>
                            <div><span className="text-gray-600">NC AOV </span><span className="font-mono text-gray-400">{Vna(c.nc_aov, sym)}</span></div>
                            <div><span className="text-gray-600">NCAC </span><span className="font-mono text-gray-400">{Vna(c.ncac, sym)}</span></div>
                            <div><span className="text-gray-600">Gap (ROAS−aMER) </span><span className="font-mono text-gray-400">{c.roas_vs_amer_gap !== null ? Rx(c.roas_vs_amer_gap) : '—'}</span></div>
                          </div>
                          {/* Order counts */}
                          <div>
                            <div><span className="text-gray-600">NC Orders </span><span className="font-mono text-gray-400">{so ? N(c.shopify_nc_orders) : '—'}</span></div>
                            <div><span className="text-gray-600">Total Orders </span><span className="font-mono text-gray-400">{so ? N(c.shopify_orders) : '—'}</span></div>
                          </div>
                          {/* Ranks */}
                          <div>
                            <div><span className="text-gray-600">Spend Rank </span><span className="font-mono" style={{ color: GOLD }}>#{c.spend_rank}</span></div>
                            <div><span className="text-gray-600">aMER Rank </span><span className="font-mono" style={{ color: BLUE }}>#{c.amer_rank}</span></div>
                          </div>
                        </div>
                      </div>

                      {/* ── Campaign Table (Meta only) ── */}
                      {c.campaigns.length > 0 && (
                        <div className="rounded-lg overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.04)' }}>
                          <div className="px-4 py-2 text-[10px] font-medium text-gray-500 uppercase tracking-wider" style={{ background: 'rgba(255,255,255,0.015)' }}>Campaigns</div>
                          <table className="w-full text-sm">
                            <thead><tr style={{ background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                              <th className="text-left py-2.5 px-3 text-[10px] font-medium text-gray-600 uppercase">Campaign</th>
                              <th className="text-left py-2.5 px-2 text-[10px] font-medium text-gray-600 uppercase hidden sm:table-cell">Objective</th>
                              <th className="text-left py-2.5 px-2 text-[10px] font-medium text-gray-600 uppercase">Status</th>
                              <th className="text-right py-2.5 px-3 text-[10px] font-medium text-gray-600 uppercase">Spend</th>
                              <th className="text-right py-2.5 px-3 text-[10px] font-medium text-gray-600 uppercase">ROAS</th>
                              <th className="text-right py-2.5 px-3 text-[10px] font-medium text-gray-600 uppercase hidden sm:table-cell">AOV</th>
                              <th className="text-right py-2.5 px-3 text-[10px] font-medium text-gray-600 uppercase hidden sm:table-cell">CPA</th>
                              <th className="text-right py-2.5 px-3 text-[10px] font-medium text-gray-600 uppercase hidden md:table-cell">Country</th>
                            </tr></thead>
                            <tbody>
                              {c.campaigns.map(camp => {
                                const cp = c.normalized_spend > 0 ? (camp.normalized_spend / c.normalized_spend) * 100 : 0;
                                return (<tr key={camp.campaign_id} className="hover:bg-white/[0.02]" style={{ borderBottom: '1px solid rgba(255,255,255,0.02)' }}>
                                  <td className="py-2.5 px-3">
                                    <div className="text-[#F5F5F8] font-medium text-[13px] truncate max-w-[200px]">{camp.campaign_name}</div>
                                    <div className="text-[9px] text-gray-600 flex items-center gap-1 mt-0.5">
                                      <span className="px-1 py-0.5 rounded" style={{ background: 'rgba(255,255,255,0.04)' }}>#{camp.spend_rank}</span>
                                      {P(cp)}
                                    </div>
                                  </td>
                                  <td className="py-2.5 px-2 hidden sm:table-cell"><OBadge obj={camp.campaign_type} /></td>
                                  <td className="py-2.5 px-2"><SBadge status={camp.status} /></td>
                                  <td className="py-2.5 px-3 text-right font-mono text-[13px] text-[#F5F5F8]">{Fc(camp.normalized_spend, sym)}</td>
                                  <td className="py-2.5 px-3 text-right font-mono text-[13px] font-bold">
                                    <span style={{ color: camp.normalized_roas >= 1.5 ? GREEN : camp.normalized_roas >= 1 ? AMBER : RED }}>{Rx(camp.normalized_roas)}</span>
                                  </td>
                                  <td className="py-2.5 px-3 text-right font-mono text-[13px] hidden sm:table-cell"><span style={{ color: camp.aov > 0 ? BLUE : '#888' }}>{Fc(camp.aov, sym)}</span></td>
                                  <td className="py-2.5 px-3 text-right font-mono text-[13px] hidden sm:table-cell"><span style={{ color: camp.cpa > 0 && camp.cpa < camp.aov ? GREEN : '#888' }}>{Fc(camp.cpa, sym)}</span></td>
                                  <td className="py-2.5 px-3 text-right hidden md:table-cell"><span className="text-[10px] font-mono text-gray-600 bg-white/[0.03] px-1.5 py-0.5 rounded">{camp.raw_country}</span></td>
                                </tr>);
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
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