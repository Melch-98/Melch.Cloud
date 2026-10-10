'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Loader, RefreshCw, Activity, ChevronDown, Filter, AlertCircle } from 'lucide-react';
import Navbar from '@/components/Navbar';
import { createClient } from '@/lib/supabase';

const GOLD = '#C8B89A';
const GOLD_DIM = 'rgba(200,184,154,0.18)';
const BG_CARD = '#111111';
const BORDER = 'rgba(200,184,154,0.10)';
const TEXT_PRIMARY = '#F5F5F8';
const TEXT_MUTED = '#999';
const TEXT_DIM = '#666';
const CHICAGO = 'America/Chicago';

type ChangeType =
  | 'budget'
  | 'bid_or_target'
  | 'status'
  | 'created'
  | 'removed'
  | 'creative'
  | 'targeting'
  | 'name'
  | 'other';

interface Brand {
  id: string;
  name: string;
}

interface ActivityEntry {
  id: string;
  platform: 'meta' | 'google';
  occurred_at: string;
  actor: string | null;
  tool: string | null;
  change_type: ChangeType;
  summary: string | null;
  is_system: boolean;
}

interface PlatformSync {
  connected: boolean;
  last_success_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
}

interface FeedResponse {
  entries: ActivityEntry[];
  actors: string[];
  sync: { meta: PlatformSync; google: PlatformSync };
  empty_reason: 'not_connected' | 'error' | 'no_changes' | null;
}

const CHANGE_LABELS: Record<ChangeType, string> = {
  budget: 'Budget',
  bid_or_target: 'Bid / target',
  status: 'Status',
  created: 'Created',
  removed: 'Removed',
  creative: 'Creative',
  targeting: 'Targeting',
  name: 'Name',
  other: 'Other',
};

function chicagoYmd(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: CHICAGO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function shiftYmd(ymd: string, days: number): string {
  const [year, month, day] = ymd.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function formatCtTime(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: CHICAGO,
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(iso));
}

function formatCtDay(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: CHICAGO,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(iso));
}

function formatSynced(iso: string | null): string {
  if (!iso) return 'not synced yet';
  return formatCtTime(iso);
}

function changeColor(type: string): string {
  switch (type) {
    case 'budget':
    case 'bid_or_target':
      return '#FBBF24';
    case 'status':
      return '#60A5FA';
    case 'created':
      return '#34D399';
    case 'removed':
      return '#F87171';
    case 'creative':
      return '#C084FC';
    case 'targeting':
      return '#2DD4BF';
    case 'name':
      return GOLD;
    default:
      return TEXT_MUTED;
  }
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

export default function AdChangelogPage() {
  const router = useRouter();
  const supabase = createClient();
  const today = chicagoYmd();

  const [authToken, setAuthToken] = useState<string | null>(null);
  const [userRole, setUserRole] = useState('');
  const [brands, setBrands] = useState<Brand[]>([]);
  const [selectedBrandId, setSelectedBrandId] = useState('');
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [actors, setActors] = useState<string[]>([]);
  const [sync, setSync] = useState<FeedResponse['sync'] | null>(null);
  const [emptyReason, setEmptyReason] = useState<FeedResponse['empty_reason']>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [filterPlatform, setFilterPlatform] = useState<'all' | 'meta' | 'google'>('all');
  const [filterType, setFilterType] = useState<string>('all');
  const [filterActor, setFilterActor] = useState('all');
  const [fromDate, setFromDate] = useState(shiftYmd(today, -6));
  const [toDate, setToDate] = useState(today);
  const [showSystem, setShowSystem] = useState(false);

  useEffect(() => {
    (async () => {
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
        if (saved && allBrands?.find((brand: Brand) => brand.id === saved)) {
          setSelectedBrandId(saved);
        } else if (allBrands?.length) {
          setSelectedBrandId(allBrands[0].id);
        }
      } else if (profile.brand_id) {
        setSelectedBrandId(profile.brand_id);
        const { data: brandRow } = await supabase
          .from('brands')
          .select('id, name')
          .eq('id', profile.brand_id)
          .single();
        if (brandRow) setBrands([brandRow]);
      }

      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchEntries = useCallback(async () => {
    if (!authToken || !selectedBrandId) return;
    setEntriesLoading(true);
    setFetchError(null);
    try {
      const params = new URLSearchParams({
        brand_id: selectedBrandId,
        from: fromDate,
        to: toDate,
        include_system: showSystem ? '1' : '0',
      });
      if (filterPlatform !== 'all') params.set('platform', filterPlatform);
      if (filterType !== 'all') params.set('change_type', filterType);
      if (filterActor !== 'all') params.set('actor', filterActor);
      const res = await fetch(`/api/ad-changelog?${params.toString()}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFetchError(body?.error || `Failed to load changelog (${res.status})`);
        setEntries([]);
        setSync(null);
        setEmptyReason(null);
        return;
      }
      const feed = body as FeedResponse;
      setEntries(feed.entries || []);
      setActors(feed.actors || []);
      setSync(feed.sync || null);
      setEmptyReason(feed.empty_reason ?? null);
    } catch (error: unknown) {
      setFetchError(error instanceof Error ? error.message : 'Failed to load changelog');
      setEntries([]);
    } finally {
      setEntriesLoading(false);
    }
  }, [authToken, selectedBrandId, fromDate, toDate, showSystem, filterPlatform, filterType, filterActor]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  const handleRefresh = async () => {
    if (!authToken || !selectedBrandId || refreshing) return;
    setRefreshing(true);
    setScanError(null);
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
      if (res.status === 429) {
        setScanError(result?.error || 'Refresh is limited to once a minute.');
        return;
      }
      if (!res.ok) {
        setScanError(result?.error || `Refresh failed (${res.status})`);
        return;
      }
      if (result.connected === false) {
        setScanError('This brand has no Meta or Google ad account.');
      } else if (Array.isArray(result.errors) && result.errors.length > 0) {
        setScanError(result.errors.join(' · '));
      }
      await fetchEntries();
    } catch (error: unknown) {
      setScanError(error instanceof Error ? error.message : 'Refresh failed');
    } finally {
      setRefreshing(false);
    }
  };

  const handleBrandChange = (id: string) => {
    setSelectedBrandId(id);
    setFilterActor('all');
    localStorage.setItem('melch_selected_brand', id);
  };

  const grouped: { day: string; dayEntries: ActivityEntry[] }[] = [];
  for (const entry of entries) {
    const day = formatCtDay(entry.occurred_at);
    const last = grouped[grouped.length - 1];
    if (last && last.day === day) last.dayEntries.push(entry);
    else grouped.push({ day, dayEntries: [entry] });
  }

  const brandName = brands.find((brand) => brand.id === selectedBrandId)?.name || '';
  const narrowed = filterType !== 'all' || filterActor !== 'all' || filterPlatform !== 'all';
  const syncProblems = [
    sync?.meta.connected && sync.meta.last_error ? `Meta: ${sync.meta.last_error}` : null,
    sync?.google.connected && sync.google.last_error ? `Google: ${sync.google.last_error}` : null,
  ].filter((line): line is string => !!line);

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
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: GOLD_DIM }}>
              <Activity size={20} style={{ color: GOLD }} />
            </div>
            <div>
              <h1 className="text-xl font-semibold" style={{ color: TEXT_PRIMARY }}>
                Ad Account Changelog
              </h1>
              <p className="text-xs mt-0.5" style={{ color: TEXT_MUTED }}>
                {brandName ? `${brandName} — ` : ''}Live changes from Meta and Google. Times in CT.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {userRole === 'admin' && brands.length > 1 && (
              <div className="relative">
                <select
                  aria-label="Brand"
                  value={selectedBrandId}
                  onChange={(event) => handleBrandChange(event.target.value)}
                  className="appearance-none pl-3 pr-8 py-2 rounded-lg text-sm cursor-pointer"
                  style={{ background: BG_CARD, color: TEXT_PRIMARY, border: `1px solid ${BORDER}` }}
                >
                  {brands.map((brand) => (
                    <option key={brand.id} value={brand.id}>
                      {brand.name}
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

            <button
              onClick={handleRefresh}
              disabled={refreshing || !selectedBrandId}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all hover:brightness-110 disabled:opacity-50"
              style={{ background: GOLD, color: '#0a0a0a' }}
            >
              <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>

        <div
          className="flex flex-wrap items-center gap-3 mb-4 px-4 py-3 rounded-xl"
          style={{ background: BG_CARD, border: `1px solid ${BORDER}` }}
        >
          <Filter size={14} style={{ color: TEXT_DIM }} />
          {(['all', 'meta', 'google'] as const).map((platform) => (
            <button
              key={platform}
              onClick={() => setFilterPlatform(platform)}
              className="text-xs px-2.5 py-1 rounded-md transition-all"
              style={{
                background: filterPlatform === platform ? GOLD_DIM : 'transparent',
                color: filterPlatform === platform ? GOLD : TEXT_DIM,
                border: `1px solid ${filterPlatform === platform ? 'rgba(200,184,154,0.3)' : 'transparent'}`,
              }}
            >
              {platform === 'all' ? 'All platforms' : platform === 'meta' ? 'Meta' : 'Google'}
            </button>
          ))}

          <select
            aria-label="Change type"
            value={filterType}
            onChange={(event) => setFilterType(event.target.value)}
            className="text-xs px-2 py-1 rounded-md"
            style={{ background: '#0a0a0a', color: TEXT_PRIMARY, border: `1px solid ${BORDER}` }}
          >
            <option value="all">All change types</option>
            {(Object.keys(CHANGE_LABELS) as ChangeType[]).map((type) => (
              <option key={type} value={type}>
                {CHANGE_LABELS[type]}
              </option>
            ))}
          </select>

          <select
            aria-label="Person"
            value={filterActor}
            onChange={(event) => setFilterActor(event.target.value)}
            className="text-xs px-2 py-1 rounded-md max-w-[180px]"
            style={{ background: '#0a0a0a', color: TEXT_PRIMARY, border: `1px solid ${BORDER}` }}
          >
            <option value="all">Everyone</option>
            {actors.map((actor) => (
              <option key={actor} value={actor}>
                {actor}
              </option>
            ))}
          </select>

          <label className="flex items-center gap-1.5 text-xs" style={{ color: TEXT_MUTED }}>
            <span>From</span>
            <input
              type="date"
              aria-label="From date"
              value={fromDate}
              onChange={(event) => setFromDate(event.target.value)}
              className="px-2 py-1 rounded-md"
              style={{ background: '#0a0a0a', color: TEXT_PRIMARY, border: `1px solid ${BORDER}` }}
            />
          </label>
          <label className="flex items-center gap-1.5 text-xs" style={{ color: TEXT_MUTED }}>
            <span>To</span>
            <input
              type="date"
              aria-label="To date"
              value={toDate}
              onChange={(event) => setToDate(event.target.value)}
              className="px-2 py-1 rounded-md"
              style={{ background: '#0a0a0a', color: TEXT_PRIMARY, border: `1px solid ${BORDER}` }}
            />
          </label>

          <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: TEXT_MUTED }}>
            <input
              type="checkbox"
              checked={showSystem}
              onChange={(event) => setShowSystem(event.target.checked)}
            />
            System events
          </label>
        </div>

        {sync && (
          <div className="flex flex-wrap gap-4 mb-4 text-[11px]" style={{ color: TEXT_DIM }}>
            <PlatformSyncLine name="Meta" state={sync.meta} />
            <PlatformSyncLine name="Google" state={sync.google} />
          </div>
        )}

        {(fetchError || scanError || syncProblems.length > 0) && (
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
              {syncProblems.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          </div>
        )}

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
        ) : entries.length === 0 && !fetchError ? (
          <EmptyState
            reason={emptyReason}
            narrowed={narrowed}
            sync={sync}
            refreshing={refreshing}
            onRefresh={handleRefresh}
          />
        ) : (
          <div className="space-y-6">
            {grouped.map(({ day, dayEntries }) => (
              <div key={day}>
                <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: TEXT_MUTED }}>
                  {day}
                </h3>
                <div className="space-y-2">
                  {dayEntries.map((entry) => (
                    <div
                      key={entry.id}
                      className="flex items-start gap-3 px-4 py-3 rounded-xl"
                      style={{
                        background: BG_CARD,
                        border: `1px solid ${BORDER}`,
                        opacity: entry.is_system ? 0.72 : 1,
                      }}
                    >
                      <div
                        className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
                        style={{ background: `${changeColor(entry.change_type)}15`, color: changeColor(entry.change_type) }}
                      >
                        <Activity size={14} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          {platformBadge(entry.platform)}
                          <span
                            className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                            style={{
                              background: `${changeColor(entry.change_type)}15`,
                              color: changeColor(entry.change_type),
                            }}
                          >
                            {CHANGE_LABELS[entry.change_type] || entry.change_type}
                          </span>
                          {entry.is_system && (
                            <span className="text-[10px] uppercase px-1.5 py-0.5 rounded" style={{ color: TEXT_DIM }}>
                              System
                            </span>
                          )}
                        </div>
                        <p className="text-sm" style={{ color: TEXT_PRIMARY }}>
                          {entry.summary || 'Change recorded'}
                        </p>
                      </div>
                      <span className="text-[10px] shrink-0 mt-1" style={{ color: TEXT_DIM }}>
                        {formatCtTime(entry.occurred_at)}
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

function PlatformSyncLine({ name, state }: { name: string; state: PlatformSync }) {
  if (!state.connected) {
    return (
      <span>
        {name} · not connected
      </span>
    );
  }
  if (state.last_error && !state.last_success_at) {
    return (
      <span style={{ color: '#F87171' }} title={state.last_error}>
        {name} · error{state.last_error_at ? ` ${formatSynced(state.last_error_at)}` : ''}
      </span>
    );
  }
  return (
    <span title={state.last_error || undefined}>
      {name} · last synced {formatSynced(state.last_success_at)}
      {state.last_error ? ' · last attempt failed' : ''}
    </span>
  );
}

function EmptyState({
  reason,
  narrowed,
  sync,
  refreshing,
  onRefresh,
}: {
  reason: FeedResponse['empty_reason'];
  narrowed: boolean;
  sync: FeedResponse['sync'] | null;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const errorText = [sync?.meta.last_error, sync?.google.last_error].filter(Boolean).join(' · ');
  let title = 'No changes';
  let body = 'Nothing changed in this range.';
  if (reason === 'not_connected') {
    title = 'Not connected';
    body = 'This brand has no Meta ad account or Google Ads customer ID.';
  } else if (reason === 'error') {
    title = 'Couldn’t load activity';
    body = errorText || 'The last sync failed. Refresh to try again.';
  } else if (narrowed) {
    title = 'No changes';
    body = 'No changes match these filters.';
  }

  return (
    <div className="rounded-xl p-12 text-center" style={{ background: BG_CARD, border: `1px solid ${BORDER}` }}>
      <Activity size={36} style={{ color: TEXT_DIM }} className="mx-auto mb-3" />
      <p className="text-sm mb-1" style={{ color: TEXT_MUTED }}>
        {title}
      </p>
      <p className="text-xs mb-4" style={{ color: TEXT_DIM }}>
        {body}
      </p>
      {reason !== 'not_connected' && (
        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
          style={{ background: GOLD, color: '#0a0a0a' }}
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      )}
    </div>
  );
}
