'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  Loader,
  Rocket,
  Clock,
  Layers,
  TrendingUp,
  Package,
  Video,
  Image as ImageIcon,
  FileText,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
} from 'lucide-react';
import Navbar from '@/components/Navbar';
import { createClient } from '@/lib/supabase';

interface Submission {
  id: string;
  batch_name: string;
  brand_id: string;
  creative_type: string;
  batch_status: 'new' | 'building' | 'ready' | 'launched';
  created_at: string;
  launched_at: string | null;
  file_count: number;
  is_carousel: boolean;
  is_flexible: boolean;
  is_whitelist: boolean;
  brand_name?: string;
}

interface Brand {
  id: string;
  name: string;
}

// ─── Helpers ──────────────────────────────────────────────────
function daysAgo(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return d;
}

function diffHours(a: string, b: string): number {
  return (new Date(b).getTime() - new Date(a).getTime()) / (1000 * 60 * 60);
}

function formatDuration(hours: number): string {
  if (hours < 1) return '< 1h';
  if (hours < 24) return `${Math.round(hours)}h`;
  const days = Math.round(hours / 24);
  return `${days}d`;
}

// ─── Stat Card ────────────────────────────────────────────────
function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  accent = '#C8B89A',
  trend,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ElementType;
  accent?: string;
  trend?: 'up' | 'down' | 'flat';
}) {
  return (
    <div
      className="rounded-xl p-5 flex flex-col gap-3"
      style={{
        backgroundColor: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      <div className="flex items-center justify-between">
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center"
          style={{ backgroundColor: `${accent}15`, color: accent }}
        >
          <Icon size={18} />
        </div>
        {trend && (
          <div className="flex items-center gap-1" style={{ color: trend === 'up' ? '#9AC8A7' : trend === 'down' ? '#CC9A9A' : '#6B6560' }}>
            {trend === 'up' && <ArrowUpRight size={14} />}
            {trend === 'down' && <ArrowDownRight size={14} />}
            {trend === 'flat' && <Minus size={14} />}
          </div>
        )}
      </div>
      <div>
        <div className="text-2xl font-bold text-[#F5F5F8] tracking-tight">{value}</div>
        <div className="text-xs text-gray-500 mt-0.5">{label}</div>
      </div>
      {sub && <div className="text-[11px] text-gray-600">{sub}</div>}
    </div>
  );
}

// ─── Mini Bar ─────────────────────────────────────────────────
function MiniBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-gray-500 w-16 text-right">{label}</span>
      <div className="flex-1 h-2 rounded-full" style={{ backgroundColor: 'rgba(255,255,255,0.04)' }}>
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="text-xs font-semibold text-[#F5F5F8] w-8">{value}</span>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────
export default function StatsPage() {
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [selectedBrandId, setSelectedBrandId] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const fetchData = async () => {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push('/'); return; }

      const { data: profile } = await supabase
        .from('users_profile')
        .select('role')
        .eq('id', session.user.id)
        .single();

      if (profile?.role !== 'admin') { router.push('/'); return; }

      const [brandsRes, subsRes] = await Promise.all([
        supabase.from('brands').select('id, name').order('name'),
        supabase.from('submissions').select('id, batch_name, brand_id, creative_type, batch_status, created_at, launched_at, file_count, is_carousel, is_flexible, is_whitelist, brands:brand_id (name)').order('created_at', { ascending: false }),
      ]);

      setBrands(brandsRes.data || []);
      const subs = (subsRes.data || []).map((s: any) => ({
        ...s,
        brand_name: s.brands?.name || 'Unknown',
      }));
      setSubmissions(subs);
      setLoading(false);
    };
    fetchData();
  }, [router]);

  // ─── Filtered data ──────────────────────────────────────────
  const filtered = useMemo(() => {
    if (selectedBrandId === 'all') return submissions;
    return submissions.filter((s) => s.brand_id === selectedBrandId);
  }, [submissions, selectedBrandId]);

  // ─── Computed stats ─────────────────────────────────────────
  const stats = useMemo(() => {
    const now = new Date();
    const d7 = daysAgo(7);
    const d30 = daysAgo(30);
    const d90 = daysAgo(90);

    const total = filtered.length;
    const totalFiles = filtered.reduce((sum, s) => sum + (s.file_count || 0), 0);
    const launched = filtered.filter((s) => s.batch_status === 'launched');
    const launchedCount = launched.length;

    // Time frames
    const last7 = filtered.filter((s) => new Date(s.created_at) >= d7);
    const last30 = filtered.filter((s) => new Date(s.created_at) >= d30);
    const last90 = filtered.filter((s) => new Date(s.created_at) >= d90);
    const launched7 = launched.filter((s) => s.launched_at && new Date(s.launched_at) >= d7).length;
    const launched30 = launched.filter((s) => s.launched_at && new Date(s.launched_at) >= d30).length;
    const launched90 = launched.filter((s) => s.launched_at && new Date(s.launched_at) >= d90).length;

    // Avg time to launch (for launched batches with both dates)
    const launchTimes = launched
      .filter((s) => s.launched_at)
      .map((s) => diffHours(s.created_at, s.launched_at!));
    const avgLaunchTime = launchTimes.length > 0 ? launchTimes.reduce((a, b) => a + b, 0) / launchTimes.length : 0;

    // Recent launch times (last 30d) vs older for trend
    const recentLaunchTimes = launched
      .filter((s) => s.launched_at && new Date(s.launched_at) >= d30)
      .map((s) => diffHours(s.created_at, s.launched_at!));
    const olderLaunchTimes = launched
      .filter((s) => s.launched_at && new Date(s.launched_at) < d30)
      .map((s) => diffHours(s.created_at, s.launched_at!));
    const recentAvg = recentLaunchTimes.length > 0 ? recentLaunchTimes.reduce((a, b) => a + b, 0) / recentLaunchTimes.length : 0;
    const olderAvg = olderLaunchTimes.length > 0 ? olderLaunchTimes.reduce((a, b) => a + b, 0) / olderLaunchTimes.length : 0;
    const launchTrend: 'up' | 'down' | 'flat' = recentAvg === 0 || olderAvg === 0 ? 'flat' : recentAvg < olderAvg ? 'up' : recentAvg > olderAvg ? 'down' : 'flat';

    // Status breakdown
    const statusCounts = {
      new: filtered.filter((s) => s.batch_status === 'new').length,
      building: filtered.filter((s) => s.batch_status === 'building').length,
      ready: filtered.filter((s) => s.batch_status === 'ready').length,
      launched: launchedCount,
    };

    // Creative type breakdown
    const typeCounts: Record<string, number> = {};
    filtered.forEach((s) => {
      const t = (s.creative_type || 'other').toLowerCase();
      typeCounts[t] = (typeCounts[t] || 0) + 1;
    });

    // Per-brand counts
    const brandCounts: Record<string, number> = {};
    filtered.forEach((s) => {
      const name = s.brand_name || 'Unknown';
      brandCounts[name] = (brandCounts[name] || 0) + 1;
    });

    // Monthly uploads (last 6 months)
    const monthlyData: { label: string; count: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59);
      const label = d.toLocaleString('default', { month: 'short' });
      const count = filtered.filter((s) => {
        const cd = new Date(s.created_at);
        return cd >= d && cd <= end;
      }).length;
      monthlyData.push({ label, count });
    }

    // Upload volume trend (this month vs last)
    const thisMonth = monthlyData[5]?.count || 0;
    const lastMonth = monthlyData[4]?.count || 0;
    const volumeTrend: 'up' | 'down' | 'flat' = thisMonth > lastMonth ? 'up' : thisMonth < lastMonth ? 'down' : 'flat';

    return {
      total,
      totalFiles,
      launchedCount,
      last7: last7.length,
      last30: last30.length,
      last90: last90.length,
      launched7,
      launched30,
      launched90,
      avgLaunchTime,
      launchTrend,
      statusCounts,
      typeCounts,
      brandCounts,
      monthlyData,
      volumeTrend,
      inPipeline: statusCounts.new + statusCounts.building + statusCounts.ready,
    };
  }, [filtered]);

  const maxMonthly = Math.max(...stats.monthlyData.map((m) => m.count), 1);
  const maxType = Math.max(...Object.values(stats.typeCounts), 1);
  const maxBrand = Math.max(...Object.values(stats.brandCounts), 1);

  if (loading) {
    return (
      <Navbar>
        <div className="flex items-center justify-center h-screen">
          <Loader className="w-6 h-6 animate-spin text-[#C8B89A]" />
        </div>
      </Navbar>
    );
  }

  return (
    <Navbar>
      <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[#F5F5F8] tracking-tight">Statistics</h1>
            <p className="text-sm text-gray-500 mt-1">Creative performance and pipeline analytics</p>
          </div>
          <select
            value={selectedBrandId}
            onChange={(e) => setSelectedBrandId(e.target.value)}
            className="px-4 py-2 rounded-lg text-sm text-[#F5F5F8] focus:outline-none"
            style={{
              backgroundColor: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
            }}
          >
            <option value="all">All Brands</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </div>

        {/* ─── Top KPI Cards ─────────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            label="Total Batches"
            value={stats.total}
            sub={`${stats.totalFiles} total files`}
            icon={Layers}
          />
          <StatCard
            label="Launched"
            value={stats.launchedCount}
            sub={`${stats.total > 0 ? Math.round((stats.launchedCount / stats.total) * 100) : 0}% launch rate`}
            icon={Rocket}
            accent="#9AC8A7"
          />
          <StatCard
            label="Avg. Time to Launch"
            value={stats.avgLaunchTime > 0 ? formatDuration(stats.avgLaunchTime) : '—'}
            sub={stats.launchTrend === 'up' ? 'Faster recently' : stats.launchTrend === 'down' ? 'Slower recently' : ''}
            icon={Clock}
            accent="#9AADCC"
            trend={stats.avgLaunchTime > 0 ? stats.launchTrend : undefined}
          />
          <StatCard
            label="In Pipeline"
            value={stats.inPipeline}
            sub={`${stats.statusCounts.new} new · ${stats.statusCounts.building} building · ${stats.statusCounts.ready} ready`}
            icon={TrendingUp}
            accent="#C8B89A"
          />
        </div>

        {/* ─── Time-Frame Breakdown ──────────────────────────────── */}
        <div
          className="rounded-xl p-5"
          style={{
            backgroundColor: 'rgba(255,255,255,0.02)',
            border: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          <h2 className="text-sm font-semibold text-[#F5F5F8] mb-4">Uploads by Time Frame</h2>
          <div className="grid grid-cols-3 gap-6">
            <div className="text-center">
              <div className="text-3xl font-bold text-[#F5F5F8]">{stats.last7}</div>
              <div className="text-xs text-gray-500 mt-1">Last 7 days</div>
              <div className="text-[11px] text-[#9AC8A7] mt-0.5">{stats.launched7} launched</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-[#F5F5F8]">{stats.last30}</div>
              <div className="text-xs text-gray-500 mt-1">Last 30 days</div>
              <div className="text-[11px] text-[#9AC8A7] mt-0.5">{stats.launched30} launched</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-[#F5F5F8]">{stats.last90}</div>
              <div className="text-xs text-gray-500 mt-1">Last 90 days</div>
              <div className="text-[11px] text-[#9AC8A7] mt-0.5">{stats.launched90} launched</div>
            </div>
          </div>
        </div>

        {/* ─── Charts Row ────────────────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Monthly Trend */}
          <div
            className="rounded-xl p-5"
            style={{
              backgroundColor: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-sm font-semibold text-[#F5F5F8]">Monthly Upload Volume</h2>
              {stats.volumeTrend !== 'flat' && (
                <div className="flex items-center gap-1 text-xs" style={{ color: stats.volumeTrend === 'up' ? '#9AC8A7' : '#CC9A9A' }}>
                  {stats.volumeTrend === 'up' ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                  {stats.volumeTrend === 'up' ? 'Trending up' : 'Trending down'}
                </div>
              )}
            </div>
            <div className="flex items-end gap-2 h-32">
              {stats.monthlyData.map((m, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[10px] font-semibold text-[#F5F5F8]">{m.count || ''}</span>
                  <div className="w-full flex justify-center">
                    <div
                      className="w-full max-w-[32px] rounded-t-md transition-all duration-700"
                      style={{
                        height: `${Math.max((m.count / maxMonthly) * 96, 4)}px`,
                        background: i === stats.monthlyData.length - 1
                          ? 'linear-gradient(180deg, #C8B89A 0%, #A89474 100%)'
                          : 'rgba(200,184,154,0.25)',
                      }}
                    />
                  </div>
                  <span className="text-[10px] text-gray-600">{m.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Status Pipeline */}
          <div
            className="rounded-xl p-5"
            style={{
              backgroundColor: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            <h2 className="text-sm font-semibold text-[#F5F5F8] mb-5">Pipeline Breakdown</h2>
            <div className="space-y-3">
              <MiniBar label="New" value={stats.statusCounts.new} max={stats.total || 1} color="#C8B89A" />
              <MiniBar label="Building" value={stats.statusCounts.building} max={stats.total || 1} color="#9AADCC" />
              <MiniBar label="Ready" value={stats.statusCounts.ready} max={stats.total || 1} color="#9AC8A7" />
              <MiniBar label="Launched" value={stats.statusCounts.launched} max={stats.total || 1} color="#6B6560" />
            </div>
          </div>
        </div>

        {/* ─── Bottom Detail Row ─────────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Creative Type Mix */}
          <div
            className="rounded-xl p-5"
            style={{
              backgroundColor: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            <h2 className="text-sm font-semibold text-[#F5F5F8] mb-5">Creative Type Mix</h2>
            <div className="space-y-3">
              {Object.entries(stats.typeCounts)
                .sort((a, b) => b[1] - a[1])
                .map(([type, count]) => {
                  const typeColors: Record<string, string> = {
                    ugc: '#C8B89A',
                    static: '#9AADCC',
                    video: '#9AC8A7',
                    other: '#6B6560',
                  };
                  return (
                    <MiniBar
                      key={type}
                      label={type.charAt(0).toUpperCase() + type.slice(1)}
                      value={count}
                      max={maxType}
                      color={typeColors[type] || '#C8B89A'}
                    />
                  );
                })}
            </div>
          </div>

          {/* Per-Brand Volume (only show in "All Brands" view) */}
          {selectedBrandId === 'all' && (
            <div
              className="rounded-xl p-5"
              style={{
                backgroundColor: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(255,255,255,0.06)',
              }}
            >
              <h2 className="text-sm font-semibold text-[#F5F5F8] mb-5">Volume by Brand</h2>
              <div className="space-y-3">
                {Object.entries(stats.brandCounts)
                  .sort((a, b) => b[1] - a[1])
                  .map(([brand, count]) => (
                    <MiniBar
                      key={brand}
                      label={brand.length > 12 ? brand.slice(0, 12) + '…' : brand}
                      value={count}
                      max={maxBrand}
                      color="#C8B89A"
                    />
                  ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </Navbar>
  );
}
