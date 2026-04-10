'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Loader,
  TrendingUp,
  TrendingDown,
  ChevronDown,
  Search,
  RefreshCw,
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
  if (value === null) return <span className="text-xs text-gray-400 ml-1">new</span>;
  if (value === 0) return <span className="text-xs text-gray-400 ml-1">&mdash;</span>;

  const isPositive = value > 0;
  const Icon = isPositive ? TrendingUp : TrendingDown;
  const color = isPositive ? 'text-emerald-500' : 'text-red-500';

  return (
    <span className={`inline-flex items-center gap-0.5 text-xs ${color} ml-1.5`}>
      <Icon size={12} />
      {Math.abs(value).toFixed(1)}%
    </span>
  );
}

export default function LandingPagesAnalytics() {
  const router = useRouter();
  const supabase = createClient();

  // Auth state
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [userBrandId, setUserBrandId] = useState<string | null>(null);

  // Data state
  const [brands, setBrands] = useState<Brand[]>([]);
  const [selectedBrandId, setSelectedBrandId] = useState<string | null>(null);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  // Filters
  const [days, setDays] = useState(7);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<SortField>('revenue');
  const [sortAsc, setSortAsc] = useState(false);
  const [brandDropdownOpen, setBrandDropdownOpen] = useState(false);

  // Init auth
  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.push('/login');
        return;
      }
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
      let query = supabase.from('brands').select('id, name, slug').order('name');
      if (userRole === 'founder' && userBrandId) {
        query = query.eq('id', userBrandId);
      }
      const { data: allBrands } = await query;
      setBrands(allBrands || []);
      if (allBrands && allBrands.length > 0 && !selectedBrandId) {
        const saved = typeof window !== 'undefined' ? localStorage.getItem('melch_selected_brand') : null;
        const match = saved && allBrands.find((b: Brand) => b.id === saved);
        setSelectedBrandId(match ? saved : allBrands[0].id);
      }
    };
    fetchBrands();
  }, [userRole, supabase]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch landing page data
  useEffect(() => {
    if (!authToken || !selectedBrandId) return;
    const fetchData = async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/landing-pages?brand_id=${selectedBrandId}&days=${days}`,
          { headers: { Authorization: `Bearer ${authToken}` } }
        );
        if (res.ok) {
          const json = await res.json();
          setData(json);
        }
      } catch (err) {
        console.error('Landing pages fetch error:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [authToken, selectedBrandId, days]);

  // Sync (triggers shopify-sync POST which now also populates shopify_orders)
  const handleSync = async () => {
    if (!authToken || !selectedBrandId || syncing) return;
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch('/api/shopify-sync', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ brand_id: selectedBrandId }),
      });
      const result = await res.json();
      if (result.success) {
        setSyncResult(`Synced ${result.orders_processed} orders`);
        // Re-fetch landing page data
        const refetch = await fetch(
          `/api/landing-pages?brand_id=${selectedBrandId}&days=${days}`,
          { headers: { Authorization: `Bearer ${authToken}` } }
        );
        if (refetch.ok) setData(await refetch.json());
      } else {
        setSyncResult(`Sync failed: ${result.error}`);
      }
    } catch {
      setSyncResult('Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  // Filter + sort pages
  const filteredPages = (data?.pages || [])
    .filter((p) =>
      searchQuery
        ? p.page_path.toLowerCase().includes(searchQuery.toLowerCase()) ||
          p.page_name.toLowerCase().includes(searchQuery.toLowerCase())
        : true
    )
    .sort((a, b) => {
      const aVal = a[sortField];
      const bVal = b[sortField];
      return sortAsc ? aVal - bVal : bVal - aVal;
    });

  // Totals
  const totals = filteredPages.reduce(
    (acc, p) => ({
      conversions: acc.conversions + p.conversions,
      revenue: acc.revenue + p.revenue,
      prevConversions: acc.prevConversions + p.prev_conversions,
      prevRevenue: acc.prevRevenue + p.prev_revenue,
    }),
    { conversions: 0, revenue: 0, prevConversions: 0, prevRevenue: 0 }
  );

  const selectedBrand = brands.find((b) => b.id === selectedBrandId);
  const dayOptions = [7, 14, 30, 60, 90];

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(false);
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return null;
    return <span className="ml-1 text-xs">{sortAsc ? '↑' : '↓'}</span>;
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-semibold">Landing Page Performance</h1>
          <div className="flex items-center gap-3">
            {/* Sync button */}
            <button
              onClick={handleSync}
              disabled={syncing}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm transition-colors disabled:opacity-50"
            >
              <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
              {syncing ? 'Syncing...' : 'Sync'}
            </button>
            {syncResult && (
              <span className="text-xs text-gray-400">{syncResult}</span>
            )}
          </div>
        </div>

        {/* Controls row */}
        <div className="flex flex-wrap items-center gap-3 mb-6">
          {/* Brand selector */}
          <div className="relative">
            <button
              onClick={() => setBrandDropdownOpen(!brandDropdownOpen)}
              className="flex items-center gap-2 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm hover:bg-gray-750"
            >
              {selectedBrand?.name || 'Select brand'}
              <ChevronDown size={14} />
            </button>
            {brandDropdownOpen && (
              <div className="absolute z-50 mt-1 w-56 bg-gray-800 border border-gray-700 rounded-lg shadow-xl max-h-60 overflow-y-auto">
                {brands.map((b) => (
                  <button
                    key={b.id}
                    onClick={() => {
                      setSelectedBrandId(b.id);
                      setBrandDropdownOpen(false);
                      if (typeof window !== 'undefined') {
                        localStorage.setItem('melch_selected_brand', b.id);
                      }
                    }}
                    className={`block w-full text-left px-3 py-2 text-sm hover:bg-gray-700 ${
                      b.id === selectedBrandId ? 'text-blue-400' : 'text-gray-200'
                    }`}
                  >
                    {b.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Period selector */}
          <div className="flex items-center bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
            {dayOptions.map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`px-3 py-2 text-sm transition-colors ${
                  days === d
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-300 hover:bg-gray-700'
                }`}
              >
                {d}d
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="relative flex-1 max-w-xs">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search path..."
              className="w-full pl-9 pr-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>

        {/* Period label */}
        {data?.period && (
          <p className="text-xs text-gray-500 mb-4">
            {data.period.current.start} to {data.period.current.end} vs{' '}
            {data.period.previous.start} to {data.period.previous.end}
          </p>
        )}

        {/* Table */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader size={24} className="animate-spin text-gray-500" />
          </div>
        ) : filteredPages.length === 0 ? (
          <div className="text-center py-20 text-gray-500">
            <p className="text-lg mb-2">No landing page data yet</p>
            <p className="text-sm">
              Hit Sync to pull Shopify orders, then landing pages with conversions will appear here.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-800 text-xs text-gray-500 uppercase tracking-wider">
                  <th className="text-left py-3 px-3 font-medium">Page</th>
                  <th
                    className="text-right py-3 px-3 font-medium cursor-pointer hover:text-gray-300"
                    onClick={() => handleSort('conversions')}
                  >
                    Conversions <SortIcon field="conversions" />
                  </th>
                  <th
                    className="text-right py-3 px-3 font-medium cursor-pointer hover:text-gray-300"
                    onClick={() => handleSort('revenue')}
                  >
                    Revenue <SortIcon field="revenue" />
                  </th>
                  <th
                    className="text-right py-3 px-3 font-medium cursor-pointer hover:text-gray-300"
                    onClick={() => handleSort('aov')}
                  >
                    AOV <SortIcon field="aov" />
                  </th>
                  <th
                    className="text-right py-3 px-3 font-medium cursor-pointer hover:text-gray-300"
                    onClick={() => handleSort('unique_customers')}
                  >
                    Customers <SortIcon field="unique_customers" />
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredPages.map((page) => (
                  <tr
                    key={page.page_path}
                    className="border-b border-gray-800/50 hover:bg-gray-900/50 transition-colors"
                  >
                    <td className="py-3 px-3">
                      <div className="text-sm text-gray-200 font-medium">
                        {page.page_path === '/' ? 'Homepage' : page.page_path}
                      </div>
                    </td>
                    <td className="text-right py-3 px-3">
                      <span className="text-sm font-medium">{page.conversions.toLocaleString()}</span>
                      <ChangeIndicator value={page.conversions_change} />
                    </td>
                    <td className="text-right py-3 px-3">
                      <span className="text-sm font-medium">
                        ${page.revenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </span>
                      <ChangeIndicator value={page.revenue_change} />
                    </td>
                    <td className="text-right py-3 px-3">
                      <span className="text-sm font-medium">
                        ${page.aov.toFixed(2)}
                      </span>
                      <ChangeIndicator value={page.aov_change} />
                    </td>
                    <td className="text-right py-3 px-3">
                      <span className="text-sm font-medium">{page.unique_customers}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
              {/* Totals row */}
              <tfoot>
                <tr className="border-t border-gray-700 font-semibold">
                  <td className="py-3 px-3 text-sm text-gray-400">Total</td>
                  <td className="text-right py-3 px-3 text-sm">
                    {totals.conversions.toLocaleString()}
                  </td>
                  <td className="text-right py-3 px-3 text-sm">
                    ${totals.revenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </td>
                  <td className="text-right py-3 px-3 text-sm text-gray-500">—</td>
                  <td className="text-right py-3 px-3 text-sm text-gray-500">—</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
