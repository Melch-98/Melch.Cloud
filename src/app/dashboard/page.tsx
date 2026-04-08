'use client';

import { useEffect, useState, useRef, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader, TrendingUp, TrendingDown, Inbox, ArrowRight, Package, Shuffle, Users as UsersIcon } from 'lucide-react';
import Navbar from '@/components/Navbar';
import { createClient } from '@/lib/supabase';

interface TickerRow {
  brand_id: string;
  brand_name: string;
  channel: 'meta' | 'google';
  spend: number;
  revenue: number;
  roas: number;
}

interface BrandAgg {
  brand_id: string;
  brand_name: string;
  spend: number;
  revenue: number;
  roas: number;
  channels: Array<'meta' | 'google'>;
}

interface NewBatch {
  id: string;
  batch_name: string;
  brand_id: string;
  brand_name: string;
  creative_type: string;
  is_carousel: boolean;
  is_flexible: boolean;
  is_whitelist: boolean;
  file_count: number;
  created_at: string;
  drive_folder_url: string | null;
  drive_sync_status: string | null;
}

const fmtMoney = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const fmtRoas = (n: number) => `${n.toFixed(2)}x`;

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function DashboardPage() {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [userName, setUserName] = useState('');
  const [tickerRows, setTickerRows] = useState<TickerRow[]>([]);
  const [tickerError, setTickerError] = useState(false);
  const [newBatches, setNewBatches] = useState<NewBatch[]>([]);
  const [batchFilter, setBatchFilter] = useState<string>('all');
  const tokenRef = useRef<string | null>(null);

  // Auth + profile gate
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.push('/');
        return;
      }
      tokenRef.current = session.access_token;

      const { data: profile } = await supabase
        .from('users_profile')
        .select('role, full_name')
        .eq('id', session.user.id)
        .single();

      if (!profile || !['admin', 'founder', 'strategist'].includes(profile.role)) {
        router.push('/');
        return;
      }

      setUserName(profile.full_name || session.user.email?.split('@')[0] || '');
      setLoading(false);
    })();
  }, [router, supabase]);

  // Ticker fetch + 60s refresh
  useEffect(() => {
    if (loading) return;
    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetch('/api/ticker-stats', {
          headers: { Authorization: `Bearer ${tokenRef.current}` },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const j = await res.json();
        if (!cancelled) {
          setTickerRows(j.rows || []);
          setTickerError(false);
        }
      } catch {
        if (!cancelled) setTickerError(true);
      }
    };

    load();
    const id = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [loading]);

  // New batches fetch
  useEffect(() => {
    if (loading) return;
    let cancelled = false;

    const loadBatches = async () => {
      const { data, error } = await supabase
        .from('submissions')
        .select(`
          id,
          batch_name,
          brand_id,
          creative_type,
          is_carousel,
          is_flexible,
          is_whitelist,
          file_count,
          created_at,
          batch_status,
          drive_folder_url,
          drive_sync_status,
          brands:brand_id (name)
        `)
        .eq('batch_status', 'new')
        .order('created_at', { ascending: false })
        .limit(20);

      if (!cancelled && !error && data) {
        const mapped: NewBatch[] = (data as any[]).map((r) => ({
          id: r.id,
          batch_name: r.batch_name,
          brand_id: r.brand_id,
          brand_name: r.brands?.name || 'Unknown',
          creative_type: r.creative_type || '',
          is_carousel: !!r.is_carousel,
          is_flexible: !!r.is_flexible,
          is_whitelist: !!r.is_whitelist,
          file_count: r.file_count || 0,
          created_at: r.created_at,
          drive_folder_url: r.drive_folder_url || null,
          drive_sync_status: r.drive_sync_status || null,
        }));
        setNewBatches(mapped);
      }
    };

    loadBatches();
    const id = setInterval(loadBatches, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [loading, supabase]);

  // Aggregate ticker rows by brand (combine Meta + Google)
  const brandAggs = useMemo<BrandAgg[]>(() => {
    const map = new Map<string, BrandAgg>();
    for (const r of tickerRows) {
      const existing = map.get(r.brand_id);
      if (existing) {
        existing.spend += r.spend;
        existing.revenue += r.revenue;
        if (!existing.channels.includes(r.channel)) existing.channels.push(r.channel);
      } else {
        map.set(r.brand_id, {
          brand_id: r.brand_id,
          brand_name: r.brand_name,
          spend: r.spend,
          revenue: r.revenue,
          roas: 0,
          channels: [r.channel],
        });
      }
    }
    const rows = Array.from(map.values()).map((b) => ({
      ...b,
      roas: b.spend > 0 ? b.revenue / b.spend : 0,
    }));
    rows.sort((a, b) => b.spend - a.spend);
    return rows;
  }, [tickerRows]);

  // Brand options for new-batches filter
  const batchBrandOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const b of newBatches) seen.set(b.brand_id, b.brand_name);
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
  }, [newBatches]);

  const filteredNewBatches = useMemo(() => {
    if (batchFilter === 'all') return newBatches;
    return newBatches.filter((b) => b.brand_id === batchFilter);
  }, [newBatches, batchFilter]);

  if (loading) {
    return (
      <Navbar>
        <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#0a0a0a' }}>
          <Loader className="w-8 h-8 animate-spin" style={{ color: '#C8B89A' }} />
        </div>
      </Navbar>
    );
  }

  // Build ticker text repeated to feel continuous
  const tickerItems = tickerRows.length === 0
    ? [{ key: 'empty', text: tickerError ? 'Ticker offline — retrying' : 'Loading live spend…' }]
    : tickerRows.map((r) => ({
        key: `${r.brand_id}-${r.channel}`,
        brand: r.brand_name,
        channel: r.channel === 'meta' ? 'META' : 'GOOGLE',
        spend: fmtMoney(r.spend),
        roas: fmtRoas(r.roas),
        positive: r.roas >= 1,
      }));

  return (
    <Navbar>
      <div className="min-h-screen" style={{ backgroundColor: '#0a0a0a', color: '#F5F5F8' }}>
      <main className="px-8 pt-10 pb-32 max-w-7xl mx-auto w-full">
        <header className="mb-10">
          <h1 className="text-3xl font-semibold mb-2">
            Welcome back{userName ? `, ${userName}` : ''}
          </h1>
          <p className="text-sm" style={{ color: '#ABABAB' }}>
            Your command center at a glance.
          </p>
        </header>

        {/* Brand-aggregated performance table */}
        <section
          className="rounded-2xl border overflow-hidden mb-8"
          style={{
            backgroundColor: 'rgba(13,13,13,0.5)',
            borderColor: 'rgba(255,255,255,0.08)',
          }}
        >
          <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
            <div>
              <h2 className="text-base font-semibold tracking-tight">Today&apos;s Performance</h2>
              <p className="text-xs mt-0.5" style={{ color: '#6B6560' }}>Meta + Google combined, by brand</p>
            </div>
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider" style={{ color: '#6B6560' }}>
              <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: '#C8B89A' }} />
              Live
            </div>
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: 'rgba(255,255,255,0.02)' }}>
                <th className="text-left px-6 py-3 text-[11px] font-medium uppercase tracking-wider" style={{ color: '#6B6560' }}>Brand</th>
                <th className="text-left px-4 py-3 text-[11px] font-medium uppercase tracking-wider" style={{ color: '#6B6560' }}>Channels</th>
                <th className="text-right px-4 py-3 text-[11px] font-medium uppercase tracking-wider" style={{ color: '#6B6560' }}>Spend</th>
                <th className="text-right px-4 py-3 text-[11px] font-medium uppercase tracking-wider" style={{ color: '#6B6560' }}>Revenue</th>
                <th className="text-right px-6 py-3 text-[11px] font-medium uppercase tracking-wider" style={{ color: '#6B6560' }}>ROAS</th>
              </tr>
            </thead>
            <tbody>
              {brandAggs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-10 text-center text-xs" style={{ color: '#6B6560' }}>
                    {tickerError ? 'No data available.' : 'Loading…'}
                  </td>
                </tr>
              ) : (
                brandAggs.map((b) => (
                  <tr key={b.brand_id} style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }} className="hover:bg-[rgba(255,255,255,0.02)] transition-colors">
                    <td className="px-6 py-4 font-medium" style={{ color: '#F5F5F8' }}>{b.brand_name}</td>
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-1.5">
                        {b.channels.includes('meta') && (
                          <span
                            className="text-[10px] font-semibold px-2 py-0.5 rounded"
                            style={{ backgroundColor: 'rgba(66,135,245,0.12)', color: '#4287f5', letterSpacing: '0.05em' }}
                          >
                            META
                          </span>
                        )}
                        {b.channels.includes('google') && (
                          <span
                            className="text-[10px] font-semibold px-2 py-0.5 rounded"
                            style={{ backgroundColor: 'rgba(234,67,53,0.12)', color: '#ea4335', letterSpacing: '0.05em' }}
                          >
                            GOOGLE
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-4 text-right tabular-nums" style={{ color: '#F5F5F8' }}>{fmtMoney(b.spend)}</td>
                    <td className="px-4 py-4 text-right tabular-nums" style={{ color: '#F5F5F8' }}>{fmtMoney(b.revenue)}</td>
                    <td className="px-6 py-4 text-right tabular-nums font-semibold" style={{ color: b.roas >= 1 ? '#22C55E' : b.roas > 0 ? '#EF4444' : '#6B6560' }}>
                      {b.spend > 0 ? fmtRoas(b.roas) : '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>

        {/* New batches widget */}
        <section
          className="rounded-2xl border overflow-hidden"
          style={{
            backgroundColor: 'rgba(13,13,13,0.5)',
            borderColor: 'rgba(255,255,255,0.08)',
          }}
        >
          <div className="flex items-center justify-between px-6 py-4 border-b gap-4 flex-wrap" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
            <div className="flex items-center gap-2.5">
              <Inbox className="w-4 h-4" style={{ color: '#C8B89A' }} />
              <div>
                <h2 className="text-base font-semibold tracking-tight">New Batches</h2>
                <p className="text-xs mt-0.5" style={{ color: '#6B6560' }}>
                  {newBatches.length} awaiting build
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <select
                value={batchFilter}
                onChange={(e) => setBatchFilter(e.target.value)}
                className="text-xs px-3 py-1.5 rounded-lg focus:outline-none transition-colors"
                style={{
                  backgroundColor: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  color: '#F5F5F8',
                }}
              >
                <option value="all">All brands</option>
                {batchBrandOptions.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>

              <Link
                href="/admin"
                className="text-xs font-medium flex items-center gap-1 px-3 py-1.5 rounded-lg transition-colors"
                style={{ color: '#C8B89A', backgroundColor: 'rgba(200,184,154,0.08)' }}
              >
                View queue <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
          </div>

          {filteredNewBatches.length === 0 ? (
            <div className="px-6 py-12 text-center text-xs" style={{ color: '#6B6560' }}>
              No new batches in the queue.
            </div>
          ) : (
            <ul>
              {filteredNewBatches.map((b) => {
                const typeIcon = b.is_carousel ? Package : b.is_flexible ? Shuffle : b.is_whitelist ? UsersIcon : null;
                const typeLabel = b.is_carousel ? 'Carousel' : b.is_flexible ? 'Flexible' : b.is_whitelist ? 'Whitelist' : b.creative_type || 'Standard';
                return (
                  <li
                    key={b.id}
                    className="flex items-center gap-4 px-6 py-3.5 hover:bg-[rgba(255,255,255,0.02)] transition-colors"
                    style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-semibold truncate" style={{ color: '#F5F5F8' }}>{b.brand_name}</span>
                        <span className="text-[11px] font-mono px-1.5 py-0.5 rounded" style={{ color: '#C8B89A', backgroundColor: 'rgba(200,184,154,0.08)' }}>
                          {b.batch_name}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-[11px]" style={{ color: '#6B6560' }}>
                        {typeIcon ? (
                          <span className="flex items-center gap-1">
                            {(() => {
                              const Icon = typeIcon;
                              return <Icon className="w-3 h-3" />;
                            })()}
                            {typeLabel}
                          </span>
                        ) : (
                          <span>{typeLabel}</span>
                        )}
                        <span>·</span>
                        <span>{b.file_count} file{b.file_count === 1 ? '' : 's'}</span>
                        <span>·</span>
                        <span>{timeAgo(b.created_at)}</span>
                      </div>
                    </div>
                    {b.drive_sync_status === 'synced' && b.drive_folder_url ? (
                      <a
                        href={b.drive_folder_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 text-[11px] font-medium px-2.5 py-1 rounded transition-colors"
                        style={{ color: '#22C55E', backgroundColor: 'rgba(34,197,94,0.08)' }}
                      >
                        Open in Dropbox →
                      </a>
                    ) : b.drive_sync_status === 'syncing' ? (
                      <span
                        className="shrink-0 text-[11px] font-medium px-2.5 py-1 rounded"
                        style={{ color: '#9AADCC', backgroundColor: 'rgba(154,173,204,0.08)' }}
                      >
                        Syncing…
                      </span>
                    ) : b.drive_sync_status === 'pending' ? (
                      <span
                        className="shrink-0 text-[11px] font-medium px-2.5 py-1 rounded"
                        style={{ color: '#C8B89A', backgroundColor: 'rgba(200,184,154,0.06)' }}
                      >
                        Queued
                      </span>
                    ) : b.drive_sync_status === 'failed' ? (
                      <span
                        className="shrink-0 text-[11px] font-medium px-2.5 py-1 rounded"
                        style={{ color: '#EF4444', backgroundColor: 'rgba(239,68,68,0.08)' }}
                      >
                        Sync failed
                      </span>
                    ) : (
                      <Link
                        href="/admin"
                        className="shrink-0 text-[11px] font-medium px-2.5 py-1 rounded transition-colors"
                        style={{ color: '#C8B89A', backgroundColor: 'rgba(200,184,154,0.06)' }}
                      >
                        Open →
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>

      {/* SportsCenter-style ticker */}
      <div
        className="fixed bottom-0 left-0 right-0 border-t overflow-hidden"
        style={{
          backgroundColor: 'rgba(10,10,10,0.95)',
          borderColor: 'rgba(200,184,154,0.2)',
          backdropFilter: 'blur(8px)',
          height: '56px',
        }}
      >
        <div className="flex items-center h-full">
          <div
            className="flex-shrink-0 px-4 h-full flex items-center font-bold text-xs tracking-wider"
            style={{
              backgroundColor: '#C8B89A',
              color: '#0a0a0a',
            }}
          >
            LIVE · TODAY
          </div>
          <div className="flex-1 overflow-hidden relative">
            <div className="ticker-track flex items-center gap-12 whitespace-nowrap py-4 px-6">
              {[...tickerItems, ...tickerItems, ...tickerItems].map((item, i) => (
                <div key={`${item.key}-${i}`} className="flex items-center gap-3 text-sm">
                  {'brand' in item ? (
                    <>
                      <span className="font-semibold" style={{ color: '#F5F5F8' }}>{item.brand}</span>
                      <span className="text-xs px-2 py-0.5 rounded" style={{
                        backgroundColor: item.channel === 'META' ? 'rgba(24,119,242,0.15)' : 'rgba(234,67,53,0.15)',
                        color: item.channel === 'META' ? '#4287f5' : '#ea4335',
                      }}>{item.channel}</span>
                      <span style={{ color: '#ABABAB' }}>Spend</span>
                      <span style={{ color: '#F5F5F8' }}>{item.spend}</span>
                      <span style={{ color: '#ABABAB' }}>·</span>
                      <span style={{ color: '#ABABAB' }}>ROAS</span>
                      <span className="flex items-center gap-1" style={{ color: item.positive ? '#22C55E' : '#EF4444' }}>
                        {item.positive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                        {item.roas}
                      </span>
                      <span style={{ color: '#333' }}>|</span>
                    </>
                  ) : (
                    <span style={{ color: '#666' }}>{item.text}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
        <style jsx>{`
          .ticker-track {
            animation: ticker-scroll 80s linear infinite;
            width: max-content;
          }
          @keyframes ticker-scroll {
            0% { transform: translateX(0); }
            100% { transform: translateX(-33.333%); }
          }
        `}</style>
      </div>
      </div>
    </Navbar>
  );
}
