'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Loader,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ChevronDown,
  RefreshCw,
  Search,
  AlertCircle,
  Type,
  MessageSquare,
  FileText,
  MousePointerClick,
  Filter,
  X,
  Copy,
  Hash,
  TrendingUp,
  DollarSign,
  Eye,
  ChevronRight,
  Download,
} from 'lucide-react';
import Navbar from '@/components/Navbar';
import DataFreshness, { friendlyError } from '@/components/DataFreshness';
import { createClient } from '@/lib/supabase';
import type { CopyInput } from '@/lib/meta-api';

// ─── Types ──────────────────────────────────────────────────────

type SortField = keyof CopyInput | 'text';
type SortDir = 'asc' | 'desc';
type CopyType = 'all' | 'headline' | 'body' | 'description' | 'cta';

interface MetricDef {
  key: keyof CopyInput;
  label: string;
  format: (v: number) => string;
}

// ─── Formatters ────────────────────────────────────────────────

const fmt = {
  currency: (v: number) =>
    v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v.toFixed(2)}`,
  currencyFull: (v: number) =>
    `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
  pct: (v: number) => `${v.toFixed(2)}%`,
  x: (v: number) => v.toFixed(2),
  num: (v: number) =>
    v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v)),
  numFull: (v: number) =>
    v.toLocaleString('en-US', { maximumFractionDigits: 0 }),
};

const METRICS: MetricDef[] = [
  { key: 'spend', label: 'Spend', format: fmt.currencyFull },
  { key: 'purchase_value', label: 'Revenue', format: fmt.currencyFull },
  { key: 'roas', label: 'ROAS', format: fmt.x },
  { key: 'cpa', label: 'CPA', format: fmt.currencyFull },
  { key: 'purchases', label: 'Purchases', format: fmt.numFull },
  { key: 'link_ctr', label: 'Link CTR', format: fmt.pct },
  { key: 'ctr', label: 'CTR', format: fmt.pct },
  { key: 'cpm', label: 'CPM', format: fmt.currencyFull },
  { key: 'cpc', label: 'CPC', format: fmt.currencyFull },
  { key: 'thumbstop_rate', label: 'Thumbstop', format: fmt.pct },
  { key: 'impressions', label: 'Impressions', format: fmt.numFull },
  { key: 'clicks', label: 'Clicks', format: fmt.numFull },
  { key: 'add_to_cart', label: 'ATC', format: fmt.numFull },
  { key: 'reach', label: 'Reach', format: fmt.numFull },
];

const DEFAULT_VISIBLE_METRICS: (keyof CopyInput)[] = [
  'spend', 'purchase_value', 'roas', 'link_ctr', 'ad_count',
];

// ─── Date Presets ──────────────────────────────────────────────

function dateStr(d: Date): string {
  return d.toISOString().split('T')[0];
}

function getDatePreset(preset: string): { from: string; to: string; label: string } {
  const now = new Date();
  const to = dateStr(now);
  switch (preset) {
    case '7d': {
      const d = new Date(now); d.setDate(d.getDate() - 7);
      return { from: dateStr(d), to, label: 'Last 7 days' };
    }
    case '14d': {
      const d = new Date(now); d.setDate(d.getDate() - 14);
      return { from: dateStr(d), to, label: 'Last 14 days' };
    }
    case '30d': {
      const d = new Date(now); d.setDate(d.getDate() - 30);
      return { from: dateStr(d), to, label: 'Last 30 days' };
    }
    case '60d': {
      const d = new Date(now); d.setDate(d.getDate() - 60);
      return { from: dateStr(d), to, label: 'Last 60 days' };
    }
    case '90d': {
      const d = new Date(now); d.setDate(d.getDate() - 90);
      return { from: dateStr(d), to, label: 'Last 90 days' };
    }
    default: {
      const d = new Date(now); d.setDate(d.getDate() - 30);
      return { from: dateStr(d), to, label: 'Last 30 days' };
    }
  }
}

const TYPE_CONFIG: Record<string, { icon: React.ElementType; label: string; color: string }> = {
  headline: { icon: Type, label: 'Headline', color: '#C8B89A' },
  body: { icon: MessageSquare, label: 'Primary Text', color: '#8B9DC3' },
  description: { icon: FileText, label: 'Description', color: '#A8C686' },
  cta: { icon: MousePointerClick, label: 'CTA', color: '#D4A5A5' },
};

// ─── Component ────────────────────────────────────────────────

export default function CopyAnalysisPage() {
  const router = useRouter();
  const supabase = createClient();

  // State
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inputs, setInputs] = useState<CopyInput[]>([]);
  const [accounts, setAccounts] = useState<{ id: string; name: string; brand_id?: string }[]>([]);
  const [selectedAccount, setSelectedAccount] = useState('');
  const [datePreset, setDatePreset] = useState('30d');
  const [sortField, setSortField] = useState<SortField>('spend');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<CopyType>('all');
  const [minSpend, setMinSpend] = useState(0);
  const [minAdCount, setMinAdCount] = useState(1);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [visibleMetrics, setVisibleMetrics] = useState<(keyof CopyInput)[]>(DEFAULT_VISIBLE_METRICS);
  const [showFilters, setShowFilters] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [isCached, setIsCached] = useState(false);

  // Auth check + fetch accounts
  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push('/'); return; }

      try {
        const res = await fetch('/api/meta-insights?action=accounts', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (res.ok) {
          const data = await res.json();
          const accts = data.accounts || [];
          setAccounts(accts);
          if (accts.length > 0) {
            const savedBrand = localStorage.getItem('melch_selected_brand');
            const match = savedBrand && accts.find((a: any) => a.brand_id === savedBrand);
            setSelectedAccount(match ? match.id : accts[0].id);
          }
        }
      } catch (e) {
        console.error('Failed to load accounts:', e);
      }
    };
    init();
  }, [router, supabase]);

  // Fetch copy data
  const fetchData = useCallback(async () => {
    if (!selectedAccount) return;
    setLoading(true);
    setError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const { from, to } = getDatePreset(datePreset);
      const res = await fetch(
        `/api/copy-analysis?account_id=${selectedAccount}&date_from=${from}&date_to=${to}&limit=100`,
        { headers: { Authorization: `Bearer ${session.access_token}` } }
      );

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to fetch');
      }

      const data = await res.json();
      setInputs(data.inputs || []);
      setCachedAt(data.cached_at || null);
      setIsCached(!!data.cached);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [selectedAccount, datePreset, supabase]);

  useEffect(() => {
    if (selectedAccount) fetchData();
  }, [selectedAccount, datePreset, fetchData]);

  // Filter + sort
  const filtered = useMemo(() => {
    let list = [...inputs];

    // Type filter
    if (typeFilter !== 'all') {
      list = list.filter((i) => i.type === typeFilter);
    }

    // Search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (i) =>
          i.text.toLowerCase().includes(q) ||
          i.ad_names.some((n) => n.toLowerCase().includes(q))
      );
    }

    // Min spend
    if (minSpend > 0) {
      list = list.filter((i) => i.spend >= minSpend);
    }

    // Min ad count (dedup filter)
    if (minAdCount > 1) {
      list = list.filter((i) => i.ad_count >= minAdCount);
    }

    // Sort
    list.sort((a, b) => {
      const aVal = sortField === 'text' ? a.text : (a as any)[sortField];
      const bVal = sortField === 'text' ? b.text : (b as any)[sortField];
      if (typeof aVal === 'string') {
        return sortDir === 'asc'
          ? aVal.localeCompare(bVal as string)
          : (bVal as string).localeCompare(aVal);
      }
      return sortDir === 'asc' ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
    });

    return list;
  }, [inputs, typeFilter, searchQuery, minSpend, minAdCount, sortField, sortDir]);

  // Summary stats
  const summary = useMemo(() => {
    const total = inputs.length;
    const headlines = inputs.filter((i) => i.type === 'headline').length;
    const bodies = inputs.filter((i) => i.type === 'body').length;
    const descriptions = inputs.filter((i) => i.type === 'description').length;
    const ctas = inputs.filter((i) => i.type === 'cta').length;
    const shared = inputs.filter((i) => i.ad_count > 1).length;
    return { total, headlines, bodies, descriptions, ctas, shared };
  }, [inputs]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown size={12} style={{ opacity: 0.3 }} />;
    return sortDir === 'asc' ? <ArrowUp size={12} style={{ color: '#C8B89A' }} /> : <ArrowDown size={12} style={{ color: '#C8B89A' }} />;
  };

  // Format CTA labels nicely
  const formatCTA = (text: string) =>
    text.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  const exportCSV = useCallback(() => {
    if (filtered.length === 0) return;
    const headers = ['Type','Text','Ad Count','Spend','Revenue','ROAS','CPA','Link CTR','CTR','CPM','Impressions'];
    const rows = filtered.map((inp) => [
      inp.type,
      `"${(inp.text || '').replace(/"/g, '""')}"`,
      inp.ad_count,
      inp.spend.toFixed(2),
      inp.purchase_value.toFixed(2),
      inp.roas.toFixed(2),
      inp.cpa.toFixed(2),
      inp.link_ctr.toFixed(2),
      inp.ctr.toFixed(2),
      inp.cpm.toFixed(2),
      inp.impressions,
    ].join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `copy-analysis-${datePreset}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [filtered, datePreset]);

  return (
    <Navbar>
      <div className="min-h-screen" style={{ backgroundColor: '#0A0A0A' }}>
        {/* Header */}
        <div
          className="sticky top-0 z-30"
          style={{
            backgroundColor: 'rgba(10,10,10,0.92)',
            backdropFilter: 'blur(16px)',
            borderBottom: '1px solid rgba(200,184,154,0.08)',
          }}
        >
          <div className="max-w-[1600px] mx-auto px-6 py-4">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              {/* Title */}
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{
                    background: 'linear-gradient(135deg, rgba(200,184,154,0.15), rgba(200,184,154,0.05))',
                    border: '1px solid rgba(200,184,154,0.2)',
                  }}
                >
                  <Type size={20} style={{ color: '#C8B89A' }} />
                </div>
                <div>
                  <h1 className="text-lg font-semibold" style={{ color: '#F5F5F8' }}>
                    Copy Analysis
                  </h1>
                  <p className="text-xs" style={{ color: '#666' }}>
                    Ad copy performance breakdown &bull; Deduplicated inputs
                  </p>
                </div>
              </div>

              {/* Controls */}
              <div className="flex items-center gap-3 flex-wrap">
                {/* Account selector */}
                <div className="relative">
                  <select
                    value={selectedAccount}
                    onChange={(e) => {
                      setSelectedAccount(e.target.value);
                      const acct = accounts.find(a => a.id === e.target.value);
                      if (acct?.brand_id) localStorage.setItem('melch_selected_brand', acct.brand_id);
                    }}
                    className="appearance-none text-sm rounded-lg pl-3 pr-8 py-2 cursor-pointer"
                    style={{
                      backgroundColor: 'rgba(255,255,255,0.04)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      color: '#F5F5F8',
                    }}
                  >
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id} style={{ backgroundColor: '#1a1a1a' }}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    size={14}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
                    style={{ color: '#666' }}
                  />
                </div>

                {/* Date preset */}
                <div className="relative">
                  <select
                    value={datePreset}
                    onChange={(e) => setDatePreset(e.target.value)}
                    className="appearance-none text-sm rounded-lg pl-3 pr-8 py-2 cursor-pointer"
                    style={{
                      backgroundColor: 'rgba(255,255,255,0.04)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      color: '#F5F5F8',
                    }}
                  >
                    <option value="7d" style={{ backgroundColor: '#1a1a1a' }}>Last 7 days</option>
                    <option value="14d" style={{ backgroundColor: '#1a1a1a' }}>Last 14 days</option>
                    <option value="30d" style={{ backgroundColor: '#1a1a1a' }}>Last 30 days</option>
                    <option value="60d" style={{ backgroundColor: '#1a1a1a' }}>Last 60 days</option>
                    <option value="90d" style={{ backgroundColor: '#1a1a1a' }}>Last 90 days</option>
                  </select>
                  <ChevronDown
                    size={14}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
                    style={{ color: '#666' }}
                  />
                </div>

                {/* Refresh */}
                <button
                  onClick={fetchData}
                  disabled={loading}
                  className="p-2 rounded-lg transition-colors"
                  style={{
                    backgroundColor: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    color: '#888',
                  }}
                >
                  <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                </button>

                {/* CSV Export */}
                <button
                  onClick={exportCSV}
                  disabled={filtered.length === 0}
                  className="p-2 rounded-lg transition-colors"
                  style={{ backgroundColor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#888' }}
                  title="Export CSV"
                >
                  <Download size={16} />
                </button>

                {/* Data Freshness */}
                <DataFreshness cachedAt={cachedAt} isCached={isCached} />
              </div>
            </div>
          </div>
        </div>

        <div className="max-w-[1600px] mx-auto px-6 py-6">
          {/* Summary Cards */}
          {inputs.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
              {[
                { label: 'Total Inputs', value: summary.total, icon: Hash, color: '#C8B89A' },
                { label: 'Headlines', value: summary.headlines, icon: Type, color: TYPE_CONFIG.headline.color },
                { label: 'Primary Text', value: summary.bodies, icon: MessageSquare, color: TYPE_CONFIG.body.color },
                { label: 'Descriptions', value: summary.descriptions, icon: FileText, color: TYPE_CONFIG.description.color },
                { label: 'CTAs', value: summary.ctas, icon: MousePointerClick, color: TYPE_CONFIG.cta.color },
                { label: 'Shared (2+ ads)', value: summary.shared, icon: Copy, color: '#9B8EC4' },
              ].map((card) => {
                const CardIcon = card.icon;
                return (
                  <div
                    key={card.label}
                    className="rounded-xl p-4"
                    style={{
                      backgroundColor: 'rgba(255,255,255,0.02)',
                      border: '1px solid rgba(255,255,255,0.06)',
                    }}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <CardIcon size={14} style={{ color: card.color }} />
                      <span className="text-[11px] uppercase tracking-wider font-medium" style={{ color: '#666' }}>
                        {card.label}
                      </span>
                    </div>
                    <div className="text-2xl font-bold" style={{ color: card.color }}>
                      {card.value}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Filters Bar */}
          <div
            className="rounded-xl p-4 mb-6"
            style={{
              backgroundColor: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            <div className="flex items-center gap-3 flex-wrap">
              {/* Type pills */}
              <div className="flex items-center gap-1.5">
                {(['all', 'headline', 'body', 'description', 'cta'] as CopyType[]).map((t) => {
                  const isActive = typeFilter === t;
                  const config = t === 'all' ? { label: 'All', color: '#C8B89A' } : TYPE_CONFIG[t];
                  return (
                    <button
                      key={t}
                      onClick={() => setTypeFilter(t)}
                      className="text-xs font-medium px-3 py-1.5 rounded-full transition-all"
                      style={{
                        backgroundColor: isActive ? `${config.color}18` : 'rgba(255,255,255,0.03)',
                        border: `1px solid ${isActive ? `${config.color}40` : 'rgba(255,255,255,0.06)'}`,
                        color: isActive ? config.color : '#666',
                      }}
                    >
                      {config.label}
                    </button>
                  );
                })}
              </div>

              {/* Search */}
              <div className="flex-1 min-w-[200px] relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: '#555' }} />
                <input
                  type="text"
                  placeholder="Search copy text or ad names..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full text-sm rounded-lg pl-9 pr-3 py-2"
                  style={{
                    backgroundColor: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.06)',
                    color: '#F5F5F8',
                    outline: 'none',
                  }}
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2"
                    style={{ color: '#555' }}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>

              {/* Advanced filters toggle */}
              <button
                onClick={() => setShowFilters(!showFilters)}
                className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg transition-colors"
                style={{
                  backgroundColor: showFilters ? 'rgba(200,184,154,0.1)' : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${showFilters ? 'rgba(200,184,154,0.2)' : 'rgba(255,255,255,0.06)'}`,
                  color: showFilters ? '#C8B89A' : '#888',
                }}
              >
                <Filter size={13} />
                Filters
              </button>
            </div>

            {/* Advanced Filters Panel */}
            {showFilters && (
              <div
                className="mt-4 pt-4 flex items-center gap-6 flex-wrap"
                style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
              >
                {/* Min Spend */}
                <div className="flex items-center gap-2">
                  <label className="text-xs font-medium" style={{ color: '#888' }}>
                    Min Spend
                  </label>
                  <div className="relative">
                    <DollarSign size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: '#555' }} />
                    <input
                      type="number"
                      value={minSpend || ''}
                      onChange={(e) => setMinSpend(Number(e.target.value) || 0)}
                      placeholder="0"
                      className="text-sm rounded-lg pl-7 pr-3 py-1.5 w-24"
                      style={{
                        backgroundColor: 'rgba(255,255,255,0.03)',
                        border: '1px solid rgba(255,255,255,0.06)',
                        color: '#F5F5F8',
                        outline: 'none',
                      }}
                    />
                  </div>
                </div>

                {/* Min Ad Count (dedup threshold) */}
                <div className="flex items-center gap-2">
                  <label className="text-xs font-medium" style={{ color: '#888' }}>
                    Min Ads Using
                  </label>
                  <div className="relative">
                    <Hash size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: '#555' }} />
                    <input
                      type="number"
                      value={minAdCount || ''}
                      onChange={(e) => setMinAdCount(Number(e.target.value) || 1)}
                      placeholder="1"
                      min={1}
                      className="text-sm rounded-lg pl-7 pr-3 py-1.5 w-20"
                      style={{
                        backgroundColor: 'rgba(255,255,255,0.03)',
                        border: '1px solid rgba(255,255,255,0.06)',
                        color: '#F5F5F8',
                        outline: 'none',
                      }}
                    />
                  </div>
                </div>

                {/* Column selector */}
                <div className="flex items-center gap-2">
                  <label className="text-xs font-medium" style={{ color: '#888' }}>
                    Columns
                  </label>
                  <div className="flex items-center gap-1 flex-wrap">
                    {METRICS.map((m) => {
                      const isVis = visibleMetrics.includes(m.key);
                      return (
                        <button
                          key={m.key}
                          onClick={() => {
                            if (isVis) {
                              setVisibleMetrics(visibleMetrics.filter((k) => k !== m.key));
                            } else {
                              setVisibleMetrics([...visibleMetrics, m.key]);
                            }
                          }}
                          className="text-[10px] px-2 py-1 rounded transition-colors"
                          style={{
                            backgroundColor: isVis ? 'rgba(200,184,154,0.12)' : 'rgba(255,255,255,0.03)',
                            border: `1px solid ${isVis ? 'rgba(200,184,154,0.25)' : 'rgba(255,255,255,0.06)'}`,
                            color: isVis ? '#C8B89A' : '#555',
                          }}
                        >
                          {m.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Loading state */}
          {loading && (
            <div className="flex items-center justify-center py-24">
              <div className="flex items-center gap-3">
                <Loader size={20} className="animate-spin" style={{ color: '#C8B89A' }} />
                <span className="text-sm" style={{ color: '#888' }}>Analyzing ad copy...</span>
              </div>
            </div>
          )}

          {/* Error state */}
          {error && !loading && (
            <div
              className="rounded-xl p-6 flex items-center gap-3"
              style={{
                backgroundColor: 'rgba(220,38,38,0.06)',
                border: '1px solid rgba(220,38,38,0.15)',
              }}
            >
              <AlertCircle size={18} style={{ color: '#dc2626' }} />
              <span className="text-sm" style={{ color: '#dc2626' }}>{friendlyError(error)}</span>
            </div>
          )}

          {/* Empty state */}
          {!loading && !error && inputs.length === 0 && selectedAccount && (
            <div className="flex flex-col items-center justify-center py-24">
              <Type size={48} style={{ color: '#333' }} />
              <p className="mt-4 text-sm" style={{ color: '#666' }}>
                No copy data found. Select an account and date range to begin.
              </p>
            </div>
          )}

          {/* Data Table */}
          {!loading && filtered.length > 0 && (
            <div
              className="rounded-xl overflow-hidden"
              style={{
                border: '1px solid rgba(255,255,255,0.06)',
              }}
            >
              {/* Table Header */}
              <div
                className="grid items-center gap-2 px-4 py-3 text-[11px] uppercase tracking-wider font-semibold"
                style={{
                  backgroundColor: 'rgba(255,255,255,0.02)',
                  borderBottom: '1px solid rgba(255,255,255,0.06)',
                  color: '#666',
                  gridTemplateColumns: `40px 60px 1fr ${visibleMetrics.map(() => '100px').join(' ')}`,
                }}
              >
                <div></div>
                <div>Type</div>
                <button
                  onClick={() => handleSort('text')}
                  className="flex items-center gap-1 cursor-pointer hover:opacity-80 text-left"
                >
                  Copy Text <SortIcon field="text" />
                </button>
                {visibleMetrics.map((key) => {
                  if (key === 'ad_count') {
                    return (
                      <button
                        key="ad_count"
                        onClick={() => handleSort('ad_count')}
                        className="flex items-center gap-1 cursor-pointer hover:opacity-80 text-right justify-end"
                      >
                        Ads <SortIcon field="ad_count" />
                      </button>
                    );
                  }
                  const metric = METRICS.find((m) => m.key === key);
                  if (!metric) return null;
                  return (
                    <button
                      key={key}
                      onClick={() => handleSort(key)}
                      className="flex items-center gap-1 cursor-pointer hover:opacity-80 text-right justify-end"
                    >
                      {metric.label} <SortIcon field={key} />
                    </button>
                  );
                })}
              </div>

              {/* Rows */}
              <div>
                {filtered.map((input, idx) => {
                  const config = TYPE_CONFIG[input.type] || TYPE_CONFIG.headline;
                  const TypeIcon = config.icon;
                  const isExpanded = expandedRow === `${input.type}::${input.text}`;
                  const rowKey = `${input.type}::${input.text}`;

                  // Determine if this is a "winner" (top ROAS in its type)
                  const isWinner = idx === 0 && input.roas > 1;

                  return (
                    <div key={rowKey}>
                      <div
                        className="grid items-center gap-2 px-4 py-3 transition-colors cursor-pointer group"
                        style={{
                          gridTemplateColumns: `40px 60px 1fr ${visibleMetrics.map(() => '100px').join(' ')}`,
                          backgroundColor: isExpanded
                            ? 'rgba(200,184,154,0.04)'
                            : idx % 2 === 0
                            ? 'rgba(255,255,255,0.01)'
                            : 'transparent',
                          borderBottom: '1px solid rgba(255,255,255,0.03)',
                          borderLeft: isWinner ? '2px solid rgba(200,184,154,0.4)' : '2px solid transparent',
                        }}
                        onClick={() => setExpandedRow(isExpanded ? null : rowKey)}
                      >
                        {/* Expand arrow */}
                        <div className="flex items-center justify-center">
                          <ChevronRight
                            size={14}
                            className="transition-transform duration-200"
                            style={{
                              color: '#555',
                              transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                            }}
                          />
                        </div>

                        {/* Type badge */}
                        <div>
                          <div
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full"
                            style={{
                              backgroundColor: `${config.color}12`,
                              border: `1px solid ${config.color}25`,
                            }}
                          >
                            <TypeIcon size={10} style={{ color: config.color }} />
                            <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: config.color }}>
                              {input.type === 'cta' ? 'CTA' : input.type.slice(0, 4)}
                            </span>
                          </div>
                        </div>

                        {/* Copy text */}
                        <div className="min-w-0 pr-4">
                          <p
                            className="text-sm truncate"
                            style={{ color: '#E5E5E8' }}
                            title={input.type === 'cta' ? formatCTA(input.text) : input.text}
                          >
                            {input.type === 'cta' ? formatCTA(input.text) : input.text}
                          </p>
                        </div>

                        {/* Metric values */}
                        {visibleMetrics.map((key) => {
                          if (key === 'ad_count') {
                            return (
                              <div key="ad_count" className="text-right">
                                <span
                                  className="text-sm font-medium"
                                  style={{
                                    color: input.ad_count > 1 ? '#9B8EC4' : '#555',
                                  }}
                                >
                                  {input.ad_count}
                                  {input.ad_count > 1 && (
                                    <span className="text-[10px] ml-1" style={{ color: '#666' }}>ads</span>
                                  )}
                                </span>
                              </div>
                            );
                          }
                          const metric = METRICS.find((m) => m.key === key);
                          if (!metric) return null;
                          const val = (input as any)[key] as number;

                          // Color coding for key metrics
                          let valColor = '#CCC';
                          if (key === 'roas') {
                            valColor = val >= 3 ? '#4ade80' : val >= 1.5 ? '#C8B89A' : val >= 1 ? '#fbbf24' : '#f87171';
                          } else if (key === 'spend' || key === 'purchase_value') {
                            valColor = '#C8B89A';
                          }

                          return (
                            <div key={key} className="text-right">
                              <span className="text-sm font-medium tabular-nums" style={{ color: valColor }}>
                                {metric.format(val)}
                              </span>
                            </div>
                          );
                        })}
                      </div>

                      {/* Expanded detail panel */}
                      {isExpanded && (
                        <div
                          className="px-6 py-5"
                          style={{
                            backgroundColor: 'rgba(200,184,154,0.02)',
                            borderBottom: '1px solid rgba(200,184,154,0.08)',
                          }}
                        >
                          {/* Full text */}
                          <div className="mb-5">
                            <h4 className="text-[11px] uppercase tracking-wider font-semibold mb-2" style={{ color: '#C8B89A' }}>
                              Full Copy Text
                            </h4>
                            <div
                              className="rounded-lg p-4 text-sm leading-relaxed"
                              style={{
                                backgroundColor: 'rgba(0,0,0,0.3)',
                                border: '1px solid rgba(255,255,255,0.06)',
                                color: '#DDD',
                                whiteSpace: 'pre-wrap',
                              }}
                            >
                              {input.type === 'cta' ? formatCTA(input.text) : input.text}
                            </div>
                          </div>

                          {/* All metrics */}
                          <div className="mb-5">
                            <h4 className="text-[11px] uppercase tracking-wider font-semibold mb-3" style={{ color: '#C8B89A' }}>
                              Aggregated Performance
                            </h4>
                            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
                              {METRICS.map((m) => {
                                const val = (input as any)[m.key] as number;
                                let valColor = '#CCC';
                                if (m.key === 'roas') {
                                  valColor = val >= 3 ? '#4ade80' : val >= 1.5 ? '#C8B89A' : val >= 1 ? '#fbbf24' : '#f87171';
                                }
                                return (
                                  <div
                                    key={m.key}
                                    className="rounded-lg p-3"
                                    style={{
                                      backgroundColor: 'rgba(255,255,255,0.02)',
                                      border: '1px solid rgba(255,255,255,0.05)',
                                    }}
                                  >
                                    <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: '#666' }}>
                                      {m.label}
                                    </div>
                                    <div className="text-sm font-bold tabular-nums" style={{ color: valColor }}>
                                      {m.format(val)}
                                    </div>
                                  </div>
                                );
                              })}
                              {/* Ad count */}
                              <div
                                className="rounded-lg p-3"
                                style={{
                                  backgroundColor: 'rgba(255,255,255,0.02)',
                                  border: '1px solid rgba(255,255,255,0.05)',
                                }}
                              >
                                <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: '#666' }}>
                                  Ads Using
                                </div>
                                <div className="text-sm font-bold tabular-nums" style={{ color: '#9B8EC4' }}>
                                  {input.ad_count}
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Ads using this copy */}
                          <div>
                            <h4 className="text-[11px] uppercase tracking-wider font-semibold mb-2" style={{ color: '#C8B89A' }}>
                              Ads Using This Copy ({input.ad_count})
                            </h4>
                            <div className="flex flex-wrap gap-2">
                              {input.ad_names.map((name, i) => (
                                <div
                                  key={i}
                                  className="text-xs px-3 py-1.5 rounded-lg"
                                  style={{
                                    backgroundColor: 'rgba(255,255,255,0.03)',
                                    border: '1px solid rgba(255,255,255,0.06)',
                                    color: '#AAA',
                                  }}
                                >
                                  {name || input.ad_ids[i]}
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Footer */}
              <div
                className="px-4 py-3 flex items-center justify-between"
                style={{
                  backgroundColor: 'rgba(255,255,255,0.02)',
                  borderTop: '1px solid rgba(255,255,255,0.06)',
                }}
              >
                <span className="text-xs" style={{ color: '#666' }}>
                  {filtered.length} of {inputs.length} inputs
                  {typeFilter !== 'all' && ` (${typeFilter})`}
                </span>
                <span className="text-xs" style={{ color: '#555' }}>
                  Sorted by {sortField} {sortDir === 'desc' ? '↓' : '↑'}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </Navbar>
  );
}
