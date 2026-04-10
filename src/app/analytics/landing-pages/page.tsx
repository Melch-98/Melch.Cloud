'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  Loader,
  TrendingUp,
  TrendingDown,
  ChevronDown,
  Search,
  RefreshCw,
  Globe,
} from 'lucide-react';
import Navbar from '@/components/Navbar';
import { createClient } from '@/lib/supabase';

interface Brand {
  id: string;
  name: string;
  slug: string;
}

interface LandingPage {
  page_path: string;
  page_name: string;
  conversions: number;
  revenue: number;
  aov: number;
  unique_customers: number;
  conversions_change: number | null;
  revenue_change: number | null;
  aov_change: number | null;
  prev_conversions: number;
  prev_revenue: number;
  prev_aov: number;
}

interface ApiResponse {
  pages: LandingPage[];
  period: {
    current: { start: string; end: string };
    previous: { start: string; end: string };
  };
  days: number;
  total_orders: number;
}

type SortField = 'conversions' | 'revenue' | 'aov' | 'unique_customers';

function ChangeIndicator({ value }: { value: number | null }) {
  if (value === null) return <span className="text-[10px] ml-1.5" style={{ color: '#555' }}>new</span>;
  if (value === 0) return <span className="text-[10px] ml-1.5" style={{ color: '#555' }}>&mdash;</span>;

  const isPositive = value > 0;
  const Icon = isPositive ? TrendingUp : TrendingDown;
  const color = isPositive ? '#10B981' : '#ef4444';

  return (
    <span className="inline-flex items-center gap-0.5 text-[10px] ml-1.5" style={{ color }}>
      <Icon size={10} />
      {Math.abs(value).toFixed(1)}%
    </span>
  );
}

export default function LandingPagesAnalytics() {
  const router = useRouter();
  const supabase = createClient();

  const [authToken, setAuthToken] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [userBrandId, setUserBrandId] = useState<string | null>(null);

  const [brands, setBrands] = useState<Brand[]>([]);
  const [selectedBrandId, setSelectedBrandId] = useState<string | null>(null);
  const [fetchingBrands, setFetchingBrands] = useState(false);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  const [days, setDays] = useState(7);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<SortField>('revenue');
  const [sortAsc, setSortAsc] = useState(false);
  const [showBrandDropdown, setShowBrandDropdown] = useState(false);

  // Init auth
  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push('/login'); return; }
      setAuthToken(session.access_token);
      const { data: profile } = await supabase
        .from('users_profile')
        .select('role, brand_id')
        .eq('id', session.user.id)
        .single();
      if (!profile || !['admin', 'strategist', 'founder'].includes(profile.role)) {
        router.push('/');
        return;
      }
      setUserRole(profile.role);
      setUserBrandId(profile.brand_id);
    };
    init();
  }, [router, supabase]);

  // Fetch brands
  useEffect(() => {
    if (!userRole) return;
    const fetchBrands = async () => {
      setFetchingBrands(true);
      try {
        let query = supabase.from('brands').select('id, name, slug').order('name');
        if (userRole === 'founder' && userBrandId) query = query.eq('id', userBrandId);
        const { data: allBrands } = await query;
        setBrands(allBrands || []);
        if (allBrands && allBrands.length > 0 && !selectedBrandId) {
          const saved = typeof window !== 'undefined' ? localStorage.getItem('melch_selected_brand') : null;
          const match = saved && allBrands.find((b: Brand) => b.id === saved);
          setSelectedBrandId(match ? saved : allBrands[0].id);
        }
      } finally {
        setFetchingBrands(false);
      }
    };
    fetchBrands();
  }, [userRole, supabase]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch data
  useEffect(() => {
    if (!authToken || !selectedBrandId) return;
    const fetchData = async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/landing-pages?brand_id=${selectedBrandId}&days=${days}`,
          { headers: { Authorization: `Bearer ${authToken}` } }
        );
        if (res.ok) setData(await res.json());
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [authToken, selectedBrandId, days]);

  // Sync
  const handleSync = async () => {
    if (!authToken || !selectedBrandId || syncing) return;
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch('/api/shopify-sync', {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand_id: selectedBrandId }),
      });
      const result = await res.json();
      if (result.success) {
        setSyncResult(`Synced ${result.orders_processed} orders`);
        const refetch = await fetch(
          `/api/landing-pages?brand_id=${selectedBrandId}&days=${days}`,
          { headers: { Authorization: `Bearer ${authToken}` } }
        );
        if (refetch.ok) setData(await refetch.json());
      } else {
        setSyncResult(`Failed: ${result.error}`);
      }
    } catch {
      setSyncResult('Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const filteredPages = useMemo(() => {
    return (data?.pages || [])
      .filter((p) =>
        searchQuery
          ? p.page_path.toLowerCase().includes(searchQuery.toLowerCase())
          : true
      )
      .sort((a, b) => {
        const aVal = a[sortField];
        const bVal = b[sortField];
        return sortAsc ? aVal - bVal : bVal - aVal;
      });
  }, [data, searchQuery, sortField, sortAsc]);

  const totals = useMemo(() => {
    return filteredPages.reduce(
      (acc, p) => ({
        conversions: acc.conversions + p.conversions,
        revenue: acc.revenue + p.revenue,
        prevConversions: acc.prevConversions + p.prev_conversions,
        prevRevenue: acc.prevRevenue + p.prev_revenue,
      }),
      { conversions: 0, revenue: 0, prevConversions: 0, prevRevenue: 0 }
    );
  }, [filteredPages]);

  const selectedBrand = brands.find((b) => b.id === selectedBrandId);
  const dayOptions = [7, 14, 30, 60, 90];

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortAsc(!sortAsc);
    else { setSortField(field); setSortAsc(false); }
  };

  return (
    <Navbar>
      <div className="flex flex-col h-screen" style={{ backgroundColor: '#0A0A0A' }}>
        {/* Header */}
        <div className="flex-shrink-0 px-5 md:px-7 pt-5 pb-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <span
                className="w-8 h-8 rounded-lg flex items-center justify-center"
                style={{
                  background: 'linear-gradient(135deg, rgba(200,184,154,0.12), rgba(200,184,154,0.04))',
                  border: '1px solid rgba(200,184,154,0.15)',
                  color: '#C8B89A',
                }}
              >
                <Globe size={15} />
              </span>
              <div>
                <h1 className="text-base md:text-lg font-extrabold tracking-tight" style={{ color: '#F5F5F8' }}>
                  Landing Page Performance
                </h1>
                <p className="text-[11px] mt-0.5" style={{ color: '#444' }}>
                  {selectedBrand ? selectedBrand.name : 'Select a brand'} — Conversions & revenue by landing page
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              {/* Sync */}
              <button
                onClick={handleSync}
                disabled={syncing}
                className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-semibold transition-all"
                style={{
                  background: syncing ? 'rgba(200,184,154,0.04)' : 'rgba(200,184,154,0.08)',
                  border: '1px solid rgba(200,184,154,0.12)',
                  color: syncing ? '#555' : '#C8B89A',
                  cursor: syncing ? 'wait' : 'pointer',
                }}
              >
                <RefreshCw size={11} className={syncing ? 'animate-spin' : ''} />
                {syncing ? 'Syncing...' : 'Sync'}
              </button>
              {syncResult && (
                <span className="text-[10px] font-semibold" style={{ color: syncResult.includes('Synced') ? '#10B981' : '#ef4444' }}>
                  {syncResult}
                </span>
              )}
              {loading && <Loader size={12} className="animate-spin" style={{ color: '#C8B89A' }} />}

              <div className="w-px h-6" style={{ background: 'rgba(255,255,255,0.06)' }} />

              {/* Brand selector */}
              <div className="relative">
                <button
                  onClick={() => setShowBrandDropdown(!showBrandDropdown)}
                  className="flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-semibold transition-all"
                  style={{
                    background: 'linear-gradient(135deg, rgba(200,184,154,0.06), rgba(200,184,154,0.02))',
                    border: '1px solid rgba(200,184,154,0.1)',
                    color: selectedBrand ? '#C8B89A' : '#999',
                  }}
                >
                  {selectedBrand?.name || (fetchingBrands ? 'Loading...' : 'Select Brand')}
                  <ChevronDown size={12} style={{ color: '#555' }} />
                </button>
                {showBrandDropdown && (
                  <div
                    className="absolute right-0 top-full mt-1 w-64 rounded-lg py-1 z-50 max-h-64 overflow-y-auto"
                    style={{ backgroundColor: '#111', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 12px 40px rgba(0,0,0,0.6)' }}
                  >
                    {brands.map((brand) => (
                      <button
                        key={brand.id}
                        onClick={() => {
                          setSelectedBrandId(brand.id);
                          localStorage.setItem('melch_selected_brand', brand.id);
                          setShowBrandDropdown(false);
                        }}
                        className="w-full flex items-center justify-between px-3 py-2 text-xs transition-colors"
                        style={{
                          color: brand.id === selectedBrandId ? '#C8B89A' : '#CCC',
                          backgroundColor: brand.id === selectedBrandId ? 'rgba(200,184,154,0.08)' : 'transparent',
                        }}
                      >
                        {brand.name}
                        {brand.id === selectedBrandId && <span style={{ color: '#C8B89A' }}>&#10003;</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Controls row */}
          <div className="flex items-center gap-3">
            {/* Period selector */}
            <div className="flex items-center rounded-lg overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
              {dayOptions.map((d) => (
                <button
                  key={d}
                  onClick={() => setDays(d)}
                  className="px-3 py-1.5 text-[11px] font-semibold transition-all"
                  style={{
                    background: days === d ? 'rgba(200,184,154,0.1)' : 'transparent',
                    color: days === d ? '#C8B89A' : '#555',
                  }}
                >
                  {d}d
                </button>
              ))}
            </div>

            {/* Search */}
            <div className="relative flex-1 max-w-xs">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: '#444' }} />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search path..."
                className="w-full pl-8 pr-3 py-1.5 rounded-lg text-[11px] focus:outline-none"
                style={{
                  backgroundColor: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.06)',
                  color: '#CCC',
                }}
              />
            </div>

            {/* Period label */}
            {data?.period && (
              <span className="text-[10px] ml-auto" style={{ color: '#333' }}>
                {data.period.current.start} → {data.period.current.end} vs prior {days}d
              </span>
            )}
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-y-auto px-5 md:px-7">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader size={20} className="animate-spin" style={{ color: '#C8B89A' }} />
            </div>
          ) : filteredPages.length === 0 ? (
            <div className="text-center py-20">
              <p className="text-sm mb-1" style={{ color: '#555' }}>No landing page data yet</p>
              <p className="text-[11px]" style={{ color: '#333' }}>
                Hit Sync to pull Shopify orders — landing pages with conversions will appear here.
              </p>
            </div>
          ) : (
            <table className="w-full">
              <thead className="sticky top-0" style={{ backgroundColor: '#0A0A0A' }}>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <th className="text-left py-3 px-2 text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#444' }}>
                    Page
                  </th>
                  {(['conversions', 'revenue', 'aov', 'unique_customers'] as SortField[]).map((field) => (
                    <th
                      key={field}
                      className="text-right py-3 px-2 text-[10px] font-semibold uppercase tracking-wider cursor-pointer transition-colors"
                      style={{ color: sortField === field ? '#C8B89A' : '#444' }}
                      onClick={() => handleSort(field)}
                    >
                      {field === 'unique_customers' ? 'Customers' : field === 'aov' ? 'AOV' : field}
                      {sortField === field && (
                        <span className="ml-0.5">{sortAsc ? '↑' : '↓'}</span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredPages.map((page, i) => (
                  <tr
                    key={page.page_path}
                    className="transition-colors"
                    style={{
                      borderBottom: '1px solid rgba(255,255,255,0.02)',
                      backgroundColor: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(200,184,154,0.03)')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)')}
                  >
                    <td className="py-2.5 px-2">
                      <span className="text-xs font-medium" style={{ color: '#E0E0E0' }}>
                        {page.page_path === '/' ? 'Homepage' : page.page_path}
                      </span>
                    </td>
                    <td className="text-right py-2.5 px-2">
                      <span className="text-xs font-semibold" style={{ color: '#E0E0E0' }}>
                        {page.conversions.toLocaleString()}
                      </span>
                      <ChangeIndicator value={page.conversions_change} />
                    </td>
                    <td className="text-right py-2.5 px-2">
                      <span className="text-xs font-semibold" style={{ color: '#E0E0E0' }}>
                        ${page.revenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </span>
                      <ChangeIndicator value={page.revenue_change} />
                    </td>
                    <td className="text-right py-2.5 px-2">
                      <span className="text-xs font-semibold" style={{ color: '#E0E0E0' }}>
                        ${page.aov.toFixed(2)}
                      </span>
                      <ChangeIndicator value={page.aov_change} />
                    </td>
                    <td className="text-right py-2.5 px-2">
                      <span className="text-xs font-semibold" style={{ color: '#E0E0E0' }}>
                        {page.unique_customers}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                  <td className="py-3 px-2 text-xs font-bold" style={{ color: '#C8B89A' }}>Total</td>
                  <td className="text-right py-3 px-2 text-xs font-bold" style={{ color: '#C8B89A' }}>
                    {totals.conversions.toLocaleString()}
                  </td>
                  <td className="text-right py-3 px-2 text-xs font-bold" style={{ color: '#C8B89A' }}>
                    ${totals.revenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </td>
                  <td className="text-right py-3 px-2 text-xs" style={{ color: '#333' }}>&mdash;</td>
                  <td className="text-right py-3 px-2 text-xs" style={{ color: '#333' }}>&mdash;</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>
    </Navbar>
  );
}
