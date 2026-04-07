'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Loader, TrendingUp, TrendingDown } from 'lucide-react';
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

const fmtMoney = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const fmtRoas = (n: number) => `${n.toFixed(2)}x`;

export default function DashboardPage() {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [userName, setUserName] = useState('');
  const [tickerRows, setTickerRows] = useState<TickerRow[]>([]);
  const [tickerError, setTickerError] = useState(false);
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

      if (!profile || !['admin', 'founder'].includes(profile.role)) {
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

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#0a0a0a' }}>
        <Loader className="w-8 h-8 animate-spin" style={{ color: '#C8B89A' }} />
      </div>
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
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#0a0a0a', color: '#F5F5F8' }}>
      <Navbar />

      <main className="flex-1 px-8 py-10 pb-24 max-w-7xl mx-auto w-full">
        <header className="mb-10">
          <h1 className="text-3xl font-semibold mb-2">
            Welcome back{userName ? `, ${userName}` : ''}
          </h1>
          <p className="text-sm" style={{ color: '#ABABAB' }}>
            Your command center at a glance.
          </p>
        </header>

        {/* Placeholder content area */}
        <div
          className="rounded-2xl border p-10"
          style={{
            backgroundColor: 'rgba(13,13,13,0.5)',
            borderColor: 'rgba(255,255,255,0.08)',
          }}
        >
          <div className="text-center py-16">
            <p className="text-sm uppercase tracking-wider mb-3" style={{ color: '#C8B89A' }}>
              Coming soon
            </p>
            <h2 className="text-2xl font-semibold mb-3">Dashboard widgets</h2>
            <p className="text-sm max-w-md mx-auto" style={{ color: '#ABABAB' }}>
              Daily snapshots, brand cards, and activity feeds will live here.
              In the meantime, check the live ticker below for real-time spend and ROAS.
            </p>
          </div>

          {/* Placeholder table */}
          <div className="mt-8 overflow-hidden rounded-xl border" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}>
                  <th className="text-left px-4 py-3 font-medium" style={{ color: '#ABABAB' }}>Brand</th>
                  <th className="text-right px-4 py-3 font-medium" style={{ color: '#ABABAB' }}>Today Spend</th>
                  <th className="text-right px-4 py-3 font-medium" style={{ color: '#ABABAB' }}>Today Revenue</th>
                  <th className="text-right px-4 py-3 font-medium" style={{ color: '#ABABAB' }}>ROAS</th>
                </tr>
              </thead>
              <tbody>
                {tickerRows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center" style={{ color: '#666' }}>
                      {tickerError ? 'No data available.' : 'Loading…'}
                    </td>
                  </tr>
                ) : (
                  tickerRows.map((r) => (
                    <tr key={`${r.brand_id}-${r.channel}`} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                      <td className="px-4 py-3">
                        {r.brand_name} <span style={{ color: '#666' }}>· {r.channel === 'meta' ? 'Meta' : 'Google'}</span>
                      </td>
                      <td className="px-4 py-3 text-right">{fmtMoney(r.spend)}</td>
                      <td className="px-4 py-3 text-right">{fmtMoney(r.revenue)}</td>
                      <td className="px-4 py-3 text-right" style={{ color: r.roas >= 1 ? '#22C55E' : '#EF4444' }}>
                        {fmtRoas(r.roas)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
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
  );
}
