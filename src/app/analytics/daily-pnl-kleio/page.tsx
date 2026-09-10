'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Calendar,
  DollarSign,
  Loader,
  Plug,
  RefreshCw,
  TrendingUp,
} from 'lucide-react';
import Navbar from '@/components/Navbar';
import { createClient } from '@/lib/supabase';
import {
  TALLOW_TWINS_BRAND_ID,
  TALLOW_TWINS_SLUG,
  type KleioHeroMetric,
  type KleioPeriod,
  type KleioPnLPayload,
  type KleioTimeseriesPoint,
} from '@/lib/kleio';

const BG = '#0a0a0a';
const GOLD = '#c8b89a';
const CARD = '#111111';
const BORDER = 'rgba(200,184,154,0.14)';
const MUTED = '#888';

const PERIODS: { id: KleioPeriod; label: string }[] = [
  { id: 'mtd', label: 'MTD' },
  { id: 'last_7', label: 'Last 7' },
  { id: 'last_30', label: 'Last 30' },
  { id: 'custom', label: 'Custom' },
];

function fmtValue(m: KleioHeroMetric, currency: string): string {
  if (m.value == null || !Number.isFinite(m.value)) return '—';
  const v = m.value;
  if (m.format === 'currency') {
    return new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency: currency || 'CAD',
      maximumFractionDigits: 0,
    }).format(v);
  }
  if (m.format === 'percent') {
    // Accept 0–1 or 0–100
    const pct = Math.abs(v) <= 1.5 ? v * 100 : v;
    return `${pct.toFixed(1)}%`;
  }
  if (m.format === 'ratio') return `${v.toFixed(2)}x`;
  return new Intl.NumberFormat('en-CA').format(Math.round(v));
}

function sectionTitle(section: string): string {
  switch (section) {
    case 'cm':
      return 'Contribution Margin';
    case 'sales':
      return 'Net Sales';
    case 'spend':
      return 'Total Spend';
    case 'efficiency':
      return 'MER & aMER';
    case 'nc_rc':
      return 'New vs Returning';
    case 'channel':
      return 'Channel Spend';
    case 'platform':
      return 'Platform ROAS (not bank)';
    default:
      return section;
  }
}

function groupHero(hero: KleioHeroMetric[]) {
  const order = ['cm', 'sales', 'spend', 'efficiency', 'nc_rc', 'channel', 'platform'] as const;
  const map = new Map<string, KleioHeroMetric[]>();
  for (const m of hero) {
    const s = m.section || 'cm';
    if (!map.has(s)) map.set(s, []);
    map.get(s)!.push(m);
  }
  return order.filter((s) => map.has(s)).map((s) => ({ section: s, metrics: map.get(s)! }));
}

export default function DailyPnLKleioPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [userBrandId, setUserBrandId] = useState<string | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [brandOk, setBrandOk] = useState(false);
  const [brandName, setBrandName] = useState('Tallow Twins');
  const [period, setPeriod] = useState<KleioPeriod>('mtd');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [payload, setPayload] = useState<KleioPnLPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Auth + Tallow gate
  useEffect(() => {
    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        router.push('/');
        return;
      }

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
      setUserBrandId(profile.brand_id);
      setAuthToken(session.access_token);

      // Resolve brand: founders locked to their brand; admins force TT for this page
      let brandId = TALLOW_TWINS_BRAND_ID;
      if (profile.role === 'founder') {
        if (!profile.brand_id) {
          setBrandOk(false);
          setLoading(false);
          return;
        }
        brandId = profile.brand_id;
      }

      const { data: brand } = await supabase
        .from('brands')
        .select('id, name, slug')
        .eq('id', brandId)
        .single();

      const isTT =
        brand &&
        (brand.id === TALLOW_TWINS_BRAND_ID || brand.slug === TALLOW_TWINS_SLUG);

      if (!isTT) {
        setBrandOk(false);
        setBrandName(brand?.name || 'Current brand');
        setLoading(false);
        return;
      }

      setBrandOk(true);
      setBrandName(brand.name || 'Tallow Twins');
      setLoading(false);
    })();
  }, [router, supabase]);

  const loadPnL = useCallback(async () => {
    if (!authToken || !brandOk) return;
    setFetching(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        brandId: TALLOW_TWINS_BRAND_ID,
        period,
      });
      if (period === 'custom') {
        if (customStart) qs.set('start', customStart);
        if (customEnd) qs.set('end', customEnd);
      }
      const res = await fetch(`/api/kleio-pnl?${qs.toString()}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const data = await res.json();
      if (data.error === 'tallow_twins_only') {
        setBrandOk(false);
        setPayload(null);
        setError(data.message || 'Kleio P&L test is Tallow Twins only.');
        return;
      }
      // 503 kleio_not_configured still returns structured payload
      if (data.hero) {
        setPayload(data as KleioPnLPayload);
        if (data.status && data.status !== 'ok') {
          setError(data.message || data.status);
        }
      } else {
        setError(data.error || data.message || 'Failed to load Kleio P&L');
      }
    } catch (e: any) {
      setError(e?.message || 'Request failed');
    } finally {
      setFetching(false);
    }
  }, [authToken, brandOk, period, customStart, customEnd]);

  useEffect(() => {
    if (!loading && brandOk && authToken) loadPnL();
  }, [loading, brandOk, authToken, period, loadPnL]);

  const groups = useMemo(
    () => (payload?.hero ? groupHero(payload.hero) : []),
    [payload]
  );
  const currency = payload?.currency || 'CAD';
  const primaryGroups = groups.filter((g) =>
    ['cm', 'sales', 'spend', 'efficiency', 'nc_rc'].includes(g.section)
  );
  const secondaryGroups = groups.filter((g) =>
    ['channel', 'platform'].includes(g.section)
  );

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: BG }}>
        <Navbar>
          <div className="flex items-center justify-center h-[60vh] gap-3" style={{ color: GOLD }}>
            <Loader className="animate-spin" size={20} />
            <span className="text-sm">Loading Kleio P&L…</span>
          </div>
        </Navbar>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: BG }}>
      <Navbar>
        <div className="p-6 max-w-7xl mx-auto">
          {/* Header */}
          <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <DollarSign size={18} style={{ color: GOLD }} />
                <h1 className="text-xl font-semibold tracking-tight" style={{ color: '#F5F5F8' }}>
                  Daily P&amp;L <span style={{ color: GOLD }}>(Kleio)</span>
                </h1>
                <span
                  className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                  style={{ backgroundColor: 'rgba(200,184,154,0.15)', color: GOLD }}
                >
                  Beta
                </span>
              </div>
              <p className="text-sm" style={{ color: MUTED }}>
                Tallow Twins test · Melch-branded shell · does not write to{' '}
                <code style={{ color: GOLD }}>daily_pnl</code>
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Brand lock */}
              <div
                className="px-3 py-2 rounded-lg text-sm font-medium"
                style={{ background: CARD, border: `1px solid ${BORDER}`, color: GOLD }}
                title="This Kleio test page is locked to Tallow Twins"
              >
                {brandOk ? brandName : brandName}
                <span className="ml-2 text-[10px] uppercase tracking-wider" style={{ color: MUTED }}>
                  locked
                </span>
              </div>

              {/* Currency chip */}
              <div
                className="px-3 py-2 rounded-lg text-sm font-mono font-semibold"
                style={{ background: CARD, border: `1px solid ${BORDER}`, color: '#F5F5F8' }}
                title="Reporting currency"
              >
                {currency}
              </div>

              <button
                onClick={() => loadPnL()}
                disabled={!brandOk || fetching}
                className="px-3 py-2 rounded-lg text-sm flex items-center gap-2 disabled:opacity-40"
                style={{ background: CARD, border: `1px solid ${BORDER}`, color: GOLD }}
              >
                <RefreshCw size={14} className={fetching ? 'animate-spin' : ''} />
                Refresh
              </button>
            </div>
          </div>

          {/* Non-TT empty state */}
          {!brandOk && (
            <div
              className="rounded-xl p-10 text-center"
              style={{ background: CARD, border: `1px solid ${BORDER}` }}
            >
              <AlertTriangle className="mx-auto mb-3" size={28} style={{ color: GOLD }} />
              <h2 className="text-lg font-semibold mb-2" style={{ color: '#F5F5F8' }}>
                Kleio P&amp;L test is Tallow Twins only
              </h2>
              <p className="text-sm max-w-md mx-auto" style={{ color: MUTED }}>
                This surface is gated to brand slug <code style={{ color: GOLD }}>tallow-twins</code>
                {userRole === 'founder' && userBrandId
                  ? ' and your account is not on that brand.'
                  : '.'}{' '}
                Switch brand context or ask an admin to open the TT Kleio test.
              </p>
            </div>
          )}

          {brandOk && (
            <>
              {/* Period controls */}
              <div className="flex flex-wrap items-center gap-2 mb-5">
                <Calendar size={14} style={{ color: MUTED }} />
                {PERIODS.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setPeriod(p.id)}
                    className="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
                    style={{
                      background: period === p.id ? 'rgba(200,184,154,0.15)' : CARD,
                      border: `1px solid ${period === p.id ? GOLD : BORDER}`,
                      color: period === p.id ? GOLD : MUTED,
                    }}
                  >
                    {p.label}
                  </button>
                ))}
                {period === 'custom' && (
                  <div className="flex items-center gap-2 ml-2">
                    <input
                      type="date"
                      value={customStart}
                      onChange={(e) => setCustomStart(e.target.value)}
                      className="px-2 py-1.5 rounded-lg text-sm"
                      style={{ background: CARD, border: `1px solid ${BORDER}`, color: '#F5F5F8' }}
                    />
                    <span style={{ color: MUTED }}>→</span>
                    <input
                      type="date"
                      value={customEnd}
                      onChange={(e) => setCustomEnd(e.target.value)}
                      className="px-2 py-1.5 rounded-lg text-sm"
                      style={{ background: CARD, border: `1px solid ${BORDER}`, color: '#F5F5F8' }}
                    />
                    <button
                      onClick={() => loadPnL()}
                      className="px-3 py-1.5 rounded-lg text-sm"
                      style={{ background: 'rgba(200,184,154,0.15)', color: GOLD }}
                    >
                      Apply
                    </button>
                  </div>
                )}
                {payload && (
                  <span className="text-xs ml-auto" style={{ color: MUTED }}>
                    {payload.start_date} → {payload.end_date}
                  </span>
                )}
              </div>

              {/* Connect Kleio banner */}
              {payload?.status === 'kleio_not_configured' && (
                <div
                  className="rounded-xl p-4 mb-5 flex gap-3 items-start"
                  style={{
                    background: 'rgba(200,184,154,0.06)',
                    border: `1px solid ${BORDER}`,
                  }}
                >
                  <Plug size={18} className="mt-0.5 flex-shrink-0" style={{ color: GOLD }} />
                  <div>
                    <p className="text-sm font-medium mb-1" style={{ color: GOLD }}>
                      Connect Kleio server-side
                    </p>
                    <p className="text-xs leading-relaxed" style={{ color: MUTED }}>
                      Kleio MCP (<code>app.getkleio.com/api/mcp</code>) is chat/OAuth only — the browser
                      cannot call it. Set <code style={{ color: GOLD }}>KLEIO_API_KEY</code> +{' '}
                      <code style={{ color: GOLD }}>KLEIO_API_BASE_URL</code> on the host to wire live
                      HTTP. Until then this page shows the Melch shell + API shape (
                      <code>kleio_not_configured</code>). See <code>docs/kleio-pnl.md</code>.
                    </p>
                  </div>
                </div>
              )}

              {payload?.status === 'kleio_upstream_error' && (
                <div
                  className="rounded-xl p-4 mb-5 flex gap-3 items-start"
                  style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)' }}
                >
                  <AlertTriangle size={18} className="mt-0.5" style={{ color: '#f87171' }} />
                  <p className="text-sm" style={{ color: '#fca5a5' }}>
                    {error || payload.message || 'Kleio upstream error'}
                  </p>
                </div>
              )}

              {/* Primary hero sections */}
              <div className="space-y-5 mb-8">
                {primaryGroups.map(({ section, metrics }) => (
                  <div key={section}>
                    <div className="flex items-center gap-2 mb-2">
                      <TrendingUp size={14} style={{ color: GOLD }} />
                      <h2
                        className="text-xs font-semibold uppercase tracking-widest"
                        style={{ color: MUTED }}
                      >
                        {sectionTitle(section)}
                      </h2>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                      {metrics.map((m) => (
                        <div
                          key={m.key}
                          className="rounded-xl p-4"
                          style={{
                            background: CARD,
                            border: `1px solid ${
                              section === 'cm' ? 'rgba(200,184,154,0.28)' : BORDER
                            }`,
                          }}
                        >
                          <p
                            className="text-[10px] uppercase tracking-wider mb-2"
                            style={{ color: MUTED }}
                          >
                            {m.label}
                          </p>
                          <p
                            className="text-2xl font-semibold font-mono tracking-tight"
                            style={{ color: section === 'cm' ? GOLD : '#F5F5F8' }}
                          >
                            {fmtValue(m, currency)}
                          </p>
                          {m.hint && (
                            <p className="text-[10px] mt-2" style={{ color: '#555' }}>
                              {m.hint}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {/* Subordinate channel + platform */}
              {secondaryGroups.length > 0 && (
                <div
                  className="rounded-xl p-5 mb-8"
                  style={{ background: '#0d0d0d', border: `1px solid ${BORDER}` }}
                >
                  <p
                    className="text-[10px] uppercase tracking-widest mb-4"
                    style={{ color: '#555' }}
                  >
                    Subordinate · channel dollars &amp; platform ROAS (not bank)
                  </p>
                  <div className="space-y-4">
                    {secondaryGroups.map(({ section, metrics }) => (
                      <div key={section}>
                        <h3
                          className="text-xs font-semibold uppercase tracking-widest mb-2"
                          style={{ color: MUTED }}
                        >
                          {sectionTitle(section)}
                        </h3>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                          {metrics.map((m) => (
                            <div
                              key={m.key}
                              className="rounded-lg p-3"
                              style={{ background: CARD, border: `1px solid rgba(255,255,255,0.04)` }}
                            >
                              <p
                                className="text-[10px] uppercase tracking-wider mb-1"
                                style={{ color: '#666' }}
                              >
                                {m.label}
                              </p>
                              <p className="text-lg font-mono" style={{ color: '#ccc' }}>
                                {fmtValue(m, currency)}
                              </p>
                              {m.hint && (
                                <p className="text-[10px] mt-1" style={{ color: '#555' }}>
                                  {m.hint}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Timeseries placeholder */}
              <div
                className="rounded-xl p-5"
                style={{ background: CARD, border: `1px solid ${BORDER}` }}
              >
                <h2
                  className="text-xs font-semibold uppercase tracking-widest mb-3"
                  style={{ color: MUTED }}
                >
                  Timeseries
                </h2>
                {fetching && !payload ? (
                  <div className="flex items-center gap-2 py-10 justify-center" style={{ color: GOLD }}>
                    <Loader className="animate-spin" size={16} />
                    <span className="text-sm">Fetching /api/kleio-pnl…</span>
                  </div>
                ) : (
                  <TimeseriesStub points={payload?.timeseries || []} currency={currency} />
                )}
              </div>
            </>
          )}
        </div>
      </Navbar>
    </div>
  );
}

function TimeseriesStub({
  points,
  currency,
}: {
  points: KleioTimeseriesPoint[];
  currency: string;
}) {
  if (!points.length) {
    return (
      <div className="py-12 text-center">
        <div
          className="mx-auto mb-4 h-24 max-w-xl rounded-lg"
          style={{
            background:
              'linear-gradient(180deg, rgba(200,184,154,0.08) 0%, rgba(200,184,154,0.02) 100%)',
            border: `1px dashed ${BORDER}`,
          }}
        />
        <p className="text-sm" style={{ color: MUTED }}>
          No timeseries yet — wire Kleio HTTP or accept precomputed payload via{' '}
          <code style={{ color: GOLD }}>/api/kleio-pnl</code>.
        </p>
        <p className="text-xs mt-1" style={{ color: '#555' }}>
          Expected series: net sales, CM, total spend, orders ({currency})
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr style={{ color: MUTED, borderBottom: `1px solid ${BORDER}` }}>
            <th className="text-left py-2 font-medium">Date</th>
            <th className="text-right py-2 font-medium">Revenue</th>
            <th className="text-right py-2 font-medium">CM</th>
            <th className="text-right py-2 font-medium">Spend</th>
            <th className="text-right py-2 font-medium">Orders</th>
          </tr>
        </thead>
        <tbody>
          {points.map((pt) => (
            <tr key={pt.date} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              <td className="py-2 font-mono" style={{ color: '#ccc' }}>
                {pt.date}
              </td>
              <td className="py-2 text-right font-mono" style={{ color: '#F5F5F8' }}>
                {pt.revenue == null
                  ? '—'
                  : new Intl.NumberFormat('en-CA', {
                      style: 'currency',
                      currency,
                      maximumFractionDigits: 0,
                    }).format(pt.revenue)}
              </td>
              <td className="py-2 text-right font-mono" style={{ color: GOLD }}>
                {pt.contribution_margin == null
                  ? '—'
                  : new Intl.NumberFormat('en-CA', {
                      style: 'currency',
                      currency,
                      maximumFractionDigits: 0,
                    }).format(pt.contribution_margin)}
              </td>
              <td className="py-2 text-right font-mono" style={{ color: '#ccc' }}>
                {pt.ad_spend == null
                  ? '—'
                  : new Intl.NumberFormat('en-CA', {
                      style: 'currency',
                      currency,
                      maximumFractionDigits: 0,
                    }).format(pt.ad_spend)}
              </td>
              <td className="py-2 text-right font-mono" style={{ color: '#ccc' }}>
                {pt.orders == null ? '—' : pt.orders}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
