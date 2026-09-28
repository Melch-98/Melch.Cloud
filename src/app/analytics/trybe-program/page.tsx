'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Loader,
  ChevronDown,
  Check,
  AlertTriangle,
  Users,
  Film,
  BarChart3,
  Trophy,
  Image as ImageIcon,
  RefreshCw,
  Link2,
  ExternalLink,
} from 'lucide-react';
import Navbar from '@/components/Navbar';
import { createClient } from '@/lib/supabase';

// ─── Palette ────────────────────────────────────────────────────
const G = '#C8B89A';
const Gn = '#22C55E';
const Rd = '#EF4444';
const Bl = '#60A5FA';
const Am = '#F59E0B';
const Pr = '#A78BFA';
const Gy = '#666';
const W = '#F5F5F8';

interface Brand {
  id: string;
  name: string;
  slug: string;
}

type Tab = 'overview' | 'leaderboard' | 'top-ads';
type StackBy = 'status' | 'format';
type TopAdsFilter = 'all' | 'live' | 'images' | 'creator_videos' | 'other_videos';

interface OverviewData {
  total: number;
  by_status: Record<string, number>;
  by_media: Record<string, number>;
  submissions_with_ads: number;
  total_ad_placements: number;
  timeline: {
    date: string;
    total: number;
    by_status: Record<string, number>;
    by_media?: Record<string, number>;
  }[];
}

interface LeaderboardRow {
  creator_id: string;
  creator_name: string;
  avatar_url: string | null;
  spend: number;
  earnings: number;
  trybe_gmv: number;
  trybe_conversions: number;
  new_submissions: number;
  active_submissions: number;
  ads: number;
  purchases: number;
  purchase_value: number;
  roas: number | null;
  currency: string;
  last_submission_at: string | null;
  last_ad_day: string | null;
  programs: { id: string; name: string }[];
}

interface TopAdRow {
  id: string;
  trybe_id: string | null;
  creator_name: string;
  status: string;
  media_type: string;
  format: 'images' | 'creator_videos' | 'other_videos';
  placements: number;
  ads_first_day: string | null;
  ads_last_day: string | null;
  launched_at: string | null;
  live: boolean;
  thumbnail_url: string | null;
  created_at: string;
  program: { id: string; name: string } | null;
  meta_joined: boolean;
  spend: number | null;
  purchases: number | null;
  cost_per_purchase: number | null;
  impressions: number | null;
  cpm: number | null;
  first_frame_retention: number | null;
  thumbstop_rate: number | null;
  hold_rate: number | null;
  landing_page_views: number | null;
  ad_name: string | null;
  meta_ad_id: string | null;
  meta_ad_ids?: string[];
  facebook_ad_url: string | null;
  meta_campaign_count: number;
  spend_note: string | null;
}

const FOND_SLUGS = new Set(['fond', 'fond-regenerative', 'fond-bone-broth']);
const isFond = (b: Brand) =>
  FOND_SLUGS.has((b.slug || '').toLowerCase()) ||
  (b.name || '').toLowerCase() === 'fond' ||
  (b.name || '').toLowerCase().startsWith('fond ');

const $ = (n: number) =>
  Math.abs(n) >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n.toFixed(2)}`;
const N = (n: number) => n.toLocaleString();
const pct = (n: number | null | undefined) =>
  n == null || Number.isNaN(n) ? 'n/a' : `${n.toFixed(1)}%`;
const metricOrNa = (n: number | null | undefined, fmt: (v: number) => string = N) =>
  n == null || Number.isNaN(n) ? 'n/a' : fmt(n);

const STATUS_COLORS: Record<string, string> = {
  pending: Am,
  approved: '#7C6AF0',
  rejected: '#8B9BB4',
  revision_requested: '#E8A0B0',
};

const FORMAT_COLORS: Record<string, string> = {
  video: '#7C6AF0',
  image: Am,
  unknown: Gy,
};

function StatusPill({ status }: { status: string }) {
  const c = STATUS_COLORS[status] || Gy;
  return (
    <span
      className="inline-flex px-1.5 py-px rounded text-[10px] font-semibold uppercase"
      style={{ background: `${c}18`, color: c }}
    >
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();
}

function formatAxisDate(iso: string): string {
  const [, m, d] = iso.split('-');
  if (!m || !d) return iso;
  return `${Number(m)}/${Number(d)}`;
}

function MetricCell({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[9px] uppercase tracking-wider font-bold truncate" style={{ color: Gy }}>
        {label}
      </p>
      <p className="text-xs font-semibold mt-0.5 truncate" style={{ color: W }}>
        {value}
      </p>
    </div>
  );
}

export default function TrybeProgramPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<string | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [selectedBrandId, setSelectedBrandId] = useState('');
  const [brandOpen, setBrandOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('overview');
  const [days, setDays] = useState(30);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
  const [topAds, setTopAds] = useState<TopAdRow[]>([]);
  const [windowInfo, setWindowInfo] = useState<{ start_date: string; end_date: string; days: number } | null>(null);
  const [trybeMeta, setTrybeMeta] = useState<{
    trybe_program_id: string | null;
    trybe_program_name: string | null;
  } | null>(null);
  const [metaJoin, setMetaJoin] = useState<{ insights_fetched: number; trybe_ids_matched: number } | null>(null);
  const [stackBy, setStackBy] = useState<StackBy>('status');
  const [topAdsFilter, setTopAdsFilter] = useState<TopAdsFilter>('all');
  const [hoverDay, setHoverDay] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
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
        router.push('/dashboard');
        return;
      }
      setRole(profile.role);

      let query = supabase
        .from('brands')
        .select('id, name, slug')
        .is('archived_at', null)
        .order('name');

      if (profile.role !== 'admin' && profile.brand_id) {
        query = query.eq('id', profile.brand_id);
      }

      const { data: allBrands } = await query;
      const filtered = ((allBrands || []) as Brand[]).filter((b: Brand) => !isFond(b));
      setBrands(filtered);

      if (filtered.length > 0) {
        const saved = localStorage.getItem('melch_selected_brand');
        const pick =
          filtered.find((b: Brand) => b.id === saved) ||
          filtered.find((b: Brand) => b.slug === 'mintier') ||
          filtered[0];
        setSelectedBrandId(pick.id);
      }
      setLoading(false);
    })();
  }, [router]);

  const selectedBrand = useMemo(
    () => brands.find((b) => b.id === selectedBrandId),
    [brands, selectedBrandId],
  );

  const loadData = useCallback(async () => {
    if (!authToken || !selectedBrandId) return;
    setFetching(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/trybe?brand_id=${selectedBrandId}&tab=all&days=${days}`,
        { headers: { Authorization: `Bearer ${authToken}` } },
      );
      const data = await res.json();

      if (res.status === 404 && data.configured === false) {
        setConfigured(false);
        setOverview(null);
        setLeaderboard([]);
        setTopAds([]);
        setTrybeMeta(null);
        setWindowInfo(null);
        setMetaJoin(null);
        setError(data.error || 'Trybe not configured for this brand');
        return;
      }

      if (!res.ok) {
        setConfigured(data.configured ?? null);
        setError(data.error || `Request failed (${res.status})`);
        return;
      }

      setConfigured(true);
      setOverview(data.overview || null);
      setLeaderboard(data.leaderboard || []);
      setTopAds(data.top_ads || []);
      setWindowInfo(data.window || null);
      setTrybeMeta(data.trybe || null);
      setMetaJoin(data.meta_join || null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load Trybe data');
    } finally {
      setFetching(false);
    }
  }, [authToken, selectedBrandId, days]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filteredTopAds = useMemo(() => {
    return topAds.filter((ad) => {
      if (topAdsFilter === 'all') return true;
      if (topAdsFilter === 'live') return ad.live;
      return ad.format === topAdsFilter;
    });
  }, [topAds, topAdsFilter]);

  if (loading) {
    return (
      <Navbar>
        <div className="min-h-screen flex items-center justify-center" style={{ background: '#0A0A0A' }}>
          <Loader className="animate-spin" style={{ color: G }} />
        </div>
      </Navbar>
    );
  }

  const tabs: { key: Tab; label: string; icon: typeof BarChart3 }[] = [
    { key: 'overview', label: 'Program Overview', icon: BarChart3 },
    { key: 'leaderboard', label: 'Creator Leaderboard', icon: Trophy },
    { key: 'top-ads', label: 'Top Ads', icon: Film },
  ];

  const topFilters: { key: TopAdsFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'live', label: 'Live now' },
    { key: 'images', label: 'Images' },
    { key: 'creator_videos', label: 'Creator videos' },
    { key: 'other_videos', label: 'Other videos' },
  ];

  return (
    <Navbar>
      <div className="min-h-screen px-4 md:px-8 py-6 max-w-[1400px]" style={{ background: '#0A0A0A', color: W }}>
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 mb-6">
          <div>
            <p className="text-[10px] uppercase tracking-wider font-bold mb-1" style={{ color: G }}>
              Creative Analytics
            </p>
            <h1 className="text-2xl font-bold tracking-tight">Trybe Program</h1>
            <p className="text-sm mt-1" style={{ color: Gy }}>
              Submissions pipeline, creator performance &amp; live ads — read only
              {trybeMeta?.trybe_program_name ? ` · ${trybeMeta.trybe_program_name}` : ''}
              {windowInfo ? ` · ${windowInfo.start_date} → ${windowInfo.end_date}` : ''}
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="px-3 py-2 rounded-lg text-xs outline-none"
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                color: W,
              }}
            >
              {[7, 14, 30, 60, 90].map((d) => (
                <option key={d} value={d}>
                  Last {d} days
                </option>
              ))}
            </select>

            <div className="relative">
              <button
                onClick={() => setBrandOpen(!brandOpen)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium"
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  color: selectedBrand ? G : '#999',
                }}
              >
                {selectedBrand?.name || 'Select Brand'}
                <ChevronDown size={14} />
              </button>
              {brandOpen && (
                <div
                  className="absolute right-0 mt-1 z-30 min-w-[200px] rounded-lg overflow-hidden max-h-72 overflow-y-auto"
                  style={{
                    background: '#141414',
                    border: '1px solid rgba(255,255,255,0.1)',
                  }}
                >
                  {brands.map((brand) => (
                    <button
                      key={brand.id}
                      onClick={() => {
                        setSelectedBrandId(brand.id);
                        localStorage.setItem('melch_selected_brand', brand.id);
                        setBrandOpen(false);
                      }}
                      className="w-full flex items-center justify-between px-3 py-2 text-left text-xs"
                      style={{
                        color: brand.id === selectedBrandId ? G : '#CCC',
                        background:
                          brand.id === selectedBrandId
                            ? 'rgba(200,184,154,0.08)'
                            : 'transparent',
                      }}
                    >
                      {brand.name}
                      {brand.id === selectedBrandId && <Check size={14} style={{ color: G }} />}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              onClick={loadData}
              disabled={fetching}
              className="p-2 rounded-lg"
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                color: Gy,
              }}
              title="Refresh"
            >
              <RefreshCw size={14} className={fetching ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div
          className="flex gap-1 mb-6 p-1 rounded-xl w-fit flex-wrap"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
        >
          {tabs.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all"
              style={{
                background: tab === key ? 'rgba(200,184,154,0.12)' : 'transparent',
                color: tab === key ? G : Gy,
              }}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>

        {fetching && !overview && leaderboard.length === 0 && (
          <div className="flex items-center justify-center py-24">
            <Loader className="animate-spin" style={{ color: G }} />
          </div>
        )}

        {configured === false && (
          <div
            className="rounded-xl p-6 flex items-start gap-3"
            style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)' }}
          >
            <AlertTriangle size={18} style={{ color: Am, flexShrink: 0, marginTop: 2 }} />
            <div>
              <p className="text-sm font-medium" style={{ color: Am }}>
                Trybe not connected for {selectedBrand?.name || 'this brand'}
              </p>
              <p className="text-xs mt-1" style={{ color: Gy }}>
                An admin can paste the Trybe Brand API key under Team → brand settings → Trybe.
                Optional: set Trybe Brand ID / Program ID for filtering.
              </p>
              {role === 'admin' && (
                <a
                  href="/team"
                  className="inline-flex items-center gap-1.5 mt-3 text-xs font-medium"
                  style={{ color: G }}
                >
                  <Link2 size={12} /> Open Team settings
                </a>
              )}
            </div>
          </div>
        )}

        {error && configured !== false && (
          <div
            className="rounded-xl p-4 mb-4 flex items-center gap-3"
            style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}
          >
            <AlertTriangle size={16} style={{ color: Rd }} />
            <p className="text-sm" style={{ color: Rd }}>
              {error}
            </p>
          </div>
        )}

        {/* Overview tab */}
        {configured && tab === 'overview' && overview && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: 'Total submissions', value: N(overview.total), icon: Film, color: G },
                {
                  label: 'Approved',
                  value: N(overview.by_status.approved || 0),
                  icon: Check,
                  color: Gn,
                },
                {
                  label: 'Pending review',
                  value: N(overview.by_status.pending || 0),
                  icon: Users,
                  color: Am,
                },
                {
                  label: 'Live as ads',
                  value: `${N(overview.submissions_with_ads)} · ${N(overview.total_ad_placements)} placements`,
                  icon: ImageIcon,
                  color: Bl,
                },
              ].map((c) => (
                <div
                  key={c.label}
                  className="rounded-xl p-4"
                  style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <c.icon size={14} style={{ color: c.color }} />
                    <span className="text-[10px] uppercase tracking-wider font-bold" style={{ color: Gy }}>
                      {c.label}
                    </span>
                  </div>
                  <p className="text-lg font-bold" style={{ color: W }}>
                    {c.value}
                  </p>
                </div>
              ))}
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div
                className="rounded-xl p-4"
                style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}
              >
                <p className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: G }}>
                  By status
                </p>
                <div className="space-y-2">
                  {Object.entries(overview.by_status)
                    .sort((a, b) => b[1] - a[1])
                    .map(([status, count]) => {
                      const p = overview.total ? (count / overview.total) * 100 : 0;
                      const c = STATUS_COLORS[status] || Gy;
                      return (
                        <div key={status}>
                          <div className="flex justify-between text-xs mb-1">
                            <StatusPill status={status} />
                            <span style={{ color: Gy }}>
                              {count} · {p.toFixed(0)}%
                            </span>
                          </div>
                          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                            <div className="h-full rounded-full" style={{ width: `${p}%`, background: c }} />
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>

              <div
                className="rounded-xl p-4"
                style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}
              >
                <p className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: G }}>
                  Format mix
                </p>
                <div className="space-y-2">
                  {Object.entries(overview.by_media)
                    .sort((a, b) => b[1] - a[1])
                    .map(([media, count]) => {
                      const p = overview.total ? (count / overview.total) * 100 : 0;
                      return (
                        <div key={media} className="flex items-center justify-between text-sm">
                          <span className="capitalize" style={{ color: W }}>
                            {media}
                          </span>
                          <span style={{ color: Gy }}>
                            {count} · {p.toFixed(0)}%
                          </span>
                        </div>
                      );
                    })}
                  {Object.keys(overview.by_media).length === 0 && (
                    <p className="text-xs" style={{ color: Gy }}>
                      No submissions yet
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Volume by day — labeled + stacked */}
            <div
              className="rounded-xl p-4 overflow-x-auto"
              style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}
            >
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                <p className="text-xs font-bold uppercase tracking-wider" style={{ color: G }}>
                  Submissions per day
                </p>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-wider font-bold" style={{ color: Gy }}>
                    Stack by
                  </span>
                  <div
                    className="flex gap-1 p-0.5 rounded-lg"
                    style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
                  >
                    {([
                      { key: 'status' as StackBy, label: 'Status' },
                      { key: 'format' as StackBy, label: 'Format' },
                    ]).map((opt) => (
                      <button
                        key={opt.key}
                        onClick={() => setStackBy(opt.key)}
                        className="px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider"
                        style={{
                          background: stackBy === opt.key ? 'rgba(200,184,154,0.15)' : 'transparent',
                          color: stackBy === opt.key ? G : Gy,
                        }}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {overview.timeline.length === 0 ? (
                <p className="text-xs" style={{ color: Gy }}>
                  No dated submissions in this pull
                </p>
              ) : (
                (() => {
                  const slice = overview.timeline;
                  const max = Math.max(...slice.map((t) => t.total), 1);
                  const n = slice.length;
                  // Label every day when ≤31; otherwise every ~N days so labels stay readable
                  const labelEvery = n <= 31 ? 1 : Math.ceil(n / 16);
                  const stackKeys =
                    stackBy === 'status'
                      ? ['approved', 'pending', 'revision_requested', 'rejected']
                      : ['video', 'image'];
                  const colorMap = stackBy === 'status' ? STATUS_COLORS : FORMAT_COLORS;
                  const legend =
                    stackBy === 'status'
                      ? [
                          { key: 'approved', label: 'Approved' },
                          { key: 'pending', label: 'Pending' },
                          { key: 'revision_requested', label: 'Feedback' },
                          { key: 'rejected', label: 'Rejected' },
                        ]
                      : [
                          { key: 'video', label: 'Video' },
                          { key: 'image', label: 'Image' },
                        ];

                  return (
                    <>
                      <div className="flex flex-wrap gap-3 mb-3">
                        {legend.map((l) => (
                          <div key={l.key} className="flex items-center gap-1.5 text-[10px]" style={{ color: Gy }}>
                            <span
                              className="w-2.5 h-2.5 rounded-sm"
                              style={{ background: colorMap[l.key] || Gy }}
                            />
                            {l.label}
                          </div>
                        ))}
                      </div>
                      <div className="relative" style={{ minWidth: Math.max(n * 18, 280) }}>
                        <div className="flex items-end gap-px h-[140px]">
                          {slice.map((t) => {
                            const parts =
                              stackBy === 'status' ? t.by_status || {} : t.by_media || {};
                            const known = stackKeys.reduce((sum, k) => sum + (parts[k] || 0), 0);
                            const other = Math.max(t.total - known, 0);
                            const tipParts = [
                              ...stackKeys
                                .filter((k) => (parts[k] || 0) > 0)
                                .map((k) => `${k.replace(/_/g, ' ')}: ${parts[k]}`),
                              ...(other > 0 ? [`other: ${other}`] : []),
                            ].join(' · ');
                            return (
                              <div
                                key={t.date}
                                className="flex-1 min-w-[10px] h-full flex flex-col justify-end relative"
                                onMouseEnter={() => setHoverDay(t.date)}
                                onMouseLeave={() => setHoverDay(null)}
                              >
                                <div
                                  className="w-full flex flex-col justify-end rounded-t overflow-hidden"
                                  style={{ height: `${Math.max((t.total / max) * 100, t.total > 0 ? 4 : 0)}%` }}
                                >
                                  {stackKeys.map((k) => {
                                    const c = parts[k] || 0;
                                    if (!c) return null;
                                    return (
                                      <div
                                        key={k}
                                        style={{
                                          height: `${(c / Math.max(t.total, 1)) * 100}%`,
                                          background: colorMap[k] || Gy,
                                          minHeight: c > 0 ? 2 : 0,
                                        }}
                                      />
                                    );
                                  })}
                                  {other > 0 && (
                                    <div
                                      style={{
                                        height: `${(other / Math.max(t.total, 1)) * 100}%`,
                                        background: Gy,
                                        minHeight: 2,
                                      }}
                                    />
                                  )}
                                </div>
                                {hoverDay === t.date && (
                                  <div
                                    className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-10 px-2 py-1.5 rounded-md text-[10px] whitespace-nowrap pointer-events-none"
                                    style={{
                                      background: '#1A1A1A',
                                      border: '1px solid rgba(255,255,255,0.12)',
                                      color: W,
                                    }}
                                  >
                                    <div className="font-semibold mb-0.5">{t.date}</div>
                                    <div style={{ color: Gy }}>
                                      {t.total} submission{t.total === 1 ? '' : 's'}
                                      {tipParts ? ` · ${tipParts}` : ''}
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                        {/* X-axis date labels */}
                        <div className="flex gap-px mt-2 border-t pt-1" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
                          {slice.map((t, i) => {
                            const show = i % labelEvery === 0 || i === n - 1;
                            return (
                              <div
                                key={`lbl-${t.date}`}
                                className="flex-1 min-w-[10px] text-center overflow-hidden"
                              >
                                {show ? (
                                  <span
                                    className="text-[9px] font-medium block truncate"
                                    style={{ color: Gy }}
                                  >
                                    {formatAxisDate(t.date)}
                                  </span>
                                ) : (
                                  <span className="block h-3" />
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </>
                  );
                })()
              )}
            </div>
          </div>
        )}

        {/* Leaderboard */}
        {configured && tab === 'leaderboard' && (
          <div
            className="rounded-xl overflow-hidden"
            style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}
          >
            <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <p className="text-xs font-bold uppercase tracking-wider" style={{ color: G }}>
                Creators by ad spend
              </p>
              <p className="text-[10px]" style={{ color: Gy }}>
                From Trybe creator-performance · money in dollars (API cents ÷ 100)
              </p>
            </div>
            {leaderboard.length === 0 ? (
              <p className="text-sm p-6" style={{ color: Gy }}>
                No creator performance rows for this window
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr style={{ color: Gy, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                      {['#', 'Creator', 'Spend', 'Earnings', 'GMV', 'Conv.', 'Ads', 'Subs', 'ROAS', 'Last ad'].map(
                        (h) => (
                          <th key={h} className="px-3 py-2 font-medium whitespace-nowrap">
                            {h}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {leaderboard.map((r, i) => (
                      <tr
                        key={r.creator_id || i}
                        style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}
                      >
                        <td className="px-3 py-2.5" style={{ color: Gy }}>
                          {i + 1}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            {r.avatar_url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={r.avatar_url}
                                alt=""
                                className="w-6 h-6 rounded-full object-cover"
                              />
                            ) : (
                              <div
                                className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold"
                                style={{ background: 'rgba(200,184,154,0.2)', color: G }}
                              >
                                {(r.creator_name || '?').charAt(0)}
                              </div>
                            )}
                            <span className="font-medium" style={{ color: W }}>
                              {r.creator_name}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 font-medium" style={{ color: G }}>
                          {$(r.spend)}
                        </td>
                        <td className="px-3 py-2.5">{$(r.earnings)}</td>
                        <td className="px-3 py-2.5">{$(r.trybe_gmv)}</td>
                        <td className="px-3 py-2.5">{N(r.trybe_conversions)}</td>
                        <td className="px-3 py-2.5">{N(r.ads)}</td>
                        <td className="px-3 py-2.5">
                          {N(r.new_submissions)}
                          <span style={{ color: Gy }}> / {N(r.active_submissions)}</span>
                        </td>
                        <td className="px-3 py-2.5">
                          {r.roas == null ? '—' : `${r.roas.toFixed(2)}×`}
                        </td>
                        <td className="px-3 py-2.5" style={{ color: Gy }}>
                          {r.last_ad_day || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Top ads — Alysha-style creative cards */}
        {configured && tab === 'top-ads' && (
          <div>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
              <div>
                <p className="text-sm font-semibold" style={{ color: W }}>
                  Top ads by spend
                </p>
                <p className="text-[11px] mt-0.5" style={{ color: Gy }}>
                  One card per creative (deduped by Trybe id). Meta metrics joined when ad name
                  contains trybe=&lt;id&gt;
                  {metaJoin
                    ? ` · ${metaJoin.trybe_ids_matched} creatives matched / ${metaJoin.insights_fetched} Meta ads fetched`
                    : ''}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap mb-4">
              <span className="text-[10px] uppercase tracking-wider font-bold" style={{ color: Gy }}>
                Show
              </span>
              {topFilters.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setTopAdsFilter(f.key)}
                  className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider"
                  style={{
                    background:
                      topAdsFilter === f.key ? 'rgba(200,184,154,0.18)' : 'rgba(255,255,255,0.03)',
                    color: topAdsFilter === f.key ? G : Gy,
                    border: `1px solid ${
                      topAdsFilter === f.key ? 'rgba(200,184,154,0.35)' : 'rgba(255,255,255,0.08)'
                    }`,
                  }}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {filteredTopAds.length === 0 ? (
              <p className="text-sm" style={{ color: Gy }}>
                No creatives match this filter
              </p>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                {filteredTopAds.map((ad) => (
                  <div
                    key={ad.id}
                    className="rounded-xl overflow-hidden flex flex-col"
                    style={{
                      background: 'rgba(255,255,255,0.02)',
                      border: '1px solid rgba(255,255,255,0.08)',
                    }}
                  >
                    <div
                      className="aspect-[4/5] relative flex items-center justify-center"
                      style={{ background: 'rgba(255,255,255,0.03)' }}
                    >
                      {ad.thumbnail_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={ad.thumbnail_url}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <Film size={28} style={{ color: Gy }} />
                      )}
                    </div>

                    <div className="p-3 flex flex-col gap-2 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {ad.live && (
                          <span
                            className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider"
                            style={{ background: Am, color: '#111' }}
                          >
                            Live
                          </span>
                        )}
                        <span
                          className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider"
                          style={{
                            background: 'rgba(255,255,255,0.06)',
                            color: Gy,
                          }}
                        >
                          Launched {formatShortDate(ad.launched_at || ad.ads_first_day)}
                        </span>
                      </div>

                      {ad.facebook_ad_url && ad.ad_name ? (
                        <a
                          href={ad.facebook_ad_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-semibold leading-snug hover:underline"
                          style={{ color: W }}
                          title={ad.ad_name}
                        >
                          <span className="line-clamp-2">{ad.ad_name}</span>
                          <span className="inline-flex items-center gap-1 mt-0.5 text-[10px] font-medium" style={{ color: Pr }}>
                            <ExternalLink size={10} /> Open in Ads Manager
                          </span>
                        </a>
                      ) : ad.ad_name ? (
                        <p className="text-xs font-semibold leading-snug line-clamp-2" style={{ color: W }} title={ad.ad_name}>
                          {ad.ad_name}
                        </p>
                      ) : (
                        <p className="text-xs font-semibold truncate" style={{ color: Gy }} title="Meta ad name unavailable until join">
                          Ad name pending Meta join
                        </p>
                      )}
                      <p className="text-[10px] truncate" style={{ color: Gy }}>
                        {ad.creator_name}
                      </p>

                      <div>
                        <p className="text-[9px] uppercase tracking-wider font-bold" style={{ color: Gy }}>
                          Spend
                        </p>
                        <p className="text-sm font-bold" style={{ color: ad.spend != null ? G : Gy }}>
                          {ad.spend != null ? $(ad.spend) : 'n/a'}
                        </p>
                      </div>

                      <div className="grid grid-cols-2 gap-x-2 gap-y-2">
                        <MetricCell label="Purchases" value={metricOrNa(ad.purchases)} />
                        <MetricCell
                          label="Cost per purchase"
                          value={metricOrNa(ad.cost_per_purchase, $)}
                        />
                        <MetricCell label="Impressions" value={metricOrNa(ad.impressions)} />
                        <MetricCell label="CPM" value={metricOrNa(ad.cpm, $)} />
                        <MetricCell
                          label="1st frame retention"
                          value={
                            ad.format === 'images' || ad.media_type === 'image'
                              ? 'n/a'
                              : pct(ad.first_frame_retention)
                          }
                        />
                        <MetricCell
                          label="Thumbstop rate"
                          value={
                            ad.format === 'images' || ad.media_type === 'image'
                              ? 'n/a'
                              : pct(ad.thumbstop_rate)
                          }
                        />
                        <MetricCell
                          label="Hold rate"
                          value={
                            ad.format === 'images' || ad.media_type === 'image'
                              ? 'n/a'
                              : pct(ad.hold_rate)
                          }
                        />
                        <MetricCell
                          label="Landing page views"
                          value={metricOrNa(ad.landing_page_views)}
                        />
                      </div>

                      <div className="mt-auto pt-2 space-y-1" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                        <p className="text-[10px] truncate" style={{ color: Gy }}>
                          Trybe {ad.trybe_id || '—'}
                          {ad.meta_campaign_count > 1
                            ? ` · ${ad.meta_campaign_count} campaigns`
                            : ad.placements > 1
                              ? ` · ${ad.placements} placements`
                              : ''}
                        </p>
                        {!ad.facebook_ad_url && ad.meta_ad_id && (
                          <p className="text-[9px] truncate" style={{ color: Gy }}>
                            Meta ad {ad.meta_ad_id}
                          </p>
                        )}
                        {!ad.meta_joined && ad.spend_note && (
                          <p className="text-[9px]" style={{ color: Gy }}>
                            {ad.spend_note}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Navbar>
  );
}
