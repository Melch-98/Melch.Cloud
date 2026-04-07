'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Loader,
  TrendingUp,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ChevronDown,
  Settings,
  RefreshCw,
  X,
  Check,
  Search,
  LayoutGrid,
  List,
  AlertCircle,
  DollarSign,
  BarChart3,
  Video,
  Image as ImageIcon,
  Layers,
  Volume2,
  VolumeX,
  Play,
  Pause,
  Maximize2,
} from 'lucide-react';
import { useRef } from 'react';
import Navbar from '@/components/Navbar';
import { createClient } from '@/lib/supabase';
import type { MetaAdInsight, MetaAdAccount } from '@/lib/meta-api';
import DataFreshness, { friendlyError } from '@/components/DataFreshness';

// ─── Types ──────────────────────────────────────────────────────

type SortField = keyof MetaAdInsight;
type SortDir = 'asc' | 'desc';

interface MetricPill {
  key: keyof MetaAdInsight;
  label: string;
  format: (v: number) => string;
  category: 'financial' | 'engagement' | 'conversion' | 'delivery';
}

// ─── Metric Definitions ────────────────────────────────────────

const fmt = {
  currency: (v: number) =>
    v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v.toFixed(2)}`,
  currencyFull: (v: number) => `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
  pct: (v: number) => `${v.toFixed(2)}%`,
  x: (v: number) => v.toFixed(2),
  num: (v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v)),
  numFull: (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 0 }),
};

const ALL_METRICS: MetricPill[] = [
  { key: 'spend', label: 'Spend', format: fmt.currencyFull, category: 'financial' },
  { key: 'purchase_value', label: 'Purchase Value', format: fmt.currencyFull, category: 'financial' },
  { key: 'roas', label: 'ROAS', format: fmt.x, category: 'financial' },
  { key: 'cpa', label: 'CPA', format: fmt.currencyFull, category: 'financial' },
  { key: 'aov', label: 'AOV', format: fmt.currencyFull, category: 'financial' },
  { key: 'link_ctr', label: 'Link CTR', format: fmt.pct, category: 'engagement' },
  { key: 'ctr', label: 'CTR (all)', format: fmt.pct, category: 'engagement' },
  { key: 'cpm', label: 'CPM', format: fmt.currencyFull, category: 'engagement' },
  { key: 'cpc', label: 'CPC', format: fmt.currencyFull, category: 'engagement' },
  { key: 'thumbstop_rate', label: 'Thumbstop', format: fmt.pct, category: 'engagement' },
  { key: 'purchases', label: 'Purchases', format: fmt.numFull, category: 'conversion' },
  { key: 'add_to_cart', label: 'ATC', format: fmt.numFull, category: 'conversion' },
  { key: 'initiate_checkout', label: 'IC', format: fmt.numFull, category: 'conversion' },
  { key: 'cost_per_purchase', label: 'Cost/Purchase', format: fmt.currencyFull, category: 'conversion' },
  { key: 'cost_per_atc', label: 'Cost/ATC', format: fmt.currencyFull, category: 'conversion' },
  { key: 'impressions', label: 'Impressions', format: fmt.numFull, category: 'delivery' },
  { key: 'reach', label: 'Reach', format: fmt.numFull, category: 'delivery' },
  { key: 'frequency', label: 'Frequency', format: fmt.x, category: 'delivery' },
  { key: 'clicks', label: 'Clicks', format: fmt.numFull, category: 'delivery' },
];

// Default visible metrics on cards
const DEFAULT_CARD_METRICS: (keyof MetaAdInsight)[] = ['spend', 'purchase_value', 'roas', 'link_ctr'];

// ─── Date Presets ──────────────────────────────────────────────

function dateStr(d: Date): string {
  return d.toISOString().split('T')[0];
}

function getDatePreset(preset: string): { from: string; to: string; label: string } {
  const now = new Date();
  const to = dateStr(now);
  switch (preset) {
    case '7d': {
      const d = new Date(now);
      d.setDate(d.getDate() - 7);
      return { from: dateStr(d), to, label: 'Last 7 days' };
    }
    case '14d': {
      const d = new Date(now);
      d.setDate(d.getDate() - 14);
      return { from: dateStr(d), to, label: 'Last 14 days' };
    }
    case '30d': {
      const d = new Date(now);
      d.setDate(d.getDate() - 30);
      return { from: dateStr(d), to, label: 'Last 30 days' };
    }
    case '90d': {
      const d = new Date(now);
      d.setDate(d.getDate() - 90);
      return { from: dateStr(d), to, label: 'Last 90 days' };
    }
    default: {
      const d = new Date(now);
      d.setDate(d.getDate() - 14);
      return { from: dateStr(d), to, label: 'Last 14 days' };
    }
  }
}

// ─── Creative Type Badge ───────────────────────────────────────

function TypeBadge({ type, size = 'sm' }: { type: string; size?: 'sm' | 'lg' }) {
  const config: Record<string, { bg: string; border: string; text: string; icon: React.ElementType }> = {
    VIDEO: { bg: 'rgba(200,184,154,0.08)', border: 'rgba(200,184,154,0.2)', text: '#C8B89A', icon: Video },
    IMAGE: { bg: 'rgba(200,184,154,0.06)', border: 'rgba(200,184,154,0.15)', text: '#a89878', icon: ImageIcon },
    CAROUSEL: { bg: 'rgba(200,184,154,0.06)', border: 'rgba(200,184,154,0.15)', text: '#a89878', icon: Layers },
    UNKNOWN: { bg: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.08)', text: '#666', icon: BarChart3 },
  };
  const c = config[type] || config.UNKNOWN;
  const Icon = c.icon;
  const isLg = size === 'lg';
  return (
    <span
      className={`inline-flex items-center gap-1.5 ${isLg ? 'px-3 py-1 text-[11px]' : 'px-2 py-0.5 text-[9px]'} rounded-md font-semibold uppercase tracking-widest`}
      style={{ backgroundColor: c.bg, color: c.text, border: `1px solid ${c.border}`, backdropFilter: 'blur(8px)' }}
    >
      <Icon size={isLg ? 12 : 9} />
      {type === 'UNKNOWN' ? 'Other' : type}
    </span>
  );
}

// ─── Creative Detail Panel ─────────────────────────────────────

function CreativeDetailPanel({
  ad,
  onClose,
}: {
  ad: MetaAdInsight;
  onClose: () => void;
}) {
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
    if (v.paused) {
      v.play();
      setIsPlaying(true);
    } else {
      v.pause();
      setIsPlaying(false);
    }
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

  // Metric groups for the panel
  const metricGroups = [
    {
      title: 'Financial',
      metrics: [
        { label: 'Spend', value: fmt.currencyFull(ad.spend) },
        { label: 'Revenue', value: fmt.currencyFull(ad.purchase_value) },
        { label: 'ROAS', value: fmt.x(ad.roas), highlight: ad.roas >= 3 },
        { label: 'CPA', value: fmt.currencyFull(ad.cpa) },
        { label: 'AOV', value: fmt.currencyFull(ad.aov) },
      ],
    },
    {
      title: 'Engagement',
      metrics: [
        { label: 'Link CTR', value: fmt.pct(ad.link_ctr) },
        { label: 'CTR (all)', value: fmt.pct(ad.ctr) },
        { label: 'CPM', value: fmt.currencyFull(ad.cpm) },
        { label: 'CPC', value: fmt.currencyFull(ad.cpc) },
        { label: 'Thumbstop', value: fmt.pct(ad.thumbstop_rate) },
      ],
    },
    {
      title: 'Conversions',
      metrics: [
        { label: 'Purchases', value: fmt.numFull(ad.purchases) },
        { label: 'Add to Cart', value: fmt.numFull(ad.add_to_cart) },
        { label: 'Checkout', value: fmt.numFull(ad.initiate_checkout) },
        { label: 'Cost/Purchase', value: fmt.currencyFull(ad.cost_per_purchase) },
        { label: 'Cost/ATC', value: fmt.currencyFull(ad.cost_per_atc) },
      ],
    },
    {
      title: 'Delivery',
      metrics: [
        { label: 'Impressions', value: fmt.numFull(ad.impressions) },
        { label: 'Reach', value: fmt.numFull(ad.reach) },
        { label: 'Frequency', value: fmt.x(ad.frequency) },
        { label: 'Clicks', value: fmt.numFull(ad.clicks) },
      ],
    },
  ];

  // Add video retention group for video ads
  if (ad.creative_type === 'VIDEO') {
    const total = ad.impressions || 1;
    metricGroups.push({
      title: 'Video Retention',
      metrics: [
        { label: '25% watched', value: fmt.numFull(ad.video_play_25) },
        { label: '50% watched', value: fmt.numFull(ad.video_play_50) },
        { label: '75% watched', value: fmt.numFull(ad.video_play_75) },
        { label: '100% watched', value: fmt.numFull(ad.video_play_100) },
      ],
    });
  }

  // Hero metrics for the top cards
  const heroMetrics = [
    { label: 'Spend', value: fmt.currencyFull(ad.spend), color: '#C8B89A' },
    { label: 'Revenue', value: fmt.currencyFull(ad.purchase_value), color: '#e8dcc8' },
    { label: 'ROAS', value: `${fmt.x(ad.roas)}x`, color: ad.roas >= 3 ? '#10B981' : ad.roas >= 1.5 ? '#C8B89A' : '#ef4444' },
  ];

  return (
    <div className="fixed inset-0 z-[100] flex">
      {/* Backdrop */}
      <div
        className="absolute inset-0 backdrop-blur-md"
        style={{ backgroundColor: 'rgba(0,0,0,0.75)' }}
        onClick={onClose}
      />

      {/* Panel */}
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

              {/* Play overlay (only when paused) */}
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
                style={{
                  background: 'linear-gradient(transparent, rgba(0,0,0,0.9))',
                }}
              >
                {/* Progress bar */}
                <div
                  className="w-full h-1 rounded-full cursor-pointer mb-3 group"
                  style={{ backgroundColor: 'rgba(255,255,255,0.1)' }}
                  onClick={handleSeek}
                >
                  <div
                    className="h-full rounded-full transition-all relative"
                    style={{
                      width: `${progress}%`,
                      backgroundColor: '#C8B89A',
                    }}
                  >
                    <div
                      className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                      style={{ transform: 'translate(50%, -50%)', backgroundColor: '#C8B89A' }}
                    />
                  </div>
                </div>

                {/* Controls row */}
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

        {/* Ad info header */}
        <div className="px-6 pt-6 pb-4">
          <div className="flex items-center gap-2.5 mb-3">
            <TypeBadge type={ad.creative_type} size="lg" />
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
        <div className="px-6 pb-4">
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
              <h4
                className="text-[10px] font-bold uppercase tracking-[0.15em] mb-3"
                style={{ color: '#C8B89A' }}
              >
                {group.title}
              </h4>
              <div
                className="rounded-xl overflow-hidden"
                style={{
                  backgroundColor: 'rgba(255,255,255,0.02)',
                  border: '1px solid rgba(255,255,255,0.04)',
                }}
              >
                {group.metrics.map((m, idx) => (
                  <div
                    key={m.label}
                    className="flex items-center justify-between px-4 py-2.5"
                    style={{
                      borderBottom: idx < group.metrics.length - 1 ? '1px solid rgba(255,255,255,0.03)' : 'none',
                    }}
                  >
                    <span className="text-[11px] font-medium" style={{ color: '#666' }}>
                      {m.label}
                    </span>
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

      {/* Slide-in animation */}
      <style jsx>{`
        @keyframes slideInRight {
          from {
            transform: translateX(100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
}

// ─── Token Setup Modal ─────────────────────────────────────────

function TokenModal({
  open,
  onClose,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (token: string) => void;
}) {
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div
        className="absolute inset-0"
        style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}
        onClick={onClose}
      />
      <div
        className="relative z-10 w-full max-w-lg mx-4 rounded-xl p-6"
        style={{ backgroundColor: '#1A1A1A', border: '1px solid rgba(255,255,255,0.08)' }}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-[#F5F5F8]">Meta API Setup</h3>
          <button onClick={onClose} className="p-1 rounded-lg" style={{ color: '#666' }}>
            <X size={18} />
          </button>
        </div>
        <p className="text-sm mb-4" style={{ color: '#888' }}>
          Paste your Meta Marketing API access token below. This is stored securely and used
          to pull ad performance data. You can generate a long-lived token from the Meta
          Business Suite &gt; System Users.
        </p>
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="EAAxxxxxxx..."
          className="w-full px-4 py-3 rounded-lg text-sm mb-4 outline-none"
          style={{
            backgroundColor: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.1)',
            color: '#F5F5F8',
          }}
        />
        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium"
            style={{ color: '#888' }}
          >
            Cancel
          </button>
          <button
            onClick={async () => {
              setSaving(true);
              await onSave(value);
              setSaving(false);
              onClose();
            }}
            disabled={!value.trim() || saving}
            className="px-5 py-2 rounded-lg text-sm font-bold transition-opacity"
            style={{
              backgroundColor: '#C8B89A',
              color: '#0A0A0A',
              opacity: !value.trim() || saving ? 0.5 : 1,
            }}
          >
            {saving ? 'Saving...' : 'Save Token'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// ─── Main Analytics Page ──────────────────────────────────────
// ═══════════════════════════════════════════════════════════════

export default function AnalyticsPage() {
  const router = useRouter();
  const supabase = createClient();

  // Auth state
  const [userRole, setUserRole] = useState<string | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [scopedAccountId, setScopedAccountId] = useState<string | null>(null); // strategist's brand ad account
  const [brandName, setBrandName] = useState<string | null>(null);

  // Data state
  const [accounts, setAccounts] = useState<MetaAdAccount[]>([]);
  const [insights, setInsights] = useState<MetaAdInsight[]>([]);
  const [fetchingAccounts, setFetchingAccounts] = useState(false);
  const [fetchingInsights, setFetchingInsights] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filter state
  const [selectedAccount, setSelectedAccount] = useState<string>('');
  const [datePreset, setDatePreset] = useState('14d');
  const [searchQuery, setSearchQuery] = useState('');

  // View state
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');
  const [cardMetrics, setCardMetrics] = useState<(keyof MetaAdInsight)[]>(DEFAULT_CARD_METRICS);
  const [sortField, setSortField] = useState<SortField>('spend');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [showTokenModal, setShowTokenModal] = useState(false);
  const [showAccountDropdown, setShowAccountDropdown] = useState(false);
  const [showDateDropdown, setShowDateDropdown] = useState(false);
  const [showMetricPicker, setShowMetricPicker] = useState(false);
  const [selectedAd, setSelectedAd] = useState<MetaAdInsight | null>(null);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [isCached, setIsCached] = useState(false);

  // ─── Auth & Setup ──────────────────────────────────────────

  useEffect(() => {
    const init = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        router.push('/');
        return;
      }

      setAuthToken(session.access_token);

      const { data: profile } = await supabase
        .from('users_profile')
        .select('role, brand_id')
        .eq('id', session.user.id)
        .single();

      if (!profile || !['admin', 'strategist', 'founder'].includes(profile.role)) {
        router.push('/');
        return;
      }

      setUserRole(profile.role);

      // If strategist, fetch their brand's ad account to auto-scope
      if (profile.role === 'strategist' && profile.brand_id) {
        const { data: brand } = await supabase
          .from('brands')
          .select('name, meta_ad_account_id')
          .eq('id', profile.brand_id)
          .single();

        if (brand) {
          setBrandName(brand.name);
          if (brand.meta_ad_account_id) {
            setScopedAccountId(brand.meta_ad_account_id);
            setSelectedAccount(brand.meta_ad_account_id);
          }
        }
      }

      setLoading(false);
    };

    init();
  }, [supabase, router]);

  // ─── Fetch Ad Accounts ─────────────────────────────────────

  const loadAccounts = useCallback(async () => {
    if (!authToken) return;

    // Strategists with a scoped account skip the account list — go straight to insights
    if (scopedAccountId) {
      setSelectedAccount(scopedAccountId);
      return;
    }

    setFetchingAccounts(true);
    setError(null);

    try {
      const res = await fetch('/api/meta-insights?action=accounts', {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const data = await res.json();

      if (!res.ok) {
        if (data.error?.includes('not configured')) {
          setShowTokenModal(true);
        }
        setError(data.error);
        return;
      }

      setAccounts(data.accounts || []);
      if (data.accounts?.length > 0 && !selectedAccount) {
        const savedBrand = localStorage.getItem('melch_selected_brand');
        const match = savedBrand && data.accounts.find((a: any) => a.brand_id === savedBrand);
        setSelectedAccount(match ? match.id : data.accounts[0].id);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setFetchingAccounts(false);
    }
  }, [authToken, selectedAccount, scopedAccountId]);

  useEffect(() => {
    if (!loading && authToken) {
      loadAccounts();
    }
  }, [loading, authToken, loadAccounts]);

  // ─── Fetch Insights ────────────────────────────────────────

  const loadInsights = useCallback(async () => {
    if (!authToken || !selectedAccount) return;
    setFetchingInsights(true);
    setError(null);

    const dates = getDatePreset(datePreset);

    try {
      const res = await fetch(
        `/api/meta-insights?account_id=${encodeURIComponent(selectedAccount)}&date_from=${dates.from}&date_to=${dates.to}&limit=50`,
        { headers: { Authorization: `Bearer ${authToken}` } }
      );
      const data = await res.json();

      if (!res.ok) {
        setError(data.error);
        return;
      }

      setInsights(data.insights || []);
      setCachedAt(data.cached_at || null);
      setIsCached(!!data.cached);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setFetchingInsights(false);
    }
  }, [authToken, selectedAccount, datePreset]);

  useEffect(() => {
    if (selectedAccount) {
      loadInsights();
    }
  }, [selectedAccount, datePreset, loadInsights]);

  // ─── Save Token ────────────────────────────────────────────

  const handleSaveToken = async (token: string) => {
    if (!authToken) return;
    try {
      await fetch('/api/meta-insights', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ meta_access_token: token }),
      });
      // Reload accounts after saving
      setTimeout(() => loadAccounts(), 500);
    } catch {
      // handled by modal
    }
  };

  // ─── Sort & Filter ─────────────────────────────────────────

  const filteredInsights = useMemo(() => {
    let list = [...insights];

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (i) =>
          i.ad_name.toLowerCase().includes(q) ||
          i.campaign_name.toLowerCase().includes(q) ||
          i.adset_name.toLowerCase().includes(q)
      );
    }

    list.sort((a, b) => {
      const av = a[sortField];
      const bv = b[sortField];
      const aNum = typeof av === 'number' ? av : 0;
      const bNum = typeof bv === 'number' ? bv : 0;
      return sortDir === 'desc' ? bNum - aNum : aNum - bNum;
    });

    return list;
  }, [insights, searchQuery, sortField, sortDir]);

  // ─── Toggle metric in card view ────────────────────────────

  const toggleCardMetric = (key: keyof MetaAdInsight) => {
    setCardMetrics((prev) => {
      if (prev.includes(key)) return prev.filter((k) => k !== key);
      if (prev.length >= 6) return prev; // Max 6 on cards
      return [...prev, key];
    });
  };

  // ─── Aggregates for summary bar ────────────────────────────

  const totals = useMemo(() => {
    const t = {
      spend: 0,
      purchase_value: 0,
      purchases: 0,
      impressions: 0,
      clicks: 0,
      link_ctr_weighted: 0,
    };
    filteredInsights.forEach((i) => {
      t.spend += i.spend;
      t.purchase_value += i.purchase_value;
      t.purchases += i.purchases;
      t.impressions += i.impressions;
      t.clicks += i.clicks;
      t.link_ctr_weighted += i.link_ctr * i.impressions;
    });
    return {
      ...t,
      roas: t.spend > 0 ? t.purchase_value / t.spend : 0,
      link_ctr: t.impressions > 0 ? t.link_ctr_weighted / t.impressions : 0,
    };
  }, [filteredInsights]);

  const dateRange = getDatePreset(datePreset);
  const selectedAccountObj = accounts.find((a) => a.id === selectedAccount);

  // ─── Handle Sort ───────────────────────────────────────────

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  // ─── Loading State ─────────────────────────────────────────

  if (loading) {
    return (
      <Navbar>
        <div className="flex items-center justify-center h-screen">
          <Loader className="animate-spin" style={{ color: '#C8B89A' }} size={32} />
        </div>
      </Navbar>
    );
  }

  // ═════════════════════════════════════════════════════════════
  // ─── Render ─────────────────────────────────────────────────
  // ═════════════════════════════════════════════════════════════

  return (
    <Navbar>
      <div className="p-6 md:p-8 max-w-[1600px] mx-auto">
        {/* ─── Header ──────────────────────────────────────── */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center gap-3">
              <TrendingUp size={24} style={{ color: '#C8B89A' }} />
              <h1 className="text-2xl font-bold text-[#F5F5F8]">Top Creatives</h1>
            </div>
            <p className="text-sm mt-1" style={{ color: '#666' }}>
              Performance analytics pulled directly from Meta Ads. Sorted by spend.
            </p>
          </div>

          <div className="flex items-center gap-2">
            {/* Settings button (admin only) */}
            {userRole === 'admin' && (
              <button
                onClick={() => setShowTokenModal(true)}
                className="p-2 rounded-lg transition-colors"
                style={{
                  backgroundColor: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.06)',
                  color: '#666',
                }}
                title="Meta API Settings"
              >
                <Settings size={16} />
              </button>
            )}

            {/* Refresh */}
            <button
              onClick={loadInsights}
              disabled={fetchingInsights}
              className="p-2 rounded-lg transition-colors"
              style={{
                backgroundColor: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.06)',
                color: '#888',
              }}
              title="Refresh data"
            >
              <RefreshCw size={16} className={fetchingInsights ? 'animate-spin' : ''} />
            </button>

            <DataFreshness cachedAt={cachedAt} isCached={isCached} />

            {/* View toggle */}
            <div
              className="flex rounded-lg overflow-hidden"
              style={{ border: '1px solid rgba(255,255,255,0.06)' }}
            >
              <button
                onClick={() => setViewMode('cards')}
                className="p-2 transition-colors"
                style={{
                  backgroundColor: viewMode === 'cards' ? 'rgba(200,184,154,0.15)' : 'rgba(255,255,255,0.04)',
                  color: viewMode === 'cards' ? '#C8B89A' : '#666',
                }}
              >
                <LayoutGrid size={16} />
              </button>
              <button
                onClick={() => setViewMode('table')}
                className="p-2 transition-colors"
                style={{
                  backgroundColor: viewMode === 'table' ? 'rgba(200,184,154,0.15)' : 'rgba(255,255,255,0.04)',
                  color: viewMode === 'table' ? '#C8B89A' : '#666',
                }}
              >
                <List size={16} />
              </button>
            </div>
          </div>
        </div>

        {/* ─── Filters Bar ─────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-3 mb-6">
          {/* Account picker — hidden for scoped strategists, shows brand name instead */}
          {scopedAccountId ? (
            <div
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium"
              style={{
                backgroundColor: 'rgba(200,184,154,0.08)',
                border: '1px solid rgba(200,184,154,0.15)',
                color: '#C8B89A',
              }}
            >
              <DollarSign size={14} />
              {brandName || 'Your Brand'}
            </div>
          ) : (
            <div className="relative">
              <button
                onClick={() => setShowAccountDropdown(!showAccountDropdown)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium"
                style={{
                  backgroundColor: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  color: '#F5F5F8',
                }}
              >
                <DollarSign size={14} style={{ color: '#C8B89A' }} />
                {selectedAccountObj?.name || (fetchingAccounts ? 'Loading...' : 'Select Account')}
                <ChevronDown size={14} style={{ color: '#666' }} />
              </button>
              {showAccountDropdown && (
                <div
                  className="absolute top-full left-0 mt-1 w-72 rounded-lg py-1 z-50 max-h-64 overflow-auto"
                  style={{
                    backgroundColor: '#1A1A1A',
                    border: '1px solid rgba(255,255,255,0.1)',
                    boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                  }}
                >
                  {accounts.map((acc) => (
                    <button
                      key={acc.id}
                      onClick={() => {
                        setSelectedAccount(acc.id);
                        if ((acc as any).brand_id) localStorage.setItem('melch_selected_brand', (acc as any).brand_id);
                        setShowAccountDropdown(false);
                      }}
                      className="w-full text-left px-4 py-2.5 text-sm transition-colors flex items-center justify-between"
                      style={{
                        color: acc.id === selectedAccount ? '#C8B89A' : '#CCC',
                        backgroundColor: acc.id === selectedAccount ? 'rgba(200,184,154,0.08)' : 'transparent',
                      }}
                    >
                      <span className="truncate">{acc.name}</span>
                      {acc.id === selectedAccount && <Check size={14} style={{ color: '#C8B89A' }} />}
                    </button>
                  ))}
                  {accounts.length === 0 && (
                    <p className="px-4 py-3 text-sm" style={{ color: '#666' }}>
                      No accounts found
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Date preset */}
          <div className="relative">
            <button
              onClick={() => setShowDateDropdown(!showDateDropdown)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium"
              style={{
                backgroundColor: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                color: '#F5F5F8',
              }}
            >
              {dateRange.label}
              <span className="text-xs" style={{ color: '#666' }}>
                {dateRange.from} – {dateRange.to}
              </span>
              <ChevronDown size={14} style={{ color: '#666' }} />
            </button>
            {showDateDropdown && (
              <div
                className="absolute top-full left-0 mt-1 w-48 rounded-lg py-1 z-50"
                style={{
                  backgroundColor: '#1A1A1A',
                  border: '1px solid rgba(255,255,255,0.1)',
                  boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                }}
              >
                {['7d', '14d', '30d', '90d'].map((p) => (
                  <button
                    key={p}
                    onClick={() => {
                      setDatePreset(p);
                      setShowDateDropdown(false);
                    }}
                    className="w-full text-left px-4 py-2.5 text-sm transition-colors flex items-center justify-between"
                    style={{
                      color: p === datePreset ? '#C8B89A' : '#CCC',
                      backgroundColor: p === datePreset ? 'rgba(200,184,154,0.08)' : 'transparent',
                    }}
                  >
                    {getDatePreset(p).label}
                    {p === datePreset && <Check size={14} style={{ color: '#C8B89A' }} />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Search */}
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-lg flex-1 min-w-[200px] max-w-sm"
            style={{
              backgroundColor: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
            }}
          >
            <Search size={14} style={{ color: '#666' }} />
            <input
              type="text"
              placeholder="Search ads..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-transparent outline-none text-sm flex-1"
              style={{ color: '#F5F5F8' }}
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')}>
                <X size={12} style={{ color: '#666' }} />
              </button>
            )}
          </div>
        </div>

        {/* ─── Metric Pills (visible on cards) ─────────────── */}
        <div className="flex flex-wrap items-center gap-2 mb-5">
          {cardMetrics.map((key) => {
            const m = ALL_METRICS.find((mm) => mm.key === key);
            if (!m) return null;
            return (
              <button
                key={key}
                onClick={() => toggleCardMetric(key)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold"
                style={{
                  backgroundColor: 'rgba(200,184,154,0.12)',
                  color: '#C8B89A',
                  border: '1px solid rgba(200,184,154,0.25)',
                }}
              >
                {m.label}
                <X size={10} />
              </button>
            );
          })}
          <div className="relative">
            <button
              onClick={() => setShowMetricPicker(!showMetricPicker)}
              className="flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium"
              style={{
                backgroundColor: 'rgba(255,255,255,0.04)',
                color: '#888',
                border: '1px solid rgba(255,255,255,0.08)',
              }}
            >
              + Add metrics
            </button>
            {showMetricPicker && (
              <div
                className="absolute top-full left-0 mt-1 w-56 rounded-lg py-2 z-50 max-h-72 overflow-auto"
                style={{
                  backgroundColor: '#1A1A1A',
                  border: '1px solid rgba(255,255,255,0.1)',
                  boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                }}
              >
                {['financial', 'engagement', 'conversion', 'delivery'].map((cat) => (
                  <div key={cat}>
                    <p className="px-4 py-1 text-[10px] font-bold uppercase tracking-widest" style={{ color: '#555' }}>
                      {cat}
                    </p>
                    {ALL_METRICS.filter((m) => m.category === cat).map((m) => {
                      const active = cardMetrics.includes(m.key);
                      return (
                        <button
                          key={m.key}
                          onClick={() => {
                            toggleCardMetric(m.key);
                          }}
                          className="w-full text-left px-4 py-2 text-sm flex items-center justify-between"
                          style={{
                            color: active ? '#C8B89A' : '#CCC',
                            backgroundColor: active ? 'rgba(200,184,154,0.06)' : 'transparent',
                          }}
                        >
                          {m.label}
                          {active && <Check size={12} style={{ color: '#C8B89A' }} />}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ─── Summary Row ─────────────────────────────────── */}
        {insights.length > 0 && (
          <div
            className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6 p-4 rounded-xl"
            style={{
              backgroundColor: 'rgba(200,184,154,0.04)',
              border: '1px solid rgba(200,184,154,0.1)',
            }}
          >
            {[
              { label: 'Total Spend', value: fmt.currencyFull(totals.spend) },
              { label: 'Revenue', value: fmt.currencyFull(totals.purchase_value) },
              { label: 'ROAS', value: fmt.x(totals.roas) },
              { label: 'Purchases', value: fmt.numFull(totals.purchases) },
              { label: 'Link CTR', value: fmt.pct(totals.link_ctr) },
            ].map((s) => (
              <div key={s.label} className="text-center">
                <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: '#666' }}>
                  {s.label}
                </p>
                <p className="text-lg font-bold" style={{ color: '#F5F5F8' }}>
                  {s.value}
                </p>
              </div>
            ))}
          </div>
        )}

        {/* ─── Error State ─────────────────────────────────── */}
        {error && (
          <div
            className="flex items-center gap-3 p-4 rounded-xl mb-6"
            style={{
              backgroundColor: 'rgba(239,68,68,0.08)',
              border: '1px solid rgba(239,68,68,0.2)',
            }}
          >
            <AlertCircle size={18} style={{ color: '#EF4444' }} />
            <p className="text-sm" style={{ color: '#FCA5A5' }}>
              {friendlyError(error)}
            </p>
            {error.includes('not configured') && userRole === 'admin' && (
              <button
                onClick={() => setShowTokenModal(true)}
                className="ml-auto px-3 py-1 rounded-lg text-xs font-bold"
                style={{ backgroundColor: '#C8B89A', color: '#0A0A0A' }}
              >
                Add Token
              </button>
            )}
          </div>
        )}

        {/* ─── Loading State ───────────────────────────────── */}
        {fetchingInsights && (
          <div className="flex items-center justify-center py-20">
            <div className="flex flex-col items-center gap-3">
              <Loader className="animate-spin" style={{ color: '#C8B89A' }} size={28} />
              <p className="text-sm" style={{ color: '#666' }}>
                Pulling creative data from Meta...
              </p>
            </div>
          </div>
        )}

        {/* ─── Empty State ─────────────────────────────────── */}
        {!fetchingInsights && insights.length === 0 && !error && selectedAccount && (
          <div className="flex flex-col items-center justify-center py-20">
            <BarChart3 size={48} style={{ color: '#333' }} />
            <p className="text-sm mt-3" style={{ color: '#666' }}>
              No ad data found for this account and time range.
            </p>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════ */}
        {/* ─── CARD VIEW ───────────────────────────────────── */}
        {/* ═══════════════════════════════════════════════════ */}
        {!fetchingInsights && filteredInsights.length > 0 && viewMode === 'cards' && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5 mb-8">
            {filteredInsights.map((ad) => {
              const roasVal = ad.roas;
              const isWinner = roasVal >= 3;
              return (
              <div
                key={ad.ad_id}
                className="group rounded-2xl overflow-hidden transition-all duration-300 cursor-pointer"
                style={{
                  backgroundColor: '#0d0d0d',
                  border: isWinner ? '1px solid rgba(200,184,154,0.25)' : '1px solid rgba(255,255,255,0.05)',
                  boxShadow: isWinner
                    ? '0 0 30px rgba(200,184,154,0.06), inset 0 1px 0 rgba(200,184,154,0.1)'
                    : '0 2px 16px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.03)',
                }}
                onClick={() => setSelectedAd(ad)}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-4px)';
                  e.currentTarget.style.boxShadow = isWinner
                    ? '0 8px 40px rgba(200,184,154,0.12), inset 0 1px 0 rgba(200,184,154,0.15)'
                    : '0 8px 40px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.05)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = isWinner
                    ? '0 0 30px rgba(200,184,154,0.06), inset 0 1px 0 rgba(200,184,154,0.1)'
                    : '0 2px 16px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.03)';
                }}
              >
                {/* Thumbnail / Video */}
                <div className="relative aspect-[4/5] bg-[#0a0a0a] overflow-hidden">
                  {ad.creative_type === 'VIDEO' && ad.video_url ? (
                    <div className="relative w-full h-full">
                      <video
                        src={`${ad.video_url}#t=0.5`}
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                        muted
                        playsInline
                        preload="auto"
                      />
                      {/* Gradient overlay at bottom */}
                      <div className="absolute inset-x-0 bottom-0 h-24" style={{ background: 'linear-gradient(transparent, rgba(0,0,0,0.7))' }} />
                      {/* Play button */}
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                        <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ backgroundColor: 'rgba(200,184,154,0.9)', backdropFilter: 'blur(12px)' }}>
                          <div className="w-0 h-0 ml-1 border-t-[8px] border-t-transparent border-l-[14px] border-l-[#0a0a0a] border-b-[8px] border-b-transparent" />
                        </div>
                      </div>
                    </div>
                  ) : ad.thumbnail_url ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={ad.thumbnail_url}
                        alt={ad.ad_name}
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                      />
                      <div className="absolute inset-x-0 bottom-0 h-24" style={{ background: 'linear-gradient(transparent, rgba(0,0,0,0.7))' }} />
                    </>
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <ImageIcon size={32} style={{ color: '#222' }} />
                    </div>
                  )}
                  {/* Type badge */}
                  <div className="absolute top-3 left-3">
                    <TypeBadge type={ad.creative_type} />
                  </div>
                  {/* ROAS pill overlay */}
                  {isWinner && (
                    <div className="absolute top-3 right-3">
                      <span
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wider"
                        style={{ backgroundColor: 'rgba(16,185,129,0.85)', color: '#fff', backdropFilter: 'blur(8px)' }}
                      >
                        <TrendingUp size={9} />
                        {roasVal.toFixed(1)}x
                      </span>
                    </div>
                  )}
                </div>

                {/* Info */}
                <div className="p-4">
                  <p
                    className="text-[11px] font-medium truncate mb-3"
                    style={{ color: '#999', letterSpacing: '0.02em' }}
                    title={ad.ad_name}
                  >
                    {ad.ad_name}
                  </p>

                  {/* Metric values */}
                  <div className="space-y-2">
                    {cardMetrics.map((key) => {
                      const m = ALL_METRICS.find((mm) => mm.key === key);
                      if (!m) return null;
                      const val = ad[key] as number;
                      const isHighRoas = key === 'roas' && val >= 3;
                      const isSpend = key === 'spend';
                      const isRevenue = key === 'purchase_value';
                      return (
                        <div key={key} className="flex items-center justify-between">
                          <span className="text-[10px] uppercase tracking-widest font-medium" style={{ color: '#4a4a4a' }}>
                            {m.label}
                          </span>
                          <span
                            className="text-[13px] font-semibold tabular-nums"
                            style={{
                              color: isHighRoas ? '#10B981' : isSpend ? '#C8B89A' : isRevenue ? '#e8dcc8' : '#e0e0e0',
                              letterSpacing: '-0.01em',
                            }}
                          >
                            {m.format(val)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
              );
            })}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════ */}
        {/* ─── TABLE VIEW ──────────────────────────────────── */}
        {/* ═══════════════════════════════════════════════════ */}
        {!fetchingInsights && filteredInsights.length > 0 && viewMode === 'table' && (
          <div
            className="rounded-xl overflow-hidden"
            style={{
              backgroundColor: 'rgba(13,13,13,0.6)',
              border: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    <th className="text-left px-4 py-3 text-[10px] font-bold uppercase tracking-widest sticky left-0 z-10"
                      style={{ color: '#666', backgroundColor: '#0D0D0D', minWidth: '280px' }}>
                      Creative
                    </th>
                    {ALL_METRICS.map((m) => (
                      <th
                        key={m.key}
                        onClick={() => handleSort(m.key)}
                        className="text-right px-3 py-3 text-[10px] font-bold uppercase tracking-widest cursor-pointer whitespace-nowrap select-none"
                        style={{ color: sortField === m.key ? '#C8B89A' : '#666', minWidth: '100px' }}
                      >
                        <div className="flex items-center justify-end gap-1">
                          {m.label}
                          {sortField === m.key ? (
                            sortDir === 'desc' ? <ArrowDown size={10} /> : <ArrowUp size={10} />
                          ) : (
                            <ArrowUpDown size={10} style={{ opacity: 0.3 }} />
                          )}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredInsights.map((ad, idx) => (
                    <tr
                      key={ad.ad_id}
                      className="transition-colors"
                      style={{
                        borderBottom: '1px solid rgba(255,255,255,0.04)',
                        backgroundColor: idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)',
                      }}
                    >
                      {/* Creative cell (sticky) */}
                      <td
                        className="px-4 py-3 sticky left-0 z-10"
                        style={{ backgroundColor: idx % 2 === 0 ? '#0D0D0D' : '#0F0F0F' }}
                      >
                        <div className="flex items-center gap-3">
                          {/* Thumbnail */}
                          <div className="w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 bg-[#111]">
                            {ad.creative_type === 'VIDEO' && ad.video_url ? (
                              <div
                                className="relative w-full h-full cursor-pointer"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const video = (e.currentTarget as HTMLElement).querySelector('video');
                                  if (!video) return;
                                  if (video.paused) {
                                    video.play();
                                    (e.currentTarget.querySelector('.play-overlay') as HTMLElement)?.classList.add('opacity-0');
                                  } else {
                                    video.pause();
                                    (e.currentTarget.querySelector('.play-overlay') as HTMLElement)?.classList.remove('opacity-0');
                                  }
                                }}
                              >
                                <video
                                  src={`${ad.video_url}#t=0.5`}
                                  className="w-full h-full object-cover"
                                  muted
                                  loop
                                  playsInline
                                  preload="auto"
                                />
                                <div className="play-overlay absolute inset-0 flex items-center justify-center bg-black/20 transition-opacity duration-200">
                                  <div className="w-0 h-0 ml-0.5 border-t-[4px] border-t-transparent border-l-[6px] border-l-white border-b-[4px] border-b-transparent" />
                                </div>
                              </div>
                            ) : ad.thumbnail_url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={ad.thumbnail_url}
                                alt=""
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <ImageIcon size={14} style={{ color: '#333' }} />
                              </div>
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-medium truncate" style={{ color: '#DDD', maxWidth: '200px' }}>
                              {ad.ad_name}
                            </p>
                            <p className="text-[10px] truncate" style={{ color: '#555', maxWidth: '200px' }}>
                              {ad.campaign_name}
                            </p>
                          </div>
                        </div>
                      </td>

                      {/* Metric cells */}
                      {ALL_METRICS.map((m) => {
                        const val = ad[m.key] as number;
                        const isHighRoas = m.key === 'roas' && val >= 3;
                        return (
                          <td key={m.key} className="px-3 py-3 text-right">
                            <span
                              className="text-xs font-medium"
                              style={{
                                color: isHighRoas ? '#10B981' : '#CCC',
                                backgroundColor: isHighRoas ? 'rgba(16,185,129,0.12)' : 'transparent',
                                padding: isHighRoas ? '2px 6px' : '0',
                                borderRadius: isHighRoas ? '4px' : '0',
                              }}
                            >
                              {m.format(val)}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ─── Count footer ────────────────────────────────── */}
        {!fetchingInsights && filteredInsights.length > 0 && (
          <p className="text-xs mt-4 text-center" style={{ color: '#555' }}>
            {filteredInsights.length} ad{filteredInsights.length !== 1 ? 's' : ''} shown
            {searchQuery && ` (filtered from ${insights.length})`}
          </p>
        )}
      </div>

      {/* ─── Creative Detail Panel ────────────────────────── */}
      {selectedAd && (
        <CreativeDetailPanel
          ad={selectedAd}
          onClose={() => setSelectedAd(null)}
        />
      )}

      {/* ─── Token Modal ──────────────────────────────────── */}
      <TokenModal
        open={showTokenModal}
        onClose={() => setShowTokenModal(false)}
        onSave={handleSaveToken}
      />

      {/* ─── Click-away for dropdowns ─────────────────────── */}
      {(showAccountDropdown || showDateDropdown || showMetricPicker) && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => {
            setShowAccountDropdown(false);
            setShowDateDropdown(false);
            setShowMetricPicker(false);
          }}
        />
      )}
    </Navbar>
  );
}
