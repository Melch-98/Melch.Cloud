'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, Loader, RefreshCw } from 'lucide-react';
import Navbar from '@/components/Navbar';
import { createClient } from '@/lib/supabase';
import { stackAds } from '@/components/funnel-viewer/lib/adModel';
import { setCurrency } from '@/components/funnel-viewer/lib/format';
import { setChartRange } from '@/components/funnel-viewer/lib/adCharts';
import type { Ad } from '@/components/funnel-viewer/lib/api';
import {
  DEFAULT_PRESET,
  isPreset,
  presetRange,
  type Preset,
} from '@/components/funnel-viewer/lib/dateRanges';
import { classifyFunnelPositions } from '@/components/funnel-viewer/space/funnelPosition';
import { DatePicker } from '@/components/funnel-viewer/components/DatePicker';
import { AdDrawer } from '@/components/funnel-viewer/components/AdDrawer';
import '@/components/funnel-viewer/funnel-viewer.css';

const CreativeSpace3D = dynamic(
  () => import('@/components/funnel-viewer/space/CreativeSpace3D').then((m) => m.CreativeSpace3D),
  { ssr: false },
);

type BrandOpt = { id: string; name: string; meta_ad_account_id: string | null };
type Range = { since: string; until: string; preset: Preset | null };
type AdsPayload = {
  brand: { id: string; name: string };
  account: { id: string; name: string; currency: string; timezone_name: string | null };
  since: string;
  until: string;
  currency: string;
  fetched_at: string;
  cached: boolean;
  truncated: boolean;
  total_ads: number;
  note: string | null;
  ads: Ad[];
};

const LS_RANGE = 'fv.range';

function initialRange(): Range {
  const r = presetRange(DEFAULT_PRESET);
  return { since: r.start, until: r.end, preset: DEFAULT_PRESET };
}

function zonedNow(timeZone: string): Date {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(new Date());
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value || 0);
    return new Date(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  } catch {
    return new Date();
  }
}

export default function FunnelViewerPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [brands, setBrands] = useState<BrandOpt[]>([]);
  const [brandId, setBrandId] = useState('');
  const [range, setRange] = useState<Range>(initialRange);
  const [rangeReady, setRangeReady] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [brandOpen, setBrandOpen] = useState(false);
  const [data, setData] = useState<AdsPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [zoneApplied, setZoneApplied] = useState(false);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(LS_RANGE) || 'null');
      if (saved && isPreset(saved.preset)) {
        const r = presetRange(saved.preset);
        setRange({ since: r.start, until: r.end, preset: saved.preset });
      } else if (saved && /^\d{4}-\d{2}-\d{2}$/.test(saved.since) && /^\d{4}-\d{2}-\d{2}$/.test(saved.until)) {
        setRange({ since: saved.since, until: saved.until, preset: null });
      }
    } catch { /* storage off */ }
    setRangeReady(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push('/'); return; }
      if (cancelled) return;
      setAuthToken(session.access_token);
      const { data: profile } = await supabase
        .from('users_profile')
        .select('role, brand_id')
        .eq('id', session.user.id)
        .single();
      if (cancelled) return;
      const userRole = profile?.role || null;
      setRole(userRole);
      if (userRole && !['admin', 'strategist', 'founder'].includes(userRole)) {
        setError('You do not have access to Funnel Viewer.');
        return;
      }
      const { data: rows } = await supabase
        .from('brands')
        .select('id, name, meta_ad_account_id')
        .is('archived_at', null)
        .order('name');
      if (cancelled) return;
      let list = (rows || []) as BrandOpt[];
      if (userRole && userRole !== 'admin') {
        list = profile?.brand_id ? list.filter((b) => b.id === profile.brand_id) : [];
      }
      setBrands(list);
      const saved = localStorage.getItem('melch_selected_brand');
      const match = saved && list.find((b) => b.id === saved);
      setBrandId(match ? match.id : (profile?.brand_id && list.some((b) => b.id === profile.brand_id) ? profile.brand_id : list[0]?.id || ''));
    })();
    return () => { cancelled = true; };
  }, [router, supabase]);

  const applyRange = useCallback((since: string, until: string, preset: Preset | null) => {
    const next = { since, until, preset };
    setRange(next);
    setPickerOpen(false);
    setZoneApplied(true);
    try { localStorage.setItem(LS_RANGE, JSON.stringify(next)); } catch { /* storage off */ }
  }, []);

  const load = useCallback(async (refresh = false) => {
    if (!authToken || !brandId || !rangeReady) return;
    setLoading(true);
    setError(null);
    setErrorCode(null);
    try {
      const q = new URLSearchParams({ brandId, since: range.since, until: range.until });
      if (refresh) q.set('refresh', '1');
      const res = await fetch(`/api/funnel-viewer/ads?${q}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error || 'Could not load ads');
        setErrorCode(body.code || null);
        if (res.status !== 429) setData(null);
        return;
      }
      setCurrency(body.currency);
      setChartRange(body.since, body.until);
      setData(body);
      setSelected(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load ads');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [authToken, brandId, range.since, range.until, rangeReady]);

  useEffect(() => { load(false); }, [load]);

  useEffect(() => {
    if (!data?.account?.timezone_name || zoneApplied || range.preset !== DEFAULT_PRESET) return;
    const zoned = presetRange(DEFAULT_PRESET, zonedNow(data.account.timezone_name));
    if (zoned.start !== range.since || zoned.end !== range.until) {
      applyRange(zoned.start, zoned.end, DEFAULT_PRESET);
    }
    setZoneApplied(true);
  }, [data, range.preset, range.since, range.until, zoneApplied, applyRange]);

  const sourceAds = useMemo(() => data?.ads ?? [], [data]);
  const cards = useMemo(() => stackAds(sourceAds), [sourceAds]);
  const funnel = useMemo(() => classifyFunnelPositions(sourceAds), [sourceAds]);
  const selectedAd = selected ? cards.find((c) => c.ad_id === selected) : undefined;
  const spending = sourceAds.some((ad) => ad.spend > 0);
  const brand = brands.find((b) => b.id === brandId);
  const locked = role !== 'admin';

  const chooseBrand = (id: string) => {
    setBrandId(id);
    setBrandOpen(false);
    setData(null);
    setSelected(null);
    setZoneApplied(false);
    try { localStorage.setItem('melch_selected_brand', id); } catch { /* storage off */ }
  };

  return (
    <Navbar>
      <div className="funnel-viewer flex flex-col h-[calc(100dvh-3.5rem)] md:h-dvh overflow-hidden">
        <header className="flex items-center gap-2 px-3 sm:px-5 py-2.5 border-b border-white/[0.08] shrink-0">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.08em] text-[#888]">Creative Analytics</div>
            <h1 className="text-sm font-medium text-[#f5f5f8] leading-tight">Funnel Viewer</h1>
          </div>
          <div className="flex-1" />
          {locked ? (
            <span className="text-[12px] text-[#f5f5f8] truncate max-w-[40vw]">{brand?.name || 'Your brand'}</span>
          ) : (
            <div className="relative">
              <button type="button" onClick={() => setBrandOpen((v) => !v)}
                className="h-8 px-3 rounded-full text-[12px] flex items-center gap-1.5 bg-white/[0.04] border border-white/[0.08] text-[#f5f5f8]">
                <span className="truncate max-w-[180px]">{brand?.name || 'Select brand'}</span>
                <ChevronDown size={14} />
              </button>
              {brandOpen && (
                <div className="absolute right-0 top-10 z-30 w-64 max-h-80 overflow-y-auto rounded-xl border border-white/[0.08] bg-[#161616] py-1 shadow-popover">
                  {brands.map((b) => (
                    <button key={b.id} type="button" onClick={() => chooseBrand(b.id)}
                      className={`w-full text-left px-3 py-1.5 text-[12px] hover:bg-white/[0.06] ${b.id === brandId ? 'text-[#c8b89a]' : 'text-[#f5f5f8]'}`}>
                      {b.name}{b.meta_ad_account_id ? '' : ' · no Meta account'}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="relative">
            <button type="button" onClick={() => setPickerOpen((v) => !v)}
              className="h-8 px-3 rounded-full text-[12px] bg-white/[0.04] border border-white/[0.08] text-[#f5f5f8]">
              {range.preset || `${range.since} – ${range.until}`}
            </button>
            {pickerOpen && (
              <div className="absolute right-0 top-10 z-30">
                <DatePicker start={range.since} end={range.until} preset={range.preset}
                  onApply={applyRange} onClose={() => setPickerOpen(false)} />
              </div>
            )}
          </div>
          <button type="button" onClick={() => load(true)} disabled={loading || !brandId}
            className="h-8 w-8 rounded-full flex items-center justify-center border border-white/[0.08] text-[#c8b89a] disabled:opacity-40"
            aria-label="Refresh">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </header>

        {data?.note && !error && (
          <div className="px-4 py-1.5 text-[12px] text-[#c8b89a] border-b border-white/[0.06]">{data.note}</div>
        )}

        <div className="relative flex-1 min-h-0 flex flex-col">
          {loading && data && (
            <div className="absolute inset-x-0 top-0 z-20 px-3 pt-1.5 pointer-events-none">
              <div className="fv-progress"><span /></div>
            </div>
          )}
          {!brandId && role ? (
            <Empty title="No brand is assigned to this account" body="An admin can assign a brand from Team." />
          ) : error ? (
            <Empty title={errorTitle(errorCode, error)} body={error} />
          ) : !data && loading ? (
            <div className="flex-1 flex items-center justify-center text-[#888] text-[13px] gap-2">
              <Loader size={16} className="animate-spin" /> Pulling ads from Meta…
            </div>
          ) : data && !spending ? (
            <Empty title="No ads with spend in this date range" body="Nothing in this account spent between these dates. Try a longer range." />
          ) : data ? (
            <CreativeSpace3D
              ads={cards}
              funnel={funnel}
              scope={brandId}
              demo={false}
              fetchedAt={data.fetched_at}
              selectedId={selected}
              onOpen={setSelected}
            />
          ) : (
            <div className="flex-1" />
          )}
        </div>
        {selectedAd && (
          <AdDrawer ad={selectedAd} demo={false} placement={funnel.get(selectedAd.ad_id)} onClose={() => setSelected(null)} />
        )}
      </div>
    </Navbar>
  );
}

function errorTitle(code: string | null, error: string): string {
  if (code === 'no_meta_account' || /no meta ad account/i.test(error)) return 'No Meta ad account linked to this brand.';
  if (code === 'meta_token_invalid') return 'Meta token expired — ask an admin to refresh';
  if (code === 'meta_permission') return 'This Meta ad account is not reachable';
  if (code === 'throttled') return 'Meta is rate limiting this account';
  return 'Could not load ads';
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="max-w-md w-full rounded-2xl border border-white/[0.08] bg-[#111] p-6">
        <h2 className="text-[18px] text-[#f5f5f8] mb-2">{title}</h2>
        <p className="text-[13px] text-[#888] leading-relaxed">{body}</p>
      </div>
    </div>
  );
}
