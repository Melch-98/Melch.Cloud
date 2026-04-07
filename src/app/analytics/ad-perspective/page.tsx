'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Loader,
  ChevronDown,
  RefreshCw,
  AlertCircle,
  TableProperties,
  TrendingUp,
  DollarSign,
  Target,
  Award,
  BarChart3,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Info,
  Zap,
  Eye,
  X,
  Download,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize2,
  Image as ImageIcon,
} from 'lucide-react';
import Navbar from '@/components/Navbar';
import { createClient } from '@/lib/supabase';
import DataFreshness, { friendlyError } from '@/components/DataFreshness';
import type { MetaAdInsight } from '@/lib/meta-api';

// ─── Types & Config ─────────────────────────────────────────────

interface PercentileRow {
  percentile: number;
  spend: number;
  spendCount: number;
  sos: number; // share of spend cumulative %
  revenue: number;
  revenueCount: number;
  sor: number; // share of revenue cumulative %
  purchases: number;
  purchasesCount: number;
  sop: number; // share of purchases cumulative %
  cpa: number;
  cpaCount: number;
  roas: number;
  roasCount: number;
}

interface RankRow {
  label: string;
  spend: number;
  revenue: number;
  purchases: number;
  cpa: number;
  roas: number;
  count: number;
  avgPercentile: number;
  hitRate: number;
}

const fmt = {
  currency: (v: number) =>
    `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
  currencyShort: (v: number) =>
    v >= 10000 ? `$${(v / 1000).toFixed(1)}k` : `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
  pct: (v: number) => `${(v * 100).toFixed(0)}%`,
  pctDetail: (v: number) => `${(v * 100).toFixed(2)}%`,
  num: (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 0 }),
  x: (v: number) => v.toFixed(2),
};

// ─── Date Presets ──────────────────────────────────────────────

function dateStr(d: Date): string {
  return d.toISOString().split('T')[0];
}

function getDatePreset(preset: string): { from: string; to: string; label: string } {
  const now = new Date();
  const to = dateStr(now);
  switch (preset) {
    case '7d': { const d = new Date(now); d.setDate(d.getDate() - 7); return { from: dateStr(d), to, label: 'Last 7 days' }; }
    case '14d': { const d = new Date(now); d.setDate(d.getDate() - 14); return { from: dateStr(d), to, label: 'Last 14 days' }; }
    case '30d': { const d = new Date(now); d.setDate(d.getDate() - 30); return { from: dateStr(d), to, label: 'Last 30 days' }; }
    case '60d': { const d = new Date(now); d.setDate(d.getDate() - 60); return { from: dateStr(d), to, label: 'Last 60 days' }; }
    case '90d': { const d = new Date(now); d.setDate(d.getDate() - 90); return { from: dateStr(d), to, label: 'Last 90 days' }; }
    case '6m': { const d = new Date(now); d.setMonth(d.getMonth() - 6); return { from: dateStr(d), to, label: 'Last 6 months' }; }
    case '12m': { const d = new Date(now); d.setFullYear(d.getFullYear() - 1); return { from: dateStr(d), to, label: 'Last 12 months' }; }
    case 'all': { return { from: '2020-01-01', to, label: 'All time' }; }
    default: { const d = new Date(now); d.setDate(d.getDate() - 30); return { from: dateStr(d), to, label: 'Last 30 days' }; }
  }
}

// ─── Ad Detail Sidecar ────────────────────────────────────────

function AdDetailPanel({ ad, onClose, roasFloor }: { ad: MetaAdInsight; onClose: () => void; roasFloor: number }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);

  const isVideo = ad.creative_type === 'VIDEO' && ad.video_url;

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { v.play(); setIsPlaying(true); } else { v.pause(); setIsPlaying(false); }
  };
  const toggleMute = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setIsMuted(v.muted);
  };
  const handleTimeUpdate = () => {
    const v = videoRef.current;
    if (!v || !v.duration) return;
    setCurrentTime(v.currentTime);
    setProgress((v.currentTime / v.duration) * 100);
  };
  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const v = videoRef.current;
    if (!v || !v.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    v.currentTime = pct * v.duration;
  };
  const handleFullscreen = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.requestFullscreen) v.requestFullscreen();
  };
  const fmtTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const metricGroups = [
    {
      title: 'Financial',
      metrics: [
        { label: 'Spend', value: fmt.currency(ad.spend) },
        { label: 'Revenue', value: fmt.currency(ad.purchase_value) },
        { label: 'ROAS', value: fmt.x(ad.roas), highlight: ad.roas >= roasFloor },
        { label: 'CPA', value: fmt.currency(ad.cpa) },
        { label: 'AOV', value: fmt.currency(ad.aov) },
      ],
    },
    {
      title: 'Engagement',
      metrics: [
        { label: 'Link CTR', value: `${ad.link_ctr.toFixed(2)}%` },
        { label: 'CTR (all)', value: `${ad.ctr.toFixed(2)}%` },
        { label: 'CPM', value: fmt.currency(ad.cpm) },
        { label: 'CPC', value: fmt.currency(ad.cpc) },
        { label: 'Thumbstop / Hookrate', value: `${ad.thumbstop_rate.toFixed(2)}%` },
      ],
    },
    {
      title: 'Conversions',
      metrics: [
        { label: 'Purchases', value: fmt.num(ad.purchases) },
        { label: 'Add to Cart', value: fmt.num(ad.add_to_cart) },
        { label: 'Checkout', value: fmt.num(ad.initiate_checkout) },
        { label: 'Cost/Purchase', value: fmt.currency(ad.cost_per_purchase) },
        { label: 'Cost/ATC', value: fmt.currency(ad.cost_per_atc) },
      ],
    },
    {
      title: 'Delivery',
      metrics: [
        { label: 'Impressions', value: fmt.num(ad.impressions) },
        { label: 'Reach', value: fmt.num(ad.reach) },
        { label: 'Frequency', value: fmt.x(ad.frequency) },
        { label: 'Clicks', value: fmt.num(ad.clicks) },
      ],
    },
  ];

  if (ad.creative_type === 'VIDEO') {
    metricGroups.push({
      title: 'Video Retention',
      metrics: [
        { label: '25% watched', value: fmt.num(ad.video_play_25) },
        { label: '50% watched', value: fmt.num(ad.video_play_50) },
        { label: '75% watched', value: fmt.num(ad.video_play_75) },
        { label: '100% watched', value: fmt.num(ad.video_play_100) },
      ],
    });
  }

  const heroMetrics = [
    { label: 'Spend', value: fmt.currency(ad.spend), color: '#C8B89A' },
    { label: 'Revenue', value: fmt.currency(ad.purchase_value), color: '#e8dcc8' },
    { label: 'ROAS', value: `${fmt.x(ad.roas)}x`, color: ad.roas >= roasFloor ? '#10B981' : ad.roas >= 1 ? '#fbbf24' : '#ef4444' },
  ];

  const isWinner = ad.roas >= roasFloor;

  return (
    <div className="fixed inset-0 z-[100] flex">
      <div
        className="absolute inset-0 backdrop-blur-md"
        style={{ backgroundColor: 'rgba(0,0,0,0.75)' }}
        onClick={onClose}
      />
      <div
        className="relative ml-auto w-full max-w-xl h-full overflow-y-auto"
        style={{
          backgroundColor: '#080808',
          borderLeft: '1px solid rgba(200,184,154,0.08)',
          animation: 'slideInRight 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-5 right-5 z-10 w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-200"
          style={{ backgroundColor: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.06)' }}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.12)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.06)'; }}
        >
          <X size={15} style={{ color: '#888' }} />
        </button>

        {/* Creative preview */}
        <div className="relative bg-black" style={{ minHeight: '360px' }}>
          {isVideo ? (
            <div className="relative">
              <video
                ref={videoRef}
                src={ad.video_url!}
                className="w-full"
                style={{ maxHeight: '520px', objectFit: 'contain', backgroundColor: '#000' }}
                playsInline
                preload="auto"
                muted={isMuted}
                onTimeUpdate={handleTimeUpdate}
                onLoadedMetadata={() => {
                  if (videoRef.current) setDuration(videoRef.current.duration);
                }}
                onEnded={() => setIsPlaying(false)}
                onClick={togglePlay}
              />
              {/* Play overlay */}
              {!isPlaying && (
                <div
                  className="absolute inset-0 flex items-center justify-center cursor-pointer"
                  onClick={togglePlay}
                >
                  <div
                    className="w-16 h-16 rounded-2xl flex items-center justify-center transition-transform hover:scale-110"
                    style={{ backgroundColor: 'rgba(200,184,154,0.9)', backdropFilter: 'blur(16px)' }}
                  >
                    <Play size={28} fill="#0a0a0a" style={{ color: '#0a0a0a', marginLeft: '3px' }} />
                  </div>
                </div>
              )}
              {/* Video controls bar */}
              <div
                className="absolute bottom-0 left-0 right-0 px-5 py-4"
                style={{ background: 'linear-gradient(transparent, rgba(0,0,0,0.9))' }}
              >
                <div
                  className="w-full h-1 rounded-full cursor-pointer mb-3 group"
                  style={{ backgroundColor: 'rgba(255,255,255,0.1)' }}
                  onClick={handleSeek}
                >
                  <div
                    className="h-full rounded-full transition-all relative"
                    style={{ width: `${progress}%`, backgroundColor: '#C8B89A' }}
                  >
                    <div
                      className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                      style={{ transform: 'translate(50%, -50%)', backgroundColor: '#C8B89A' }}
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <button onClick={togglePlay} className="transition-colors" style={{ color: '#C8B89A' }}>
                      {isPlaying ? <Pause size={18} /> : <Play size={18} fill="#C8B89A" />}
                    </button>
                    <button onClick={toggleMute} className="text-white/50 hover:text-white/80 transition-colors">
                      {isMuted ? <VolumeX size={17} /> : <Volume2 size={17} />}
                    </button>
                    <span className="text-[11px] font-mono tabular-nums" style={{ color: 'rgba(200,184,154,0.5)' }}>
                      {fmtTime(currentTime)} / {fmtTime(duration)}
                    </span>
                  </div>
                  <button onClick={handleFullscreen} className="text-white/40 hover:text-white/70 transition-colors">
                    <Maximize2 size={15} />
                  </button>
                </div>
              </div>
            </div>
          ) : ad.thumbnail_url ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={ad.thumbnail_url}
                alt={ad.ad_name}
                className="w-full"
                style={{ maxHeight: '520px', objectFit: 'contain', backgroundColor: '#000' }}
              />
            </>
          ) : (
            <div className="w-full flex items-center justify-center" style={{ height: '360px' }}>
              <ImageIcon size={48} style={{ color: '#1a1a1a' }} />
            </div>
          )}
        </div>

        {/* Winner/Loser banner header */}
        <div
          className="px-6 pt-6 pb-5"
          style={{
            background: isWinner
              ? 'linear-gradient(135deg, rgba(200,184,154,0.1), rgba(16,185,129,0.05))'
              : 'linear-gradient(135deg, rgba(255,255,255,0.02), rgba(255,255,255,0.01))',
            borderBottom: `1px solid ${isWinner ? 'rgba(200,184,154,0.12)' : 'rgba(255,255,255,0.04)'}`,
          }}
        >
          {/* Status badge */}
          <div className="flex items-center gap-2 mb-3">
            <span
              className="text-[9px] font-bold uppercase tracking-[0.15em] px-2.5 py-1 rounded-full"
              style={{
                backgroundColor: isWinner ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.1)',
                color: isWinner ? '#10B981' : '#ef4444',
                border: `1px solid ${isWinner ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.15)'}`,
              }}
            >
              {isWinner ? 'Winner' : ad.roas >= 1 ? 'Break Even' : 'Below Target'}
            </span>
            <span
              className="text-[9px] font-bold uppercase tracking-[0.15em] px-2.5 py-1 rounded-full"
              style={{
                backgroundColor: 'rgba(255,255,255,0.04)',
                color: '#666',
                border: '1px solid rgba(255,255,255,0.06)',
              }}
            >
              {ad.creative_type}
            </span>
          </div>

          <h3 className="text-[15px] font-semibold mb-1.5" style={{ color: '#f0f0f0', letterSpacing: '-0.01em' }}>
            {ad.ad_name}
          </h3>
          <p className="text-[11px] font-medium" style={{ color: '#555' }}>
            {ad.campaign_name}
          </p>
          {ad.adset_name && (
            <p className="text-[11px] mt-0.5" style={{ color: '#444' }}>
              {ad.adset_name}
            </p>
          )}
        </div>

        {/* Hero metric cards */}
        <div className="px-6 py-4">
          <div className="grid grid-cols-3 gap-3">
            {heroMetrics.map((hm) => (
              <div
                key={hm.label}
                className="rounded-xl p-3 text-center"
                style={{
                  backgroundColor: 'rgba(255,255,255,0.025)',
                  border: '1px solid rgba(255,255,255,0.04)',
                }}
              >
                <p className="text-[9px] uppercase tracking-widest font-semibold mb-1.5" style={{ color: '#4a4a4a' }}>
                  {hm.label}
                </p>
                <p className="text-[16px] font-bold tabular-nums" style={{ color: hm.color, letterSpacing: '-0.02em' }}>
                  {hm.value}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Divider */}
        <div className="mx-6 mb-1" style={{ borderBottom: '1px solid rgba(200,184,154,0.06)' }} />

        {/* Metric groups */}
        <div className="px-6 pb-8 space-y-5 pt-4">
          {metricGroups.map((group) => (
            <div key={group.title}>
              <h4 className="text-[10px] font-bold uppercase tracking-[0.15em] mb-3" style={{ color: '#C8B89A' }}>
                {group.title}
              </h4>
              <div
                className="rounded-xl overflow-hidden"
                style={{ backgroundColor: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)' }}
              >
                {group.metrics.map((m, idx) => (
                  <div
                    key={m.label}
                    className="flex items-center justify-between px-4 py-2.5"
                    style={{ borderBottom: idx < group.metrics.length - 1 ? '1px solid rgba(255,255,255,0.03)' : 'none' }}
                  >
                    <span className="text-[11px] font-medium" style={{ color: '#666' }}>{m.label}</span>
                    <span
                      className="text-[13px] font-bold tabular-nums"
                      style={{
                        color: ('highlight' in m && m.highlight) ? '#10B981' : '#e0e0e0',
                        backgroundColor: ('highlight' in m && m.highlight) ? 'rgba(16,185,129,0.1)' : 'transparent',
                        padding: ('highlight' in m && m.highlight) ? '2px 8px' : '0',
                        borderRadius: ('highlight' in m && m.highlight) ? '6px' : '0',
                        letterSpacing: '-0.01em',
                      }}
                    >
                      {m.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <style jsx>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────

export default function AdPerspectivePage() {
  const router = useRouter();
  const supabase = createClient();

  // State
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ads, setAds] = useState<MetaAdInsight[]>([]);
  const [accounts, setAccounts] = useState<{ id: string; name: string; brand_id?: string }[]>([]);
  const [selectedAccount, setSelectedAccount] = useState('');
  const [datePreset, setDatePreset] = useState('90d');
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [isCached, setIsCached] = useState(false);

  // Settings (user-adjustable)
  const [percentileInterval, setPercentileInterval] = useState(5);
  const [roasFloor, setRoasFloor] = useState(1.5);
  const [staticCost, setStaticCost] = useState(50);
  const [videoCost, setVideoCost] = useState(150);
  const [includeProductionCost, setIncludeProductionCost] = useState(false);

  // Chart
  const [chartMetric, setChartMetric] = useState<'spend' | 'revenue' | 'purchases' | 'roas' | 'cpa'>('spend');

  // Outlier sort
  const [outlierSort, setOutlierSort] = useState<{ field: string; dir: 'asc' | 'desc' }>({ field: 'spend', dir: 'desc' });

  // Sidecar
  const [selectedAd, setSelectedAd] = useState<MetaAdInsight | null>(null);
  // authToken kept for API calls
  const [authToken, setAuthToken] = useState<string | null>(null);

  // Auth check + fetch accounts
  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push('/'); return; }
      setAuthToken(session.access_token);
      try {
        const res = await fetch('/api/meta-insights?action=accounts', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (res.ok) {
          const data = await res.json();
          const accts = data.accounts || [];
          setAccounts(accts);
          if (accts.length > 0) {
            const savedBrand = localStorage.getItem('melch_selected_brand');
            const match = savedBrand && accts.find((a: any) => a.brand_id === savedBrand);
            setSelectedAccount(match ? match.id : accts[0].id);
          }
        }
      } catch (e) { console.error('Failed to load accounts:', e); }
    };
    init();
  }, [router, supabase]);

  // Fetch ads
  const fetchData = useCallback(async () => {
    if (!selectedAccount) return;
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const { from, to } = getDatePreset(datePreset);
      const res = await fetch(
        `/api/meta-insights?account_id=${selectedAccount}&date_from=${from}&date_to=${to}&limit=200`,
        { headers: { Authorization: `Bearer ${session.access_token}` } }
      );
      if (!res.ok) { const err = await res.json(); throw new Error(err.error || 'Failed to fetch'); }
      const data = await res.json();
      setAds(data.insights || []);
      setCachedAt(data.cached_at || null);
      setIsCached(!!data.cached);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, [selectedAccount, datePreset, supabase]);

  useEffect(() => {
    if (selectedAccount) fetchData();
  }, [selectedAccount, datePreset, fetchData]);

  // ─── Computed Analysis ──────────────────────────────────────

  // Sort ads by spend descending
  const sortedAds = useMemo(() =>
    [...ads].filter(a => a.spend > 0).sort((a, b) => b.spend - a.spend),
    [ads]
  );

  // Export CSV
  const exportCSV = useCallback(() => {
    if (sortedAds.length === 0) return;
    const top = sortedAds.slice(0, 20);
    const headers = ['Rank','Ad Name','Spend','Revenue','ROAS','Purchases','CPA','CPM','CTR','CPC','Impressions'];
    const rows = top.map((a, i) => [
      i + 1,
      `"${(a.ad_name || '').replace(/"/g, '""')}"`,
      a.spend.toFixed(2),
      a.purchase_value.toFixed(2),
      a.roas.toFixed(2),
      a.purchases,
      a.cpa.toFixed(2),
      a.cpm.toFixed(2),
      a.ctr.toFixed(2),
      a.cpc.toFixed(2),
      a.impressions,
    ].join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a2 = document.createElement('a');
    a2.href = url;
    a2.download = `ad-perspective-${datePreset}.csv`;
    a2.click();
    URL.revokeObjectURL(url);
  }, [sortedAds, datePreset]);

  const totalSpend = useMemo(() => sortedAds.reduce((s, a) => s + a.spend, 0), [sortedAds]);
  const totalRevenue = useMemo(() => sortedAds.reduce((s, a) => s + a.purchase_value, 0), [sortedAds]);
  const totalPurchases = useMemo(() => sortedAds.reduce((s, a) => s + a.purchases, 0), [sortedAds]);

  // Winners = ads meeting ROAS floor
  const winners = useMemo(() =>
    sortedAds.filter(a => a.roas >= roasFloor),
    [sortedAds, roasFloor]
  );

  // ─── Advertising Rank Table ─────────────────────────────────
  const rankTable = useMemo((): RankRow[] => {
    if (sortedAds.length === 0) return [];

    const total = sortedAds.length;

    // Winners
    const wSpend = winners.reduce((s, a) => s + a.spend, 0);
    const wRevenue = winners.reduce((s, a) => s + a.purchase_value, 0);
    const wPurchases = winners.reduce((s, a) => s + a.purchases, 0);
    const wCPA = wPurchases > 0 ? wSpend / wPurchases : 0;
    const wROAS = wSpend > 0 ? wRevenue / wSpend : 0;
    // Avg percentile for winners: their rank position
    const winnerPercentiles = winners.map(w => {
      const idx = sortedAds.indexOf(w);
      return 1 - (idx / total);
    });
    const wAvgPct = winnerPercentiles.length > 0
      ? winnerPercentiles.reduce((a, b) => a + b, 0) / winnerPercentiles.length
      : 0;

    // Average (all ads)
    const aSpend = totalSpend / total;
    const aRevenue = totalRevenue / total;
    const aPurchases = totalPurchases / total;
    const aCPA = aPurchases > 0 ? aSpend / aPurchases : 0;
    const aROAS = totalSpend > 0 ? totalRevenue / totalSpend : 0;

    // Median
    const mid = Math.floor(total / 2);
    const median = sortedAds[mid];
    const mSpend = median?.spend || 0;
    const mRevenue = median?.purchase_value || 0;
    const mPurchases = median?.purchases || 0;
    const mCPA = median?.cpa || 0;
    const mROAS = median?.roas || 0;

    return [
      {
        label: 'Winner',
        spend: winners.length > 0 ? wSpend / winners.length : 0,
        revenue: winners.length > 0 ? wRevenue / winners.length : 0,
        purchases: winners.length > 0 ? wPurchases / winners.length : 0,
        cpa: wCPA,
        roas: wROAS,
        count: winners.length,
        avgPercentile: wAvgPct,
        hitRate: total > 0 ? winners.length / total : 0,
      },
      {
        label: 'Average',
        spend: aSpend,
        revenue: aRevenue,
        purchases: aPurchases,
        cpa: aCPA,
        roas: aROAS,
        count: total,
        avgPercentile: 0.5,
        hitRate: total > 0 ? winners.length / total : 0,
      },
      {
        label: 'Median',
        spend: mSpend,
        revenue: mRevenue,
        purchases: mPurchases,
        cpa: mCPA,
        roas: mROAS,
        count: total - Math.floor(total / 2),
        avgPercentile: 0.5,
        hitRate: total > 0 ? sortedAds.filter((_, i) => i >= mid).filter(a => a.roas >= roasFloor).length / (total - mid) : 0,
      },
    ];
  }, [sortedAds, winners, totalSpend, totalRevenue, totalPurchases, roasFloor]);

  // ─── Cost 'til Next Winner ──────────────────────────────────
  const costTilWinner = useMemo(() => {
    if (sortedAds.length === 0 || winners.length === 0) return 0;
    const hitRate = winners.length / sortedAds.length;
    if (hitRate <= 0) return 0;
    const adsToTest = Math.ceil(1 / hitRate);
    const avgSpend = totalSpend / sortedAds.length;
    let cost = adsToTest * avgSpend;
    if (includeProductionCost) {
      // Estimate video vs static ratio from data
      const videoCount = sortedAds.filter(a => a.creative_type === 'VIDEO').length;
      const staticCount = sortedAds.length - videoCount;
      const videoRatio = sortedAds.length > 0 ? videoCount / sortedAds.length : 0.5;
      cost += adsToTest * (videoRatio * videoCost + (1 - videoRatio) * staticCost);
    }
    return cost;
  }, [sortedAds, winners, totalSpend, includeProductionCost, videoCost, staticCost]);

  // ─── Percentile Distribution Table ──────────────────────────
  const percentileRows = useMemo((): PercentileRow[] => {
    if (sortedAds.length === 0) return [];

    const rows: PercentileRow[] = [];
    const total = sortedAds.length;
    const step = percentileInterval / 100;

    for (let pct = 1 - step; pct >= 0; pct -= step) {
      const threshold = Math.max(0, Math.floor(pct * total));
      const topAds = sortedAds.slice(0, total - threshold);

      const spend = topAds.reduce((s, a) => s + a.spend, 0);
      const revenue = topAds.reduce((s, a) => s + a.purchase_value, 0);
      const purchases = topAds.reduce((s, a) => s + a.purchases, 0);
      const cpa = purchases > 0 ? spend / purchases : 0;
      const roas = spend > 0 ? revenue / spend : 0;

      rows.push({
        percentile: Math.round((1 - pct) * 100),
        spend,
        spendCount: topAds.length,
        sos: totalSpend > 0 ? spend / totalSpend : 0,
        revenue,
        revenueCount: topAds.length,
        sor: totalRevenue > 0 ? revenue / totalRevenue : 0,
        purchases,
        purchasesCount: topAds.length,
        sop: totalPurchases > 0 ? purchases / totalPurchases : 0,
        cpa,
        cpaCount: topAds.length,
        roas,
        roasCount: topAds.length,
      });
    }

    return rows;
  }, [sortedAds, percentileInterval, totalSpend, totalRevenue, totalPurchases]);

  // ─── Pareto Insights ────────────────────────────────────────
  const insights = useMemo(() => {
    if (sortedAds.length === 0) return [];

    const total = sortedAds.length;
    const results: string[] = [];

    // Find what % of ads drive 50%+ of spend
    let cumSpend = 0;
    for (let i = 0; i < total; i++) {
      cumSpend += sortedAds[i].spend;
      if (cumSpend >= totalSpend * 0.5) {
        const count = i + 1;
        const pct = Math.round((count / total) * 100);
        results.push(`Just ${count} (${pct}%) of ads are responsible for 50%+ of all ad spend.`);
        break;
      }
    }

    // Find what % of ads drive 50%+ of revenue
    const byRevenue = [...sortedAds].sort((a, b) => b.purchase_value - a.purchase_value);
    let cumRev = 0;
    for (let i = 0; i < total; i++) {
      cumRev += byRevenue[i].purchase_value;
      if (cumRev >= totalRevenue * 0.5) {
        const count = i + 1;
        const pct = Math.round((count / total) * 100);
        results.push(`Only ${count} (${pct}%) of ads are responsible for 50%+ of all ad revenue.`);
        break;
      }
    }

    // Find what % of ads drive 50%+ of purchases
    const byPurchases = [...sortedAds].sort((a, b) => b.purchases - a.purchases);
    let cumPurch = 0;
    for (let i = 0; i < total; i++) {
      cumPurch += byPurchases[i].purchases;
      if (cumPurch >= totalPurchases * 0.5) {
        const count = i + 1;
        const pct = Math.round((count / total) * 100);
        results.push(`${count} (${pct}%) of ads are responsible for 50%+ of all purchases.`);
        break;
      }
    }

    // Winner hit rate
    if (winners.length > 0) {
      results.push(`Winner hit rate: ${fmt.pctDetail(winners.length / total)} — you find a winner every ~${Math.ceil(total / winners.length)} ads.`);
    }

    return results;
  }, [sortedAds, totalSpend, totalRevenue, totalPurchases, winners]);

  // ─── Ad Distribution Chart Data ─────────────────────────────
  const chartData = useMemo(() => {
    if (sortedAds.length === 0) return [];
    const metricMap: Record<string, (a: MetaAdInsight) => number> = {
      spend: a => a.spend,
      revenue: a => a.purchase_value,
      purchases: a => a.purchases,
      roas: a => a.roas,
      cpa: a => a.cpa,
    };
    const getter = metricMap[chartMetric] || metricMap.spend;
    const sorted = [...sortedAds].sort((a, b) => getter(b) - getter(a));
    return sorted.map((ad, i) => ({
      index: i,
      value: getter(ad),
      name: ad.ad_name,
      isWinner: ad.roas >= roasFloor,
    }));
  }, [sortedAds, chartMetric, roasFloor]);

  const chartMax = useMemo(() => chartData.length > 0 ? Math.max(...chartData.map(d => d.value)) : 0, [chartData]);

  // ─── Outlier Table (top & bottom performers) ────────────────
  const outlierAds = useMemo(() => {
    const sorted = [...sortedAds];
    const field = outlierSort.field as keyof MetaAdInsight;
    sorted.sort((a, b) => {
      const aVal = a[field] as number;
      const bVal = b[field] as number;
      return outlierSort.dir === 'desc' ? bVal - aVal : aVal - bVal;
    });
    return sorted.slice(0, 20);
  }, [sortedAds, outlierSort]);

  const handleOutlierSort = (field: string) => {
    if (outlierSort.field === field) {
      setOutlierSort({ field, dir: outlierSort.dir === 'asc' ? 'desc' : 'asc' });
    } else {
      setOutlierSort({ field, dir: 'desc' });
    }
  };

  const OutlierSortIcon = ({ field }: { field: string }) => {
    if (outlierSort.field !== field) return <ArrowUpDown size={10} style={{ opacity: 0.3 }} />;
    return outlierSort.dir === 'asc' ? <ArrowUp size={10} style={{ color: '#C8B89A' }} /> : <ArrowDown size={10} style={{ color: '#C8B89A' }} />;
  };

  // ─── Render ─────────────────────────────────────────────────

  return (
    <Navbar>
      <div className="min-h-screen" style={{ backgroundColor: '#0A0A0A' }}>
        {/* Header */}
        <div
          className="sticky top-0 z-30"
          style={{
            backgroundColor: 'rgba(10,10,10,0.92)',
            backdropFilter: 'blur(16px)',
            borderBottom: '1px solid rgba(200,184,154,0.08)',
          }}
        >
          <div className="max-w-[1600px] mx-auto px-6 py-4">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{
                    background: 'linear-gradient(135deg, rgba(200,184,154,0.15), rgba(200,184,154,0.05))',
                    border: '1px solid rgba(200,184,154,0.2)',
                  }}
                >
                  <TableProperties size={20} style={{ color: '#C8B89A' }} />
                </div>
                <div>
                  <h1 className="text-lg font-semibold" style={{ color: '#F5F5F8' }}>
                    Perspective Ad Table
                  </h1>
                  <p className="text-xs" style={{ color: '#666' }}>
                    Understand impacts of metric relationships and account performance
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3 flex-wrap">
                {/* Account selector */}
                <div className="relative">
                  <select
                    value={selectedAccount}
                    onChange={(e) => {
                      setSelectedAccount(e.target.value);
                      const acct = accounts.find(a => a.id === e.target.value);
                      if (acct?.brand_id) localStorage.setItem('melch_selected_brand', acct.brand_id);
                    }}
                    className="appearance-none text-sm rounded-lg pl-3 pr-8 py-2 cursor-pointer"
                    style={{ backgroundColor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#F5F5F8' }}
                  >
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id} style={{ backgroundColor: '#1a1a1a' }}>{a.name}</option>
                    ))}
                  </select>
                  <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: '#666' }} />
                </div>

                {/* Date preset */}
                <div className="relative">
                  <select
                    value={datePreset}
                    onChange={(e) => setDatePreset(e.target.value)}
                    className="appearance-none text-sm rounded-lg pl-3 pr-8 py-2 cursor-pointer"
                    style={{ backgroundColor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#F5F5F8' }}
                  >
                    <option value="7d" style={{ backgroundColor: '#1a1a1a' }}>Last 7 days</option>
                    <option value="14d" style={{ backgroundColor: '#1a1a1a' }}>Last 14 days</option>
                    <option value="30d" style={{ backgroundColor: '#1a1a1a' }}>Last 30 days</option>
                    <option value="60d" style={{ backgroundColor: '#1a1a1a' }}>Last 60 days</option>
                    <option value="90d" style={{ backgroundColor: '#1a1a1a' }}>Last 90 days</option>
                  </select>
                  <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: '#666' }} />
                </div>

                <button
                  onClick={fetchData}
                  disabled={loading}
                  className="p-2 rounded-lg transition-colors"
                  style={{ backgroundColor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#888' }}
                >
                  <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                </button>

                <button
                  onClick={exportCSV}
                  disabled={sortedAds.length === 0}
                  className="p-2 rounded-lg transition-colors"
                  style={{ backgroundColor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#888' }}
                  title="Export CSV"
                >
                  <Download size={16} />
                </button>

                <DataFreshness cachedAt={cachedAt} isCached={isCached} />
              </div>
            </div>
          </div>
        </div>

        <div className="max-w-[1600px] mx-auto px-6 py-6 space-y-6">
          {/* Loading */}
          {loading && (
            <div className="flex items-center justify-center py-24">
              <Loader size={20} className="animate-spin" style={{ color: '#C8B89A' }} />
              <span className="ml-3 text-sm" style={{ color: '#888' }}>Analyzing ad performance...</span>
            </div>
          )}

          {/* Error */}
          {error && !loading && (
            <div className="rounded-xl p-6 flex items-center gap-3" style={{ backgroundColor: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.15)' }}>
              <AlertCircle size={18} style={{ color: '#dc2626' }} />
              <span className="text-sm" style={{ color: '#dc2626' }}>{friendlyError(error)}</span>
            </div>
          )}

          {/* Empty state */}
          {!loading && !error && ads.length === 0 && selectedAccount && (
            <div className="flex flex-col items-center justify-center py-24">
              <TableProperties size={48} style={{ color: '#333' }} />
              <p className="mt-4 text-sm" style={{ color: '#666' }}>No ad data found. Select an account and date range.</p>
            </div>
          )}

          {!loading && sortedAds.length > 0 && (
            <>
              {/* ─── Row 1: Insights + Rank Table + Cost til Winner ─── */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Insights + Settings */}
                <div className="lg:col-span-3 space-y-4">
                  {/* Insights */}
                  <div className="rounded-xl p-5" style={{ backgroundColor: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <h3 className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color: '#C8B89A' }}>
                      <Zap size={14} /> Insights
                    </h3>
                    <div className="space-y-2.5">
                      {insights.map((insight, i) => (
                        <p key={i} className="text-[13px] leading-relaxed" style={{ color: '#BBB' }}>
                          {insight}
                        </p>
                      ))}
                    </div>
                  </div>

                  {/* Settings */}
                  <div className="rounded-xl p-5" style={{ backgroundColor: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <h3 className="text-sm font-semibold mb-4 flex items-center gap-2" style={{ color: '#C8B89A' }}>
                      Settings
                    </h3>
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <label className="text-xs" style={{ color: '#888' }}>Percentile Interval</label>
                        <select
                          value={percentileInterval}
                          onChange={(e) => setPercentileInterval(Number(e.target.value))}
                          className="text-xs rounded-md px-2 py-1"
                          style={{ backgroundColor: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#F5F5F8' }}
                        >
                          <option value={1}>1%</option>
                          <option value={5}>5%</option>
                          <option value={10}>10%</option>
                        </select>
                      </div>
                      <div className="flex items-center justify-between">
                        <label className="text-xs" style={{ color: '#888' }}>ROAS Floor (Winner)</label>
                        <input
                          type="number"
                          step="0.1"
                          value={roasFloor}
                          onChange={(e) => setRoasFloor(Number(e.target.value) || 0)}
                          className="text-xs rounded-md px-2 py-1 w-20 text-right"
                          style={{ backgroundColor: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#F5F5F8', outline: 'none' }}
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <label className="text-xs" style={{ color: '#888' }}>Static Cost</label>
                        <div className="flex items-center gap-1">
                          <span className="text-xs" style={{ color: '#666' }}>$</span>
                          <input
                            type="number"
                            value={staticCost}
                            onChange={(e) => setStaticCost(Number(e.target.value) || 0)}
                            className="text-xs rounded-md px-2 py-1 w-16 text-right"
                            style={{ backgroundColor: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#F5F5F8', outline: 'none' }}
                          />
                        </div>
                      </div>
                      <div className="flex items-center justify-between">
                        <label className="text-xs" style={{ color: '#888' }}>Video Cost</label>
                        <div className="flex items-center gap-1">
                          <span className="text-xs" style={{ color: '#666' }}>$</span>
                          <input
                            type="number"
                            value={videoCost}
                            onChange={(e) => setVideoCost(Number(e.target.value) || 0)}
                            className="text-xs rounded-md px-2 py-1 w-16 text-right"
                            style={{ backgroundColor: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#F5F5F8', outline: 'none' }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Advertising Rank Table */}
                <div className="lg:col-span-6">
                  <div className="rounded-xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
                    <div className="px-5 py-3" style={{ backgroundColor: 'rgba(200,184,154,0.06)', borderBottom: '1px solid rgba(200,184,154,0.1)' }}>
                      <h3 className="text-sm font-semibold flex items-center gap-2" style={{ color: '#C8B89A' }}>
                        <Award size={14} /> Advertising Rank Table
                      </h3>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}>
                            {['Rank', 'Spend', 'Revenue', 'Purchases', 'CPA', 'ROAS', 'Count', 'Avg. %ile', 'Hit Rate'].map(h => (
                              <th key={h} className="px-3 py-2.5 text-left font-semibold uppercase tracking-wider" style={{ color: '#888', fontSize: '10px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {rankTable.map((row) => (
                            <tr key={row.label} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                              <td className="px-3 py-3 font-bold" style={{ color: row.label === 'Winner' ? '#C8B89A' : '#AAA' }}>{row.label}</td>
                              <td className="px-3 py-3 tabular-nums" style={{ color: '#CCC' }}>{fmt.currencyShort(row.spend)}</td>
                              <td className="px-3 py-3 tabular-nums" style={{ color: '#CCC' }}>{fmt.currencyShort(row.revenue)}</td>
                              <td className="px-3 py-3 tabular-nums" style={{ color: '#CCC' }}>{fmt.num(row.purchases)}</td>
                              <td className="px-3 py-3 tabular-nums" style={{ color: '#CCC' }}>{fmt.currencyShort(row.cpa)}</td>
                              <td className="px-3 py-3 tabular-nums font-medium" style={{ color: row.roas >= roasFloor ? '#4ade80' : row.roas >= 1 ? '#fbbf24' : '#f87171' }}>{fmt.x(row.roas)}</td>
                              <td className="px-3 py-3 tabular-nums" style={{ color: '#CCC' }}>{row.count}</td>
                              <td className="px-3 py-3 tabular-nums" style={{ color: '#CCC' }}>{fmt.pctDetail(row.avgPercentile)}</td>
                              <td className="px-3 py-3 tabular-nums" style={{ color: '#CCC' }}>{fmt.pct(row.hitRate)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>

                {/* Cost 'til Next Winner */}
                <div className="lg:col-span-3">
                  <div
                    className="rounded-xl p-6 text-center h-full flex flex-col justify-center"
                    style={{
                      background: 'linear-gradient(135deg, rgba(200,184,154,0.12), rgba(200,184,154,0.04))',
                      border: '1px solid rgba(200,184,154,0.2)',
                    }}
                  >
                    <p className="text-sm font-medium italic mb-1" style={{ color: '#C8B89A', fontFamily: 'Georgia, serif' }}>
                      Cost &apos;til Next Winner
                    </p>
                    <p className="text-3xl font-bold mb-4" style={{ color: '#F5F5F8' }}>
                      {fmt.currencyShort(costTilWinner)}
                    </p>
                    <label className="flex items-center justify-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={includeProductionCost}
                        onChange={(e) => setIncludeProductionCost(e.target.checked)}
                        className="rounded"
                        style={{ accentColor: '#C8B89A' }}
                      />
                      <span className="text-xs" style={{ color: '#888' }}>Include Production Cost?</span>
                    </label>
                    <div className="mt-4 pt-4" style={{ borderTop: '1px solid rgba(200,184,154,0.15)' }}>
                      <div className="grid grid-cols-2 gap-3 text-center">
                        <div>
                          <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: '#888' }}>Total Ads</p>
                          <p className="text-sm font-bold" style={{ color: '#F5F5F8' }}>{sortedAds.length}</p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: '#888' }}>Winners</p>
                          <p className="text-sm font-bold" style={{ color: '#4ade80' }}>{winners.length}</p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: '#888' }}>Hit Rate</p>
                          <p className="text-sm font-bold" style={{ color: '#C8B89A' }}>
                            {sortedAds.length > 0 ? fmt.pct(winners.length / sortedAds.length) : '0%'}
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: '#888' }}>Ads to Test</p>
                          <p className="text-sm font-bold" style={{ color: '#F5F5F8' }}>
                            {winners.length > 0 ? `~${Math.ceil(sortedAds.length / winners.length)}` : '—'}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* ─── Row 2: Percentile Table + Distribution Chart ─── */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Percentile Distribution Table */}
                <div className="lg:col-span-8">
                  <div className="rounded-xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
                    <div className="px-5 py-3 flex items-center justify-between" style={{ backgroundColor: 'rgba(200,184,154,0.06)', borderBottom: '1px solid rgba(200,184,154,0.1)' }}>
                      <h3 className="text-sm font-semibold flex items-center gap-2" style={{ color: '#C8B89A' }}>
                        <BarChart3 size={14} /> Percentile Distribution
                      </h3>
                      <div className="flex items-center gap-2 text-[10px]" style={{ color: '#666' }}>
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: 'rgba(200,184,154,0.3)' }}></span> Top 1% of Ads</span>
                        <span>→</span>
                        <span>Bottom 1% of Ads</span>
                      </div>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-[11px]">
                        <thead>
                          <tr style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}>
                            {['%ile', 'Spend', 'Count', 'SOS', 'Revenue', 'Count', 'SOR', 'Purchases', 'Count', 'SOP', 'CPA', 'Count', 'ROAS', 'Count'].map((h, i) => (
                              <th key={`${h}-${i}`} className="px-2 py-2.5 text-right font-semibold uppercase tracking-wider whitespace-nowrap" style={{ color: '#888', fontSize: '9px', borderBottom: '1px solid rgba(255,255,255,0.06)', textAlign: i === 0 ? 'center' : 'right' }}>
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {percentileRows.map((row, idx) => {
                            const isTop = row.percentile >= 90;
                            const isMid = row.percentile >= 40 && row.percentile <= 60;
                            return (
                              <tr
                                key={row.percentile}
                                style={{
                                  borderBottom: '1px solid rgba(255,255,255,0.03)',
                                  backgroundColor: isTop ? 'rgba(200,184,154,0.04)' : idx % 2 === 0 ? 'rgba(255,255,255,0.01)' : 'transparent',
                                }}
                              >
                                <td className="px-2 py-2 text-center font-bold" style={{ color: isTop ? '#C8B89A' : '#AAA' }}>{row.percentile}%</td>
                                <td className="px-2 py-2 text-right tabular-nums" style={{ color: '#CCC' }}>{fmt.currencyShort(row.spend)}</td>
                                <td className="px-2 py-2 text-right tabular-nums" style={{ color: '#777' }}>{row.spendCount}</td>
                                <td className="px-2 py-2 text-right tabular-nums font-medium" style={{ color: row.sos >= 0.5 ? '#C8B89A' : '#999' }}>{fmt.pct(row.sos)}</td>
                                <td className="px-2 py-2 text-right tabular-nums" style={{ color: '#CCC' }}>{fmt.currencyShort(row.revenue)}</td>
                                <td className="px-2 py-2 text-right tabular-nums" style={{ color: '#777' }}>{row.revenueCount}</td>
                                <td className="px-2 py-2 text-right tabular-nums font-medium" style={{ color: row.sor >= 0.5 ? '#C8B89A' : '#999' }}>{fmt.pct(row.sor)}</td>
                                <td className="px-2 py-2 text-right tabular-nums" style={{ color: '#CCC' }}>{fmt.num(row.purchases)}</td>
                                <td className="px-2 py-2 text-right tabular-nums" style={{ color: '#777' }}>{row.purchasesCount}</td>
                                <td className="px-2 py-2 text-right tabular-nums font-medium" style={{ color: row.sop >= 0.5 ? '#C8B89A' : '#999' }}>{fmt.pct(row.sop)}</td>
                                <td className="px-2 py-2 text-right tabular-nums" style={{ color: '#CCC' }}>{fmt.currencyShort(row.cpa)}</td>
                                <td className="px-2 py-2 text-right tabular-nums" style={{ color: '#777' }}>{row.cpaCount}</td>
                                <td className="px-2 py-2 text-right tabular-nums font-medium" style={{ color: row.roas >= roasFloor ? '#4ade80' : row.roas >= 1 ? '#fbbf24' : '#f87171' }}>{fmt.x(row.roas)}</td>
                                <td className="px-2 py-2 text-right tabular-nums" style={{ color: '#777' }}>{row.roasCount}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>

                {/* Ad Distribution Chart */}
                <div className="lg:col-span-4">
                  <div className="rounded-xl overflow-hidden h-full" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
                    <div className="px-5 py-3 flex items-center justify-between" style={{ backgroundColor: 'rgba(200,184,154,0.06)', borderBottom: '1px solid rgba(200,184,154,0.1)' }}>
                      <h3 className="text-sm font-semibold" style={{ color: '#C8B89A' }}>
                        Ad Distribution
                      </h3>
                      <select
                        value={chartMetric}
                        onChange={(e) => setChartMetric(e.target.value as any)}
                        className="text-[11px] rounded-md px-2 py-1"
                        style={{ backgroundColor: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#F5F5F8' }}
                      >
                        <option value="spend">Spend</option>
                        <option value="revenue">Revenue</option>
                        <option value="purchases">Purchases</option>
                        <option value="roas">ROAS</option>
                        <option value="cpa">CPA</option>
                      </select>
                    </div>
                    <div className="p-4" style={{ backgroundColor: 'rgba(0,0,0,0.2)' }}>
                      {/* Simple SVG chart */}
                      <svg viewBox="0 0 400 280" className="w-full" style={{ overflow: 'visible' }}>
                        {/* Y axis labels */}
                        {[0, 0.25, 0.5, 0.75, 1].map((pct) => {
                          const y = 260 - pct * 240;
                          const val = chartMax * pct;
                          return (
                            <g key={pct}>
                              <line x1="45" y1={y} x2="390" y2={y} stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />
                              <text x="40" y={y + 3} textAnchor="end" fill="#666" fontSize="8" fontFamily="monospace">
                                {chartMetric === 'roas' ? val.toFixed(1) : chartMetric === 'purchases' ? Math.round(val).toString() : `$${val >= 1000 ? `${(val/1000).toFixed(0)}k` : val.toFixed(0)}`}
                              </text>
                            </g>
                          );
                        })}
                        {/* Data points */}
                        {chartData.map((d, i) => {
                          const x = 50 + (i / Math.max(chartData.length - 1, 1)) * 335;
                          const y = chartMax > 0 ? 260 - (d.value / chartMax) * 240 : 260;
                          return (
                            <circle
                              key={i}
                              cx={x}
                              cy={y}
                              r={d.isWinner ? 3 : 2}
                              fill={d.isWinner ? '#C8B89A' : '#4a9ead'}
                              opacity={0.8}
                            >
                              <title>{d.name}: {chartMetric === 'roas' ? d.value.toFixed(2) : chartMetric === 'purchases' ? Math.round(d.value) : `$${d.value.toFixed(2)}`}</title>
                            </circle>
                          );
                        })}
                        {/* Connecting line */}
                        {chartData.length > 1 && (
                          <polyline
                            fill="none"
                            stroke="#4a9ead"
                            strokeWidth="1"
                            opacity="0.4"
                            points={chartData.map((d, i) => {
                              const x = 50 + (i / Math.max(chartData.length - 1, 1)) * 335;
                              const y = chartMax > 0 ? 260 - (d.value / chartMax) * 240 : 260;
                              return `${x},${y}`;
                            }).join(' ')}
                          />
                        )}
                        {/* X axis */}
                        <line x1="50" y1="260" x2="390" y2="260" stroke="rgba(255,255,255,0.1)" strokeWidth="0.5" />
                      </svg>
                      <div className="flex items-center justify-between mt-2 text-[9px]" style={{ color: '#666' }}>
                        <span>Top performers →</span>
                        <div className="flex items-center gap-3">
                          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: '#C8B89A' }}></span> Winner</span>
                          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: '#4a9ead' }}></span> Non-winner</span>
                        </div>
                        <span>← Bottom performers</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* ─── Row 3: The Outlier Table ─────────────────────── */}
              <div className="rounded-xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
                <div className="px-5 py-3 flex items-center justify-between" style={{ backgroundColor: 'rgba(200,184,154,0.06)', borderBottom: '1px solid rgba(200,184,154,0.1)' }}>
                  <h3 className="text-sm font-semibold flex items-center gap-2" style={{ color: '#C8B89A', fontFamily: 'Georgia, serif', fontStyle: 'italic' }}>
                    <Eye size={14} /> The Outlier Table
                  </h3>
                  <span className="text-[10px]" style={{ color: '#666' }}>Top 20 ads by selected metric</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}>
                        {[
                          { key: 'ad_name', label: 'Ad Name', align: 'left' },
                          { key: 'spend', label: 'Spend' },
                          { key: 'purchase_value', label: 'Revenue' },
                          { key: 'purchases', label: 'Purchases' },
                          { key: 'cpa', label: 'CPA' },
                          { key: 'roas', label: 'ROAS' },
                          { key: 'cpm', label: 'CPM' },
                          { key: 'link_ctr', label: 'Link CTR' },
                          { key: 'thumbstop_rate', label: 'Hookrate' },
                          { key: 'impressions', label: 'Impressions' },
                        ].map((col) => (
                          <th
                            key={col.key}
                            className="px-3 py-2.5 font-semibold uppercase tracking-wider cursor-pointer hover:opacity-80 whitespace-nowrap"
                            style={{ color: '#888', fontSize: '9px', borderBottom: '1px solid rgba(255,255,255,0.06)', textAlign: col.align === 'left' ? 'left' : 'right' }}
                            onClick={() => handleOutlierSort(col.key)}
                          >
                            <span className="flex items-center gap-1" style={{ justifyContent: col.align === 'left' ? 'flex-start' : 'flex-end' }}>
                              {col.label} <OutlierSortIcon field={col.key} />
                            </span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {outlierAds.map((ad, idx) => {
                        const isWinner = ad.roas >= roasFloor;
                        return (
                          <tr
                            key={ad.ad_id}
                            className="cursor-pointer transition-colors"
                            style={{
                              borderBottom: '1px solid rgba(255,255,255,0.03)',
                              backgroundColor: idx % 2 === 0 ? 'rgba(255,255,255,0.01)' : 'transparent',
                              borderLeft: isWinner ? '2px solid rgba(200,184,154,0.4)' : '2px solid transparent',
                            }}
                            onClick={() => setSelectedAd(ad)}
                            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(200,184,154,0.04)'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = idx % 2 === 0 ? 'rgba(255,255,255,0.01)' : 'transparent'; }}
                          >
                            <td className="px-3 py-2.5 text-left max-w-[200px] truncate" style={{ color: '#DDD' }} title={ad.ad_name}>{ad.ad_name}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: '#C8B89A' }}>{fmt.currencyShort(ad.spend)}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: '#C8B89A' }}>{fmt.currencyShort(ad.purchase_value)}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: '#CCC' }}>{fmt.num(ad.purchases)}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: '#CCC' }}>{fmt.currencyShort(ad.cpa)}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums font-medium" style={{ color: ad.roas >= roasFloor ? '#4ade80' : ad.roas >= 1 ? '#fbbf24' : '#f87171' }}>{fmt.x(ad.roas)}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: '#CCC' }}>{fmt.currencyShort(ad.cpm)}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: '#CCC' }}>{ad.link_ctr.toFixed(2)}%</td>
                            <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: '#CCC' }}>{ad.thumbstop_rate.toFixed(2)}%</td>
                            <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: '#CCC' }}>{fmt.num(ad.impressions)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Ad Detail Sidecar */}
      {selectedAd && (
        <AdDetailPanel ad={selectedAd} onClose={() => setSelectedAd(null)} roasFloor={roasFloor} />
      )}
    </Navbar>
  );
}
