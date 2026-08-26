'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  Loader, ChevronDown, ChevronRight, Check, RefreshCw,
  DollarSign, TrendingUp, Globe, ShoppingCart,
  Play, Pause, AlertTriangle, BarChart3, Zap,
  ArrowUp, ArrowDown, Minus, Gauge, HelpCircle,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ScatterChart, Scatter, ZAxis,
} from 'recharts';
import Navbar from '@/components/Navbar';
import { createClient } from '@/lib/supabase';

// ─── Palette ────────────────────────────────────────────────────
const G   = '#C8B89A';
const Gd  = 'rgba(200,184,154,0.08)';
const Gn  = '#22C55E';
const Rd  = '#EF4444';
const Bl  = '#60A5FA';
const Am  = '#F59E0B';
const Pr  = '#A78BFA';
const Gy  = '#666';
const W   = '#F5F5F8';
const W2  = 'rgba(255,255,255,0.06)';
const W4  = 'rgba(255,255,255,0.04)';
const W8  = 'rgba(255,255,255,0.08)';
const W10 = 'rgba(255,255,255,0.10)';

// ─── Types ──────────────────────────────────────────────────────
interface Brand { id: string; name: string; slug: string; }
interface CampaignRow {
  campaign_id: string; campaign_name: string; campaign_type: string;
  status: string; spend: number; impressions: number; clicks: number;
  ctr: number; purchases: number; purchase_value: number; roas: number;
  aov: number; cpa: number;
  normalized_spend: number; normalized_revenue: number; normalized_roas: number;
  spend_rank: number; raw_country: string;
}
interface CountryRow {
  country: string; country_name: string; flag: string;
  meta_spend: number; meta_purchases: number; meta_purchase_value: number;
  meta_roas: number; meta_currency: string;
  google_spend: number; google_currency: string;
  shopify_revenue: number; shopify_nc_revenue: number;
  shopify_currency: string; shopify_orders: number; shopify_nc_orders: number;
  shopify_connected: boolean;
  nc_aov: number | null; ncac: number | null;
  normalized_spend: number; normalized_google_spend: number; normalized_total_spend: number;
  normalized_revenue: number;
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
    normalized_meta_spend: number; normalized_google_spend: number; normalized_spend: number;
    normalized_revenue: number;
    normalized_nc_revenue: number; meta_roas: number; normalized_roas: number;
    amer: number | null; inc_roas: number; total_orders: number;
    total_nc_orders: number; total_purchases: number;
    base_currency: string; country_count: number; campaign_count: number;
    brand_gross_margin_pct: number; if_factor: number;
    shopify_connected: boolean; google_connected: boolean;
  };
  baseCurrency: string; fxRates: Record<string, number>;
  meta_currency: string; shopify_currency: string; google_currency: string;
  date_range: { from: string; to: string }; errors?: string[]; warnings?: string[];
}

type DateRange = 'last_7d' | 'last_14d' | 'last_30d' | 'last_90d' | 'this_month';
const DATE_RANGES = [
  { value: 'last_7d' as DateRange, label: 'Last 7 Days' },
  { value: 'last_14d' as DateRange, label: 'Last 14 Days' },
  { value: 'last_30d' as DateRange, label: 'Last 30 Days' },
  { value: 'last_90d' as DateRange, label: 'Last 90 Days' },
  { value: 'this_month' as DateRange, label: 'This Month' },
];
const BASE_CURRENCIES = ['auto', 'USD', 'CAD', 'GBP', 'EUR', 'AUD'];

// ─── Formatters ─────────────────────────────────────────────────
const $sym = (c: string) => ({USD:'$',CAD:'C$',GBP:'£',EUR:'€',AUD:'A$',NZD:'NZ$',CHF:'CHF'}[c]||c);
const $k = (n:number,s='$')=>Math.abs(n)>=1e6?`${s}${(n/1e6).toFixed(1)}M`:Math.abs(n)>=1e3?`${s}${(n/1e3).toFixed(1)}K`:`${s}${n.toFixed(0)}`;
const $f = (n:number,s='$')=>Math.abs(n)>=1e6?`${s}${(n/1e6).toFixed(2)}M`:Math.abs(n)>=1e4?`${s}${(n/1e3).toFixed(1)}K`:`${s}${n.toFixed(2)}`;
const Nf = (n:number)=>n.toLocaleString();
const Pf = (n:number)=>`${n.toFixed(1)}%`;
const Rx = (n:number)=>`${n.toFixed(2)}×`;
const Rna = (n:number|null)=>n===null?'—':Rx(n);

// ─── Mini-badges ────────────────────────────────────────────────
const SBadge = ({s}:{s:string})=>{const u=s.toUpperCase(),a=u==='ACTIVE',p=u==='PAUSED'||u==='PAUSED_BY_USER';return <span className="inline-flex items-center gap-1 px-1.5 py-px rounded text-[10px] font-semibold uppercase" style={{background:a?'rgba(34,197,94,0.10)':p?'rgba(245,158,11,0.10)':'rgba(255,255,255,0.05)',color:a?Gn:p?Am:Gy}}>{a?<Play size={8}/>:p?<Pause size={8}/>:null}{s.replace(/_/g,' ')}</span>;};
const ObjBg = ({o}:{o:string})=>{const c=o==='Demand Capture';return <span className="inline-flex items-center px-1.5 py-px rounded text-[10px] font-medium uppercase" style={{background:c?'rgba(96,165,250,0.08)':'rgba(167,139,250,0.08)',color:c?Bl:Pr,border:`1px solid ${c?'rgba(96,165,250,0.15)':'rgba(167,139,250,0.15)'}`}}>{o}</span>;};
const EffBg = ({e}:{e:'over'|'healthy'|'under'})=>{const m={over:{icon:<ArrowDown size={10}/>,l:'Over',bg:'rgba(239,68,68,0.08)',col:Rd},healthy:{icon:<Minus size={10}/>,l:'Steady',bg:'rgba(245,158,11,0.08)',col:Am},under:{icon:<ArrowUp size={10}/>,l:'Scale',bg:'rgba(34,197,94,0.08)',col:Gn}}[e];return <span className="inline-flex items-center gap-1 px-1.5 py-px rounded text-[10px] font-semibold uppercase" style={{background:m.bg,color:m.col}}>{m.icon}{m.l}</span>;};

// ─── Metric pill ────────────────────────────────────────────────
function MPill({label,value,color,mono}:{label:string;value:string;color?:string;mono?:boolean}){
  return <div className="flex flex-col items-end gap-1">
    <span className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">{label}</span>
    <span className={`text-sm font-semibold ${mono?'font-mono':''}`} style={{color:color||W}}>{value}</span>
  </div>;
}

// ─── Stat card ──────────────────────────────────────────────────
function Stat({l,v,s,i,c}:{l:string;v:string;s:string;i:React.ReactNode;c:string}){
  return <div className="rounded-xl p-4" style={{background:'#111',border:`1px solid ${W2}`}}>
    <div className="flex items-center gap-2 mb-2" style={{color:c}}>{i}<span className="text-xs font-medium text-gray-500 uppercase tracking-wider">{l}</span></div>
    <div className="text-xl font-bold text-[#F5F5F8] mb-0.5">{v}</div>
    <div className="text-xs text-gray-500">{s}</div>
  </div>;
}

// ─── Page ───────────────────────────────────────────────────────
export default function GeoPerformancePage(){
  const router=useRouter();const sup=createClient();
  const [brands,setBrands]=useState<Brand[]>([]);
  const [bid,setBid]=useState('');
  const [dr,setDr]=useState<DateRange>('last_30d');
  const [bc,setBc]=useState('auto');
  const [loading,setLoading]=useState(false);
  const [data,setData]=useState<GeoResponse|null>(null);
  const [token,setToken]=useState('');
  const [profile,setProfile]=useState<{role:string;brand_id:string}|null>(null);
  const [exp,setExp]=useState<Set<string>>(new Set());
  const [bo,setBo]=useState(false);const[do_,setDo]=useState(false);

  useEffect(()=>{(async()=>{
    const{data:{session}}=await sup.auth.getSession();
    if(!session){router.push('/');return;}
    setToken(session.access_token);
    const{data:p}=await sup.from('users_profile').select('role,brand_id').eq('id',session.user.id).single();
    if(p)setProfile(p);
    const{data:bl}=await sup.from('brands').select('id,name,slug').is('archived_at',null).order('name');
    if(bl){setBrands(bl);const sv=localStorage.getItem('melch_sel_geo');
      if(sv&&bl.find((b:any)=>b.id===sv))setBid(sv);
      else if(p?.brand_id&&bl.find((b:any)=>b.id===p.brand_id))setBid(p.brand_id);
      else if(bl.length>0)setBid(bl[0].id);}
  })();},[]); // eslint-disable-line

  const fetchData=async()=>{if(!bid||!token)return;setLoading(true);try{const r=await fetch(`/api/geo-performance?brandId=${bid}&dateRange=${dr}${bc!=='auto'?`&baseCurrency=${bc}`:''}`,{headers:{Authorization:`Bearer ${token}`}});const j=await r.json();if(r.ok)setData(j);}catch{}setLoading(false);};
  useEffect(()=>{fetchData();},[bid,dr,bc,token]); // eslint-disable-line
  useEffect(()=>{if(bid)localStorage.setItem('melch_sel_geo',bid);},[bid]);

  const chartData=useMemo(()=>data?data.countries.slice(0,6).map(c=>({country:c.flag+' '+c.country,name:c.country_name,spend:c.normalized_total_spend,revenue:c.normalized_revenue})):[],[data]);
  const scatterData=useMemo(()=>data?data.countries.map(c=>({country:c.flag+' '+c.country,spend:c.normalized_total_spend,amer:c.amer??0,eff:c.spend_efficiency,flag:c.flag,name:c.country_name})):[],[data]);
  const effCurr=bc==='auto'?(data?.baseCurrency||'USD'):bc;
  const sym=$sym(effCurr);const sb=brands.find(b=>b.id===bid);const dl=DATE_RANGES.find(d=>d.value===dr)?.label||'';
  const toggle=(cc:string)=>setExp(p=>{const n=new Set(p);n.has(cc)?n.delete(cc):n.add(cc);return n;});
  const so=data?.totals?.shopify_connected??false;

  return (
    <div className="min-h-screen" style={{background:'#0A0A0A'}}>
      <Navbar>
        <div className="p-6 max-w-7xl mx-auto">

          {/* ── Header ── */}
          <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
            <div>
              <h1 className="text-2xl font-bold text-white flex items-center gap-2"><Globe size={24} style={{color:G}}/>Geo Performance</h1>
              <p className="text-sm text-gray-400 mt-1">Base {effCurr} (auto) &middot; Shopify {data?.shopify_currency||'?'} &middot; Meta {data?.meta_currency||'?'} &middot; Google {data?.google_currency||'?'} &middot; IF {data?.totals?.if_factor||'…'}×</p>
            </div>
            <button onClick={fetchData} disabled={loading} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium" style={{background:Gd,color:G,border:`1px solid rgba(200,184,154,0.2)`}}><RefreshCw size={14} className={loading?'animate-spin':''}/>Refresh</button>
          </div>

          {/* ── Warnings ── */}
          {data?.warnings?.map((w,i)=><div key={i} className="mb-4 p-3 rounded-lg flex items-start gap-2 text-sm" style={{background:'rgba(245,158,11,0.08)',border:'1px solid rgba(245,158,11,0.15)',color:Am}}><AlertTriangle size={14} style={{flexShrink:0,marginTop:1}}/>{w}</div>)}
          {data?.errors?.map((e,i)=><div key={i} className="mb-4 p-3 rounded-lg flex items-start gap-2 text-sm" style={{background:'rgba(239,68,68,0.1)',border:'1px solid rgba(239,68,68,0.2)',color:'#FCA5A5'}}><AlertTriangle size={14} style={{flexShrink:0,marginTop:1}}/>{e}</div>)}

          {/* ── Controls ── */}
          <div className="flex flex-wrap items-center gap-3 mb-8">
            <div className="relative"><button onClick={()=>{setBo(!bo);setDo(false)}} className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium" style={{background:'#111',border:`1px solid ${W8}`,color:W}}>{sb?.name||'Select Brand'}<ChevronDown size={14} className={bo?'rotate-180':''}/></button>
              {bo&&<><div className="fixed inset-0 z-10" onClick={()=>setBo(false)}/><div className="absolute top-full left-0 mt-1 w-56 rounded-lg z-20 py-1 max-h-64 overflow-y-auto" style={{background:'#111',border:`1px solid ${W8}`,boxShadow:'0 8px 32px rgba(0,0,0,0.4)'}}>{brands.map(b=><button key={b.id} onClick={()=>{setBid(b.id);setBo(false)}} className="w-full flex items-center gap-2 px-4 py-2 text-sm text-left" style={{color:b.id===bid?G:'#888',background:b.id===bid?Gd:'transparent'}}>{b.id===bid&&<Check size={14} style={{color:G}}/>}<span className={b.id===bid?'':'ml-[22px]'}>{b.name}</span></button>)}</div></>}</div>
            <div className="relative"><button onClick={()=>{setDo(!do_);setBo(false)}} className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium" style={{background:'#111',border:`1px solid ${W8}`,color:W}}>{dl}<ChevronDown size={14} className={do_?'rotate-180':''}/></button>
              {do_&&<><div className="fixed inset-0 z-10" onClick={()=>setDo(false)}/><div className="absolute top-full left-0 mt-1 w-48 rounded-lg z-20 py-1" style={{background:'#111',border:`1px solid ${W8}`,boxShadow:'0 8px 32px rgba(0,0,0,0.4)'}}>{DATE_RANGES.map(d=><button key={d.value} onClick={()=>{setDr(d.value);setDo(false)}} className="w-full flex items-center gap-2 px-4 py-2 text-sm text-left" style={{color:d.value===dr?G:'#888',background:d.value===dr?Gd:'transparent'}}>{d.value===dr&&<Check size={14} style={{color:G}}/>}<span className={d.value===dr?'':'ml-[22px]'}>{d.label}</span></button>)}</div></>}</div>
            <select value={bc} onChange={(e)=>setBc(e.target.value)} className="px-3 py-2.5 rounded-lg text-sm font-medium" style={{background:'#111',border:`1px solid ${W8}`,color:W}} title="Display currency — 'auto' = Shopify store currency">{BASE_CURRENCIES.map(c=><option key={c} value={c}>{c==='auto'?`Auto (${data?.baseCurrency||'?'})`:c}</option>)}</select>
            {loading&&<Loader size={18} className="animate-spin text-gray-500"/>}
          </div>

          {/* ── Top stats ── */}
          {data&&!loading&&<div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <Stat l="Meta ROAS" v={Rx(data.totals.meta_roas)} s="Purchase value ÷ spend" i={<TrendingUp size={18}/>} c={data.totals.meta_roas>=1.5?Gn:data.totals.meta_roas>=1?Am:Rd}/>
            <Stat l="aMER" v={Rna(data.totals.amer)} s={so?'NC rev ÷ total spend':'No Shopify data'} i={<Gauge size={18}/>} c={!so?'#666':(data.totals.amer??0)>=1.5?Gn:(data.totals.amer??0)>=0.8?Am:Rd}/>
            <Stat l="Inc. ROAS" v={Rx(data.totals.inc_roas)} s={`× IF ${data.totals.if_factor}`} i={<Zap size={18}/>} c={data.totals.inc_roas>=2?Gn:data.totals.inc_roas>=1.2?Am:Rd}/>
            <Stat l="Gross Margin" v={`${data.totals.brand_gross_margin_pct}%`} s={data.totals.brand_gross_margin_pct>=35?'Strong buffer':'Tight margin'} i={<BarChart3 size={18}/>} c={data.totals.brand_gross_margin_pct>=35?Gn:Am}/>
          </div>}

          {loading&&<div className="flex items-center justify-center py-24"><Loader size={32} className="animate-spin" style={{color:G}}/><span className="ml-3 text-gray-400">Loading…</span></div>}
          {!loading&&!data&&<div className="flex flex-col items-center justify-center py-24 text-gray-500"><Globe size={48} className="mb-4 opacity-30"/><p>Select a brand to view geo performance</p></div>}

          {/* ── Charts ── */}
          {!loading&&chartData.length>0&&<div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-10">
            <div className="rounded-xl p-5" style={{background:'#111',border:`1px solid ${W2}`}}>
              <h3 className="text-sm font-semibold text-gray-300 mb-4">Spend vs Revenue ({bc})</h3>
              <ResponsiveContainer width="100%" height={270}><BarChart data={chartData} margin={{top:5,right:20,left:10,bottom:5}}><CartesianGrid stroke="rgba(255,255,255,0.04)" strokeDasharray="3 3"/><XAxis dataKey="country" tick={{fill:'#888',fontSize:11}} axisLine={{stroke:W2}}/><YAxis tick={{fill:'#888',fontSize:11}} axisLine={{stroke:W2}} tickFormatter={(v:any)=>$k(Number(v),sym)}/><Tooltip contentStyle={{background:'#1a1a1a',border:`1px solid ${W10}`,borderRadius:'8px',fontSize:'13px'}} formatter={(v:any,n:any)=>[$f(Number(v),sym),String(n)]}/><Bar dataKey="spend" name="Spend" fill={G} radius={[4,4,0,0]}/><Bar dataKey="revenue" name="Revenue" fill={Bl} radius={[4,4,0,0]}/></BarChart></ResponsiveContainer>
            </div>
            <div className="rounded-xl p-5" style={{background:'#111',border:`1px solid ${W2}`}}>
              <h3 className="text-sm font-semibold text-gray-300 mb-4">Spending Power — Spend vs aMER</h3>
              {scatterData.length>0&&<ResponsiveContainer width="100%" height={270}><ScatterChart margin={{top:5,right:20,left:10,bottom:5}}><CartesianGrid stroke="rgba(255,255,255,0.04)" strokeDasharray="3 3"/><XAxis type="number" dataKey="spend" name="Spend" tick={{fill:'#888',fontSize:11}} axisLine={{stroke:W2}} tickFormatter={(v:any)=>$k(Number(v),sym)}/><YAxis type="number" dataKey="amer" name="aMER" tick={{fill:'#888',fontSize:11}} axisLine={{stroke:W2}} tickFormatter={(v:any)=>Rx(Number(v))} domain={[0,'auto']}/><ZAxis range={[80,80]}/><Tooltip cursor={{strokeDasharray:'3 3'}} contentStyle={{background:'#1a1a1a',border:`1px solid ${W10}`,borderRadius:'8px',fontSize:'12px'}} formatter={(v:any,n:any)=>[n==='amer'?Rna(Number(v)):$f(Number(v),sym),n==='amer'?'aMER':'Spend']} labelFormatter={(l:any)=>$f(Number(l),sym)}/>{['over','healthy','under'].map(e=><Scatter key={e} name={e} data={scatterData.filter(d=>d.eff===e)} fill={e==='over'?Rd:e==='under'?Gn:Am}/>)}</ScatterChart></ResponsiveContainer>}
              <div className="flex items-center gap-5 mt-2 justify-center"><span className="text-[10px] flex items-center gap-1.5" style={{color:Rd}}><span className="w-2 h-2 rounded-full" style={{background:Rd}}/>Overspending</span><span className="text-[10px] flex items-center gap-1.5" style={{color:Am}}><span className="w-2 h-2 rounded-full" style={{background:Am}}/>Steady</span><span className="text-[10px] flex items-center gap-1.5" style={{color:Gn}}><span className="w-2 h-2 rounded-full" style={{background:Gn}}/>Room to scale</span></div>
            </div>
          </div>}

          {/* ═══════════ COUNTRY LIST ═══════════ */}
          {!loading&&data&&data.countries.length>0&&<div className="space-y-3">

            {data.countries.map((c)=>{
              const isX=exp.has(c.country);
              const isXX=c.country==='XX';
              const maxSp=data.countries[0]?.normalized_total_spend||1;
              const bp=Math.min((c.normalized_total_spend/maxSp)*100,100);

              return <div key={c.country}>

                {/* ── COUNTRY CARD ────────────── */}
                <button onClick={()=>toggle(c.country)}
                  className="w-full rounded-xl transition-all text-left"
                  style={{background:isX?'rgba(200,184,154,0.03)':'#111',border:`1px solid ${isX?'rgba(200,184,154,0.15)':isXX?'rgba(239,68,68,0.15)':W2}`}}>

                  <div className="flex items-center gap-0 px-5 py-4">

                    {/* Chevron + Flag + Name + Currency note */}
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      {isX?<ChevronDown size={18} style={{color:G,flexShrink:0}}/>:<ChevronRight size={18} style={{color:'#555',flexShrink:0}}/>}
                      <span className="text-xl flex-shrink-0">{isXX?<HelpCircle size={20} style={{color:Rd}}/>:c.flag}</span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-base font-semibold text-white truncate">{isXX?'Unknown Country':c.country_name||c.country}</span>
                          <span className="text-xs font-mono px-1.5 py-0.5 rounded" style={{background:Gd,color:G}}>#{c.spend_rank}</span>
                          <span className="text-xs text-gray-600 font-mono">{Pf(c.spend_share)}</span>
                        </div>
                        {c.shopify_connected&&c.meta_currency!==c.shopify_currency&&
                          <div className="text-[10px] text-gray-600 mt-0.5">Meta {c.meta_currency} &middot; Shopify {c.shopify_currency}</div>}
                        {!c.shopify_connected&&
                          <div className="text-[10px] flex items-center gap-1 mt-0.5" style={{color:Am}}><AlertTriangle size={10}/>No Shopify — aMER unavailable</div>}
                      </div>
                    </div>

                    {/* Metric pills */}
                    <div className="flex items-center gap-0">
                      {/* Spend (Meta + Google) */}
                      <div className="flex flex-col items-end px-4">
                        <span className="text-[10px] font-medium text-gray-500 uppercase tracking-wider mb-0.5">Spend</span>
                        <span className="text-base font-mono font-semibold text-white">{$k(c.normalized_total_spend,sym)}</span>
                        {c.normalized_google_spend>0&&<span className="text-[9px] text-gray-600 font-mono">M {$k(c.normalized_spend,sym)} + G {$k(c.normalized_google_spend,sym)}</span>}
                      </div>
                      {/* Meta ROAS */}
                      <div className="flex flex-col items-end px-4" style={{borderLeft:`1px solid ${W4}`}}>
                        <span className="text-[10px] font-medium text-gray-500 uppercase tracking-wider mb-0.5">Meta ROAS</span>
                        <span className="text-base font-mono font-bold" style={{color:c.meta_roas>=1.5?Gn:c.meta_roas>=1?Am:Rd}}>{Rx(c.meta_roas)}</span>
                      </div>
                      {/* aMER */}
                      <div className="flex flex-col items-end px-4" style={{borderLeft:`1px solid ${W4}`}}>
                        <span className="text-[10px] font-medium text-gray-500 uppercase tracking-wider mb-0.5">aMER</span>
                        <span className="text-base font-mono font-bold" style={{color:!c.shopify_connected?'#555':(c.amer??0)>=1.5?Gn:(c.amer??0)>=0.8?Am:Rd}}>{Rna(c.amer)}</span>
                      </div>
                      {/* NC AOV */}
                      <div className="flex flex-col items-end px-4 hidden sm:flex" style={{borderLeft:`1px solid ${W4}`}}>
                        <span className="text-[10px] font-medium text-gray-500 uppercase tracking-wider mb-0.5">NC AOV</span>
                        <span className="text-base font-mono" style={{color:!c.shopify_connected?'#555':c.nc_aov!==null&&c.nc_aov>0?Bl:'#888'}}>{c.nc_aov!==null?$k(c.nc_aov,sym):'—'}</span>
                      </div>
                      {/* NCAC */}
                      <div className="flex flex-col items-end px-4 hidden sm:flex" style={{borderLeft:`1px solid ${W4}`}}>
                        <span className="text-[10px] font-medium text-gray-500 uppercase tracking-wider mb-0.5">NCAC</span>
                        <span className="text-base font-mono" style={{color:!c.shopify_connected?'#555':c.ncac!==null&&c.ncac>0&&c.ncac<(c.nc_aov??0)?Gn:Am}}>{c.ncac!==null?$k(c.ncac,sym):'—'}</span>
                      </div>
                      {/* Signal */}
                      <div className="flex flex-col items-end px-4" style={{borderLeft:`1px solid ${W4}`}}>
                        <span className="text-[10px] font-medium text-gray-500 uppercase tracking-wider mb-0.5">Signal</span>
                        <EffBg e={c.spend_efficiency}/>
                      </div>
                    </div>

                    {/* Spend bar thin strip */}
                    <div className="w-20 ml-3 hidden lg:block">
                      <div className="h-1 rounded-full" style={{background:W4}}>
                        <div className="h-full rounded-full" style={{width:`${bp}%`,background:c.spend_efficiency==='over'?Rd:G,minWidth:bp>0?'2px':0}}/>
                      </div>
                    </div>
                  </div>
                </button>

                {/* ── EXPANDED SECTION ────────── */}
                {isX&&<div className="mt-2 ml-12 space-y-3">

                  {/* Detail card */}
                  <div className="rounded-xl p-5" style={{background:'rgba(200,184,154,0.02)',border:`1px solid rgba(200,184,154,0.06)`}}>
                    <div className="flex items-center gap-2 mb-4">
                      <span className="text-lg">{c.flag}</span>
                      <span className="text-sm font-semibold text-white">{c.country_name||c.country}</span>
                      <span className="text-xs text-gray-500">&middot; {c.campaign_count} campaign{c.campaign_count!==1?'s':''} &middot; {$k(c.normalized_total_spend,sym)} total spend</span>
                    </div>

                    {/* 4-column metric grid with clear section labels */}
                    <div className="grid grid-cols-2 lg:grid-cols-5 gap-6 text-sm">
                      {/* Meta Performance */}
                      <div className="space-y-2.5">
                        <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest mb-3 pb-2" style={{borderBottom:`1px solid ${W4}`}}>Meta</div>
                        <Row l="ROAS" v={Rx(c.meta_roas)} c={c.meta_roas>=1.5?Gn:Am}/>
                        <Row l="Spend" v={$k(c.normalized_spend,sym)} c={W}/>
                        <Row l="Purchases" v={Nf(c.meta_purchases)} c='#999'/>
                        <Row l="Inc. ROAS" v={Rx(c.inc_roas)} c={c.inc_roas>=2?Gn:'#999'}/>
                      </div>
                      {/* Google */}
                      <div className="space-y-2.5">
                        <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest mb-3 pb-2" style={{borderBottom:`1px solid ${W4}`}}>Google</div>
                        <Row l="Spend" v={c.normalized_google_spend>0?$k(c.normalized_google_spend,sym):'—'} c={c.normalized_google_spend>0?'#999':'#555'}/>
                        <Row l="Acct Curr" v={c.google_currency} c='#999'/>
                      </div>
                      {/* Shopify NC */}
                      <div className="space-y-2.5">
                        <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest mb-3 pb-2" style={{borderBottom:`1px solid ${W4}`}}>Shopify</div>
                        <Row l="aMER" v={Rna(c.amer)} c={!so?'#555':c.amer!==null&&c.amer>=1.5?Gn:c.amer!==null&&c.amer>=0.8?Am:'#999'}/>
                        <Row l="NC AOV" v={c.nc_aov!==null?$k(c.nc_aov,sym):'—'} c={!so?'#555':Bl}/>
                        <Row l="NCAC" v={c.ncac!==null?$k(c.ncac,sym):'—'} c={!so?'#555':c.ncac!==null&&c.ncac<(c.nc_aov??Infinity)?Gn:Am}/>
                        <Row l="ROAS−aMER" v={c.roas_vs_amer_gap!==null?Rx(c.roas_vs_amer_gap):'—'} c='#999'/>
                      </div>
                      {/* Orders */}
                      <div className="space-y-2.5">
                        <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest mb-3 pb-2" style={{borderBottom:`1px solid ${W4}`}}>Orders</div>
                        <Row l="NC Orders" v={so?Nf(c.shopify_nc_orders):'—'} c='#999'/>
                        <Row l="Total Orders" v={so?Nf(c.shopify_orders):'—'} c='#999'/>
                      </div>
                      {/* Position */}
                      <div className="space-y-2.5">
                        <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest mb-3 pb-2" style={{borderBottom:`1px solid ${W4}`}}>Position</div>
                        <Row l="Spend Rank" v={`#${c.spend_rank}`} c={G}/>
                        <Row l="aMER Rank" v={`#${c.amer_rank}`} c={Bl}/>
                        {c.cta&&<div className="text-xs mt-2 px-2 py-1.5 rounded-lg" style={{background:c.spend_efficiency==='over'?'rgba(239,68,68,0.08)':c.spend_efficiency==='under'?'rgba(34,197,94,0.08)':Gd,color:c.spend_efficiency==='over'?Rd:c.spend_efficiency==='under'?Gn:Am,border:`1px solid ${c.spend_efficiency==='over'?'rgba(239,68,68,0.15)':c.spend_efficiency==='under'?'rgba(34,197,94,0.15)':W4}`}}>{c.cta}</div>}
                      </div>
                    </div>
                  </div>

                  {/* Campaign table */}
                  {c.campaigns.length>0&&<div className="rounded-xl overflow-hidden" style={{border:`1px solid ${W4}`}}>
                    <div className="px-5 py-2.5 text-[10px] font-semibold text-gray-500 uppercase tracking-widest" style={{background:'rgba(255,255,255,0.012)'}}>Campaigns</div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead><tr style={{background:'rgba(255,255,255,0.015)',borderBottom:`1px solid ${W4}`}}>
                          <th className="text-left py-2.5 pl-5 pr-3 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Campaign</th>
                          <th className="text-left py-2.5 px-3 text-[10px] font-semibold text-gray-500 uppercase tracking-wider hidden sm:table-cell">Obj</th>
                          <th className="text-left py-2.5 px-3 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                          <th className="text-right py-2.5 px-3 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Spend</th>
                          <th className="text-right py-2.5 px-3 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">ROAS</th>
                          <th className="text-right py-2.5 px-3 text-[10px] font-semibold text-gray-500 uppercase tracking-wider hidden sm:table-cell">AOV</th>
                          <th className="text-right py-2.5 px-3 text-[10px] font-semibold text-gray-500 uppercase tracking-wider hidden sm:table-cell">CPA</th>
                          <th className="text-center py-2.5 pr-5 pl-3 text-[10px] font-semibold text-gray-500 uppercase tracking-wider hidden md:table-cell">Geo</th>
                        </tr></thead>
                        <tbody>
                          {c.campaigns.map(camp=>{const cp=c.normalized_spend>0?(camp.normalized_spend/c.normalized_spend)*100:0;
                            return <tr key={camp.campaign_id} className="hover:bg-white/[0.015] transition-colors" style={{borderBottom:`1px solid ${W4}`}}>
                              <td className="py-3 pl-5 pr-3">
                                <div className="text-[13px] font-medium text-[#F5F5F8] whitespace-normal break-words min-w-[180px] max-w-[400px]" title={camp.campaign_name}>{camp.campaign_name}</div>
                                <div className="flex items-center gap-2 mt-0.5">
                                  <span className="text-[10px] font-mono text-gray-600 bg-white/[0.03] px-1 py-px rounded">#{camp.spend_rank}</span>
                                  <span className="text-[10px] text-gray-600">{Pf(cp)}</span>
                                </div>
                              </td>
                              <td className="py-3 px-3 hidden sm:table-cell"><ObjBg o={camp.campaign_type}/></td>
                              <td className="py-3 px-3"><SBadge s={camp.status}/></td>
                              <td className="py-3 px-3 text-right font-mono text-[13px] text-white">{$k(camp.normalized_spend,sym)}</td>
                              <td className="py-3 px-3 text-right font-mono text-[13px] font-bold"><span style={{color:camp.normalized_roas>=1.5?Gn:camp.normalized_roas>=1?Am:Rd}}>{Rx(camp.normalized_roas)}</span></td>
                              <td className="py-3 px-3 text-right font-mono text-[13px] hidden sm:table-cell" style={{color:camp.aov>0?Bl:'#888'}}>{$k(camp.aov,sym)}</td>
                              <td className="py-3 px-3 text-right font-mono text-[13px] hidden sm:table-cell" style={{color:camp.cpa>0&&camp.cpa<camp.aov?Gn:'#888'}}>{$k(camp.cpa,sym)}</td>
                              <td className="py-3 pr-5 pl-3 text-center hidden md:table-cell"><span className="text-[10px] font-mono text-gray-600 bg-white/[0.03] px-1.5 py-0.5 rounded">{camp.raw_country}</span></td>
                            </tr>;})}
                        </tbody>
                      </table>
                    </div>
                  </div>}

                </div>}
              </div>;
            })}
          </div>}

        </div>
      </Navbar>
    </div>
  );
}

// ─── Metric row helper ─────────────────────────────────────────
function Row({l,v,c}:{l:string;v:string;c:string}){
  return <div className="flex items-center gap-2">
    <span className="text-xs font-medium text-gray-600 w-20 flex-shrink-0">{l}</span>
    <span className="font-mono text-sm font-semibold" style={{color:c}}>{v}</span>
  </div>;
}