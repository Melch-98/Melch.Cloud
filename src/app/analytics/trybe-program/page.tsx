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

interface OverviewData {
  total: number;
  by_status: Record<string, number>;
  by_media: Record<string, number>;
  submissions_with_ads: number;
  total_ad_placements: number;
  timeline: { date: string; total: number; by_status: Record<string, number> }[];
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
  creator_name: string;
  status: string;
  media_type: string;
  ads_count: number;
  ads_first_day: string | null;
  ads_last_day: string | null;
  thumbnail_url: string | null;
  created_at: string;
  program: { id: string; name: string } | null;
  spend: null;
  spend_note: string;
}

const FOND_SLUGS = new Set(['fond', 'fond-regenerative', 'fond-bone-broth']);
const isFond = (b: Brand) =>
  FOND_SLUGS.has((b.slug || '').toLowerCase()) ||
  (b.name || '').toLowerCase() === 'fond' ||
  (b.name || '').toLowerCase().startsWith('fond ');

const $ = (n: number) =>
  Math.abs(n) >= 1000
    ? `$${(n / 1000).toFixed(1)}k`
    : `$${n.toFixed(2)}`;
const N = (n: number) => n.toLocaleString();

const STATUS_COLORS: Record<string, string> = {
  pending: Am,
  approved: Gn,
  rejected: Rd,
  revision_requested: Bl,
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

  // Auth + brands
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
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load Trybe data');
    } finally {
      setFetching(false);
    }
  }, [authToken, selectedBrandId, days]);

  useEffect(() => {
    loadData();
  }, [loadData]);

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
            {/* Days */}
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

            {/* Brand selector */}
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

        {/* States */}
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
                      const pct = overview.total ? (count / overview.total) * 100 : 0;
                      const c = STATUS_COLORS[status] || Gy;
                      return (
                        <div key={status}>
                          <div className="flex justify-between text-xs mb-1">
                            <StatusPill status={status} />
                            <span style={{ color: Gy }}>
                              {count} · {pct.toFixed(0)}%
                            </span>
                          </div>
                          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: c }} />
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
                      const pct = overview.total ? (count / overview.total) * 100 : 0;
                      return (
                        <div key={media} className="flex items-center justify-between text-sm">
                          <span className="capitalize" style={{ color: W }}>
                            {media}
                          </span>
                          <span style={{ color: Gy }}>
                            {count} · {pct.toFixed(0)}%
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

            <div
              className="rounded-xl p-4 overflow-x-auto"
              style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}
            >
              <p className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: G }}>
                Volume by day
              </p>
              {overview.timeline.length === 0 ? (
                <p className="text-xs" style={{ color: Gy }}>
                  No dated submissions in this pull
                </p>
              ) : (
                <div className="flex items-end gap-1 min-h-[120px]">
                  {(() => {
                    const max = Math.max(...overview.timeline.map((t) => t.total), 1);
                    const slice = overview.timeline.slice(-60);
                    return slice.map((t) => (
                      <div key={t.date} className="flex-1 min-w-[6px] flex flex-col items-center gap-1 group relative">
                        <div
                          className="w-full rounded-t"
                          style={{
                            height: `${Math.max((t.total / max) * 100, 2)}px`,
                            background: G,
                            opacity: 0.7,
                          }}
                          title={`${t.date}: ${t.total}`}
                        />
                      </div>
                    ));
                  })()}
                </div>
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

        {/* Top ads */}
        {configured && tab === 'top-ads' && (
          <div>
            <p className="text-[11px] mb-3" style={{ color: Gy }}>
              Submissions with ads.count &gt; 0. Trybe does not expose per-ad spend on submissions —
              spend is shown on the Creator Leaderboard only.
            </p>
            {topAds.length === 0 ? (
              <p className="text-sm" style={{ color: Gy }}>
                No submissions currently running as ads
              </p>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {topAds.map((ad) => (
                  <div
                    key={ad.id}
                    className="rounded-xl overflow-hidden"
                    style={{
                      background: 'rgba(255,255,255,0.02)',
                      border: '1px solid rgba(255,255,255,0.06)',
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
                      <span
                        className="absolute top-2 left-2 px-1.5 py-0.5 rounded text-[10px] font-bold"
                        style={{ background: 'rgba(0,0,0,0.7)', color: G }}
                      >
                        {ad.ads_count} ad{ad.ads_count === 1 ? '' : 's'}
                      </span>
                    </div>
                    <div className="p-3 space-y-1.5">
                      <p className="text-xs font-medium truncate" style={{ color: W }}>
                        {ad.creator_name}
                      </p>
                      <div className="flex items-center gap-2 flex-wrap">
                        <StatusPill status={ad.status} />
                        <span className="text-[10px] uppercase" style={{ color: Gy }}>
                          {ad.media_type}
                        </span>
                      </div>
                      <p className="text-[10px]" style={{ color: Gy }}>
                        {ad.ads_first_day || '?'} → {ad.ads_last_day || '?'}
                      </p>
                      {ad.program?.name && (
                        <p className="text-[10px] truncate" style={{ color: Pr }}>
                          {ad.program.name}
                        </p>
                      )}
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
