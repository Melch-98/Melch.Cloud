'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Loader,
  RefreshCw,
  Activity,
  ChevronDown,
  ArrowRightLeft,
  DollarSign,
  PlusCircle,
  MinusCircle,
  Filter,
  AlertCircle,
} from 'lucide-react';
import Navbar from '@/components/Navbar';
import { createClient } from '@/lib/supabase';

// ─── Brand Palette ──────────────────────────────────────────────
const GOLD = '#C8B89A';
const GOLD_DIM = 'rgba(200,184,154,0.18)';
const BG_CARD = '#111111';
const BORDER = 'rgba(200,184,154,0.10)';
const TEXT_PRIMARY = '#F5F5F8';
const TEXT_MUTED = '#999';
const TEXT_DIM = '#666';

// ─── Types ──────────────────────────────────────────────────────
interface Brand {
  id: string;
  name: string;
}

interface ChangeEntry {
  id: string;
  brand_id: string;
  platform: 'meta' | 'google';
  entity_type: 'campaign' | 'adset' | 'ad_group';
  entity_id: string;
  entity_name: string;
  change_type: 'status_change' | 'budget_change' | 'new_entity' | 'removed';
  old_value: string | null;
  new_value: string | null;
  detected_at: string;
}

// ─── Helpers ────────────────────────────────────────────────────
function changeIcon(type: string) {
  switch (type) {
    case 'status_change':
      return <ArrowRightLeft size={14} />;
    case 'budget_change':
      return <DollarSign size={14} />;
    case 'new_entity':
      return <PlusCircle size={14} />;
    case 'removed':
      return <MinusCircle size={14} />;
    default:
      return <Activity size={14} />;
  }
}

function changeColor(type: string) {
  switch (type) {
    case 'status_change':
      return '#60A5FA'; // blue
    case 'budget_change':
      return '#FBBF24'; // amber
    case 'new_entity':
      return '#34D399'; // green
    case 'removed':
      return '#F87171'; // red
    default:
      return TEXT_MUTED;
  }
}

function changeLabel(type: string) {
  switch (type) {
    case 'status_change':
      return 'Status Change';
    case 'budget_change':
      return 'Budget Change';
    case 'new_entity':
      return 'New';
    case 'removed':
      return 'Removed';
    default:
      return type;
  }
}

function formatDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function platformBadge(platform: string) {
  const isMeta = platform === 'meta';
  return (
    <span
      className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded"
      style={{
        background: isMeta ? 'rgba(59,130,246,0.12)' : 'rgba(234,179,8,0.12)',
        color: isMeta ? '#60A5FA' : '#FBBF24',
      }}
    >
      {isMeta ? 'META' : 'GOOGLE'}
    </span>
  );
}

function entityBadge(type: string) {
  return (
    <span
      className="text-[10px] uppercase px-1.5 py-0.5 rounded"
      style={{ background: 'rgba(255,255,255,0.05)', color: TEXT_DIM }}
    >
      {type === 'ad_group' ? 'ad group' : type}
    </span>
  );
}

// ═══════════════════════════════════════════════════════════════════
export default function AdChangelogPage() {
  const router = useRouter();
  const supabase = createClient();

  const [authToken, setAuthToken] = useState<string | null>(null);
  const [userRole, setUserRole] = useState('');
  const [brands, setBrands] = useState<Brand[]>([]);
  const [selectedBrandId, setSelectedBrandId] = useState('');
  const [entries, setEntries] = useState<ChangeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filterPlatform, setFilterPlatform] = useState<'all' | 'meta' | 'google'>('all');
  const [filterType, setFilterType] = useState<string>('all');
  const [lastRefreshed, setLastRefreshed] = useState<string | null>(null);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanInfo, setScanInfo] = useState<string | null>(null);

  // ─── Auth ───────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push('/'); return; }
      setAuthToken(session.access_token);

      const { data: profile } = await supabase
        .from('users_profile')
        .select('role, brand_id')
        .eq('id', session.user.id)
        .single();

      if (!profile || !['admin', 'founder'].includes(profile.role)) {
        router.push('/');
        return;
      }

      setUserRole(profile.role);

      if (profile.role === 'admin') {
        const { data: allBrands } = await supabase
          .from('brands')
          .select('id, name')
          .is('archived_at', null)
          .order('name');
        setBrands(allBrands || []);
        const saved = localStorage.getItem('melch_selected_brand');
        if (saved && allBrands?.find((b: Brand) => b.id === saved)) {
          setSelectedBrandId(saved);
        } else if (allBrands?.length) {
          setSelectedBrandId(allBrands[0].id);
        }
      } else {
        if (profile.brand_id) {
          setSelectedBrandId(profile.brand_id);
          const { data: brand } = await supabase
            .from('brands')
            .select('id, name')
            .eq('id', profile.brand_id)
            .single();
          if (brand) setBrands([brand]);
        }
      }

      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Fetch changelog entries ────────────────────────────────────
  const fetchEntries = useCallback(async () => {
    if (!authToken || !selectedBrandId) return;
    setEntriesLoading(true);
    setFetchError(null);
    try {
      const res = await fetch(`/api/ad-changelog?brand_id=${selectedBrandId}&limit=200`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFetchError(body?.error || `Failed to load changelog (${res.status})`);
        setEntries([]);
        return;
      }
      setEntries(body.entries || []);
    } catch (e: unknown) {
      setFetchError(e instanceof Error ? e.message : 'Failed to load changelog');
      setEntries([]);
    } finally {
      setEntriesLoading(false);
    }
  }, [authToken, selectedBrandId]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  // ─── Manual refresh ─────────────────────────────────────────────
  const handleRefresh = async () => {
    if (!authToken || !selectedBrandId || refreshing) return;
    setRefreshing(true);
    setScanError(null);
    setScanInfo(null);
    try {
      const res = await fetch('/api/ad-changelog', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ brand_id: selectedBrandId }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok || !result.success) {
        setScanError(result?.error || `Scan failed (${res.status})`);
        return;
      }
      setLastRefreshed(new Date().toISOString());
      const scanned = result.entities_scanned ?? 0;
      const changes = result.changes_detected ?? 0;
      let info = `Scanned ${scanned} entities · ${changes} change${changes === 1 ? '' : 's'} detected`;
      if (Array.isArray(result.errors) && result.errors.length > 0) {
        info += ` · warnings: ${result.errors.join('; ')}`;
        setScanError(result.errors.join(' · '));
      }
      setScanInfo(info);
      await fetchEntries();
    } catch (e: unknown) {
      setScanError(e instanceof Error ? e.message : 'Scan failed');
    } finally {
      setRefreshing(false);
    }
  };

  // ─── Brand switch ───────────────────────────────────────────────
  const handleBrandChange = (id: string) => {
    setSelectedBrandId(id);
    localStorage.setItem('melch_selected_brand', id);
  };

  // ─── Filtered entries ───────────────────────────────────────────
  const filtered = entries.filter((e) => {
    if (filterPlatform !== 'all' && e.platform !== filterPlatform) return false;
    if (filterType !== 'all' && e.change_type !== filterType) return false;
    return true;
  });

  // ─── Group by date ──────────────────────────────────────────────
  const grouped = new Map<string, ChangeEntry[]>();
  for (const e of filtered) {
    const day = new Date(e.detected_at).toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
    if (!grouped.has(day)) grouped.set(day, []);
    grouped.get(day)!.push(e);
  }

  const brandName = brands.find((b) => b.id === selectedBrandId)?.name || '';

  // ═══════════════════════════════════════════════════════════════
  if (loading) {
    return (
      <Navbar>
        <div className="flex items-center justify-center h-screen bg-[#0a0a0a]">
          <Loader className="animate-spin" size={28} style={{ color: GOLD }} />
        </div>
      </Navbar>
    );
  }

  return (
    <Navbar>
      <div className="min-h-screen bg-[#0a0a0a] px-4 md:px-8 py-6 max-w-[1000px] mx-auto">
        {/* ── Header ──────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: GOLD_DIM }}
            >
              <Activity size={20} style={{ color: GOLD }} />
            </div>
            <div>
              <h1 className="text-xl font-semibold" style={{ color: TEXT_PRIMARY }}>
                Ad Account Changelog
              </h1>
              <p className="text-xs mt-0.5" style={{ color: TEXT_MUTED }}>
                {brandName ? `${brandName} — ` : ''}Status & budget changes across Meta and Google
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Brand selector (admin only) */}
            {userRole === 'admin' && brands.length > 1 && (
              <div className="relative">
                <select
                  value={selectedBrandId}
                  onChange={(e) => handleBrandChange(e.target.value)}
                  className="appearance-none pl-3 pr-8 py-2 rounded-lg text-sm cursor-pointer"
                  style={{
                    background: BG_CARD,
                    color: TEXT_PRIMARY,
                    border: `1px solid ${BORDER}`,
                  }}
                >
                  {brands.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={14}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
                  style={{ color: TEXT_MUTED }}
                />
              </div>
            )}

            {/* Refresh button */}
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all hover:brightness-110 disabled:opacity-50"
              style={{ background: GOLD, color: '#0a0a0a' }}
            >
              <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
              {refreshing ? 'Scanning...' : 'Refresh Now'}
            </button>
          </div>
        </div>

        {/* ── Filters ─────────────────────────────────────────── */}
        <div
          className="flex items-center gap-3 mb-6 px-4 py-3 rounded-xl"
          style={{ background: BG_CARD, border: `1px solid ${BORDER}` }}
        >
          <Filter size={14} style={{ color: TEXT_DIM }} />
          <span className="text-xs font-medium" style={{ color: TEXT_DIM }}>
            Filter:
          </span>

          {/* Platform filter */}
          {(['all', 'meta', 'google'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setFilterPlatform(p)}
              className="text-xs px-2.5 py-1 rounded-md transition-all"
              style={{
                background: filterPlatform === p ? GOLD_DIM : 'transparent',
                color: filterPlatform === p ? GOLD : TEXT_DIM,
                border: `1px solid ${filterPlatform === p ? 'rgba(200,184,154,0.3)' : 'transparent'}`,
              }}
            >
              {p === 'all' ? 'All Platforms' : p === 'meta' ? 'Meta' : 'Google'}
            </button>
          ))}

          <span style={{ color: 'rgba(255,255,255,0.08)' }}>|</span>

          {/* Type filter */}
          {(['all', 'status_change', 'budget_change', 'new_entity', 'removed'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setFilterType(t)}
              className="text-xs px-2.5 py-1 rounded-md transition-all"
              style={{
                background: filterType === t ? GOLD_DIM : 'transparent',
                color: filterType === t ? GOLD : TEXT_DIM,
                border: `1px solid ${filterType === t ? 'rgba(200,184,154,0.3)' : 'transparent'}`,
              }}
            >
              {t === 'all' ? 'All Types' : changeLabel(t)}
            </button>
          ))}
        </div>

        {/* ── Status banners ──────────────────────────────────── */}
        {(lastRefreshed || scanInfo) && (
          <p className="text-[10px] mb-3" style={{ color: TEXT_DIM }}>
            {scanInfo || `Last scanned: ${formatDate(lastRefreshed!)}`}
          </p>
        )}
        {(fetchError || scanError) && (
          <div
            className="flex items-start gap-2 mb-4 px-4 py-3 rounded-xl text-sm"
            style={{
              background: 'rgba(248,113,113,0.08)',
              border: '1px solid rgba(248,113,113,0.25)',
              color: '#F87171',
            }}
          >
            <AlertCircle size={16} className="shrink-0 mt-0.5" />
            <div className="min-w-0">
              {fetchError && <p>{fetchError}</p>}
              {scanError && <p>{scanError}</p>}
            </div>
          </div>
        )}

        {/* ── Timeline ────────────────────────────────────────── */}
        {entriesLoading ? (
          <div
            className="rounded-xl p-12 flex flex-col items-center justify-center gap-3"
            style={{ background: BG_CARD, border: `1px solid ${BORDER}` }}
          >
            <Loader className="animate-spin" size={28} style={{ color: GOLD }} />
            <p className="text-xs" style={{ color: TEXT_DIM }}>
              Loading changelog…
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div
            className="rounded-xl p-12 text-center"
            style={{ background: BG_CARD, border: `1px solid ${BORDER}` }}
          >
            <Activity size={36} style={{ color: TEXT_DIM }} className="mx-auto mb-3" />
            <p className="text-sm mb-1" style={{ color: TEXT_MUTED }}>
              {entries.length > 0
                ? 'No changes match these filters'
                : 'No changes detected yet'}
            </p>
            <p className="text-xs mb-4" style={{ color: TEXT_DIM }}>
              {entries.length > 0
                ? 'Try clearing platform or type filters.'
                : 'Click “Refresh Now” to snapshot Meta campaigns/ad sets and Google campaigns (Pipeboard). First scan seeds the baseline; later scans show diffs. Scanning is manual — there is no weekly cron.'}
            </p>
            {entries.length === 0 && (
              <button
                onClick={handleRefresh}
                disabled={refreshing || !selectedBrandId}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
                style={{ background: GOLD, color: '#0a0a0a' }}
              >
                <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
                {refreshing ? 'Scanning...' : 'Scan Now'}
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            {[...grouped.entries()].map(([day, dayEntries]) => (
              <div key={day}>
                <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: TEXT_MUTED }}>
                  {day}
                </h3>
                <div className="space-y-2">
                  {dayEntries.map((e) => (
                    <div
                      key={e.id}
                      className="flex items-start gap-3 px-4 py-3 rounded-xl transition-all hover:border-[rgba(200,184,154,0.2)]"
                      style={{ background: BG_CARD, border: `1px solid ${BORDER}` }}
                    >
                      {/* Icon */}
                      <div
                        className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
                        style={{ background: `${changeColor(e.change_type)}15`, color: changeColor(e.change_type) }}
                      >
                        {changeIcon(e.change_type)}
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          {platformBadge(e.platform)}
                          {entityBadge(e.entity_type)}
                          <span
                            className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                            style={{ background: `${changeColor(e.change_type)}15`, color: changeColor(e.change_type) }}
                          >
                            {changeLabel(e.change_type)}
                          </span>
                        </div>

                        <p className="text-sm font-medium truncate" style={{ color: TEXT_PRIMARY }}>
                          {e.entity_name || e.entity_id}
                        </p>

                        {/* Change detail */}
                        {e.change_type === 'status_change' && (
                          <p className="text-xs mt-0.5" style={{ color: TEXT_MUTED }}>
                            <span style={{ color: '#F87171' }}>{e.old_value}</span>
                            {' → '}
                            <span style={{ color: '#34D399' }}>{e.new_value}</span>
                          </p>
                        )}
                        {e.change_type === 'budget_change' && (
                          <p className="text-xs mt-0.5" style={{ color: TEXT_MUTED }}>
                            <span style={{ color: '#F87171' }}>{e.old_value}</span>
                            {' → '}
                            <span style={{ color: '#34D399' }}>{e.new_value}</span>
                          </p>
                        )}
                        {e.change_type === 'new_entity' && (
                          <p className="text-xs mt-0.5" style={{ color: TEXT_MUTED }}>
                            Detected with status: <span style={{ color: '#34D399' }}>{e.new_value}</span>
                          </p>
                        )}
                        {e.change_type === 'removed' && (
                          <p className="text-xs mt-0.5" style={{ color: TEXT_MUTED }}>
                            Previously: <span style={{ color: '#F87171' }}>{e.old_value}</span>
                          </p>
                        )}
                      </div>

                      {/* Timestamp */}
                      <span className="text-[10px] shrink-0 mt-1" style={{ color: TEXT_DIM }}>
                        {formatDate(e.detected_at)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Navbar>
  );
}
