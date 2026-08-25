'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  Loader,
  ChevronDown,
  Check,
  RefreshCw,
  DollarSign,
  TrendingUp,
  Globe,
  ShoppingCart,
  X,
  AlertTriangle,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts';
import Navbar from '@/components/Navbar';
import { createClient } from '@/lib/supabase';

// ─── Brand Palette ──────────────────────────────────────────────
const GOLD = '#C8B89A';
const GOLD_DIM = 'rgba(200,184,154,0.08)';
const RED = '#EF4444';
const GREEN = '#22C55E';

// ─── Types ──────────────────────────────────────────────────────

interface Brand {
  id: string;
  name: string;
  slug: string;
}

interface CountryRow {
  country: string;
  country_name: string;
  meta_spend: number;
  meta_currency: string;
  shopify_revenue: number;
  shopify_currency: string;
  orders: number;
  normalized_spend: number;
  normalized_revenue: number;
  normalized_roas: number;
  base_currency: string;
}

interface Totals {
  normalized_spend: number;
  normalized_revenue: number;
  normalized_roas: number;
  total_orders: number;
  base_currency: string;
}

type DateRange = 'last_7d' | 'last_14d' | 'last_30d' | 'last_90d' | 'this_month' | 'last_month';

const DATE_RANGES: { value: DateRange; label: string }[] = [
  { value: 'last_7d', label: 'Last 7 Days' },
  { value: 'last_14d', label: 'Last 14 Days' },
  { value: 'last_30d', label: 'Last 30 Days' },
  { value: 'last_90d', label: 'Last 90 Days' },
  { value: 'this_month', label: 'This Month' },
  { value: 'last_month', label: 'Last Month' },
];

// ─── Country Flags (emoji) ──────────────────────────────────────

const COUNTRY_FLAGS: Record<string, string> = {
  US: '🇺🇸', CA: '🇨🇦', GB: '🇬🇧', AU: '🇦🇺', NZ: '🇳🇿',
  DE: '🇩🇪', FR: '🇫🇷', IT: '🇮🇹', ES: '🇪🇸', NL: '🇳🇱',
  BE: '🇧🇪', AT: '🇦🇹', CH: '🇨🇭', SE: '🇸🇪', NO: '🇳🇴',
  DK: '🇩🇰', FI: '🇫🇮', IE: '🇮🇪', PT: '🇵🇹', JP: '🇯🇵',
  KR: '🇰🇷', MX: '🇲🇽', BR: '🇧🇷', IN: '🇮🇳', SG: '🇸🇬',
  HK: '🇭🇰', AE: '🇦🇪', CN: '🇨🇳',
};

function countryFlag(code: string): string {
  return COUNTRY_FLAGS[code.toUpperCase()] || '🌐';
}

// ─── Date Helpers ───────────────────────────────────────────────

function getDateRange(range: DateRange): { from: string; to: string } {
  const now = new Date();
  const toDate = now.toISOString().split('T')[0];
  let fromDate: Date;

  switch (range) {
    case 'last_7d':
      fromDate = new Date(now);
      fromDate.setDate(now.getDate() - 7);
      break;
    case 'last_14d':
      fromDate = new Date(now);
      fromDate.setDate(now.getDate() - 14);
      break;
    case 'last_30d':
      fromDate = new Date(now);
      fromDate.setDate(now.getDate() - 30);
      break;
    case 'last_90d':
      fromDate = new Date(now);
      fromDate.setDate(now.getDate() - 90);
      break;
    case 'this_month':
      fromDate = new Date(now.getFullYear(), now.getMonth(), 1);
      break;
    case 'last_month':
      fromDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastDay = new Date(now.getFullYear(), now.getMonth(), 0);
      return { from: fromDate.toISOString().split('T')[0], to: lastDay.toISOString().split('T')[0] };
    default:
      fromDate = new Date(now);
      fromDate.setDate(now.getDate() - 30);
  }
  return { from: fromDate.toISOString().split('T')[0], to: toDate };
}

// ─── Formatters ─────────────────────────────────────────────────

const fmtCurrency = (n: number, symbol = '$') => {
  if (Math.abs(n) >= 1000000) return `${symbol}${(n / 1000000).toFixed(2)}M`;
  if (Math.abs(n) >= 10000) return `${symbol}${(n / 1000).toFixed(1)}K`;
  return `${symbol}${n.toFixed(2)}`;
};
const fmtCompact = (n: number, symbol = '$') => {
  if (Math.abs(n) >= 1000000) return `${symbol}${(n / 1000000).toFixed(1)}M`;
  if (Math.abs(n) >= 1000) return `${symbol}${(n / 1000).toFixed(1)}K`;
  return `${symbol}${n.toFixed(0)}`;
};
const fmtNum = (n: number) => n.toLocaleString();
const fmtRoas = (n: number) => `${n.toFixed(2)}x`;

// ─── Currency symbol helper ─────────────────────────────────────

function currencySymbol(code: string): string {
  const s: Record<string, string> = {
    USD: '$', CAD: 'C$', GBP: '£', EUR: '€', AUD: 'A$', NZD: 'NZ$',
    CHF: 'CHF', SEK: 'kr', NOK: 'kr', DKK: 'kr', JPY: '¥',
  };
  return s[code] || code;
}

// ─── Main Page Component ────────────────────────────────────────

export default function GeoPerformancePage() {
  const router = useRouter();
  const supabase = createClient();

  const [brands, setBrands] = useState<Brand[]>([]);
  const [selectedBrandId, setSelectedBrandId] = useState<string>('');
  const [dateRange, setDateRange] = useState<DateRange>('last_30d');
  const [baseCurrency, setBaseCurrency] = useState('USD');

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<CountryRow[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [authToken, setAuthToken] = useState<string>('');
  const [profile, setProfile] = useState<{ role: string; brand_id: string } | null>(null);

  // Brand dropdown state
  const [brandDropdownOpen, setBrandDropdownOpen] = useState(false);
  const [dateDropdownOpen, setDateDropdownOpen] = useState(false);

  // ── Init: auth & brands ──

  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push('/'); return; }
      setAuthToken(session.access_token);

      const { data: prof } = await supabase
        .from('users_profile')
        .select('role, brand_id')
        .eq('id', session.user.id)
        .single();
      if (prof) setProfile(prof);

      const { data: brandList } = await supabase
        .from('brands')
        .select('id, name, slug')
        .is('archived_at', null)
        .order('name');

      if (brandList) {
        setBrands(brandList);
        // Default: strategists/founders auto-select their brand
        const saved = localStorage.getItem('melch_selected_brand_geo');
        if (saved && brandList.find((b: any) => b.id === saved)) {
          setSelectedBrandId(saved);
        } else if (prof?.brand_id && brandList.find((b: any) => b.id === prof.brand_id)) {
          setSelectedBrandId(prof.brand_id);
        } else if (brandList.length > 0) {
          setSelectedBrandId(brandList[0].id);
        }
      }
    };
    init();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fetch data ──

  const fetchData = async () => {
    if (!selectedBrandId || !authToken) return;
    setLoading(true);
    setErrors([]);
    setData([]);
    setTotals(null);

    const { from, to } = getDateRange(dateRange);

    try {
      const res = await fetch(
        `/api/geo-performance?brandId=${selectedBrandId}&dateFrom=${from}&dateTo=${to}&baseCurrency=${baseCurrency}`,
        { headers: { Authorization: `Bearer ${authToken}` } }
      );
      const json = await res.json();
      if (!res.ok) {
        setErrors([json.error || 'Failed to fetch data']);
        return;
      }
      setData(json.rows || []);
      setTotals(json.totals || null);
      if (json.errors?.length) setErrors(json.errors);
    } catch (e: any) {
      setErrors([e.message || 'Network error']);
    } finally {
      setLoading(false);
    }
  };

  // Fetch on brand/date/currency change
  useEffect(() => {
    if (selectedBrandId && authToken) fetchData();
  }, [selectedBrandId, dateRange, baseCurrency, authToken]); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist brand selection
  useEffect(() => {
    if (selectedBrandId) localStorage.setItem('melch_selected_brand_geo', selectedBrandId);
  }, [selectedBrandId]);

  // ── Chart data: top 10 countries by spend ──

  const chartData = useMemo(() => {
    return data.slice(0, 10).map((r) => ({
      country: r.country,
      name: r.country_name,
      spend: r.normalized_spend,
      revenue: r.normalized_revenue,
    }));
  }, [data]);

  const selectedBrand = brands.find((b) => b.id === selectedBrandId);
  const selectedDateLabel = DATE_RANGES.find((d) => d.value === dateRange)?.label || '';
  const symbols = baseCurrency;

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#0A0A0A' }}>
      <Navbar>
        <div className="p-6 max-w-7xl mx-auto">
          {/* ── Header ── */}
          <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
            <div>
              <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                <Globe size={24} style={{ color: GOLD }} />
                Geo Performance
              </h1>
              <p className="text-sm text-gray-400 mt-1">
                Meta spend vs Shopify revenue by country, normalized to {baseCurrency}
              </p>
            </div>
            <button
              onClick={fetchData}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all"
              style={{
                backgroundColor: GOLD_DIM,
                color: GOLD,
                border: '1px solid rgba(200,184,154,0.2)',
              }}
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>

          {/* ── Controls Row ── */}
          <div className="flex flex-wrap items-center gap-3 mb-6">
            {/* Brand Selector */}
            <div className="relative">
              <button
                onClick={() => { setBrandDropdownOpen(!brandDropdownOpen); setDateDropdownOpen(false); }}
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all"
                style={{
                  backgroundColor: '#111111',
                  border: '1px solid rgba(255,255,255,0.08)',
                  color: '#F5F5F8',
                }}
              >
                {selectedBrand?.name || 'Select Brand'}
                <ChevronDown size={14} className={brandDropdownOpen ? 'rotate-180 transition-transform' : 'transition-transform'} />
              </button>
              {brandDropdownOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setBrandDropdownOpen(false)} />
                  <div
                    className="absolute top-full left-0 mt-1 w-56 rounded-lg z-20 py-1 max-h-64 overflow-y-auto"
                    style={{
                      backgroundColor: '#111111',
                      border: '1px solid rgba(255,255,255,0.08)',
                      boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
                    }}
                  >
                    {brands.map((b) => (
                      <button
                        key={b.id}
                        onClick={() => { setSelectedBrandId(b.id); setBrandDropdownOpen(false); }}
                        className="w-full flex items-center gap-2 px-4 py-2 text-sm transition-colors text-left"
                        style={{
                          color: b.id === selectedBrandId ? GOLD : '#888',
                          backgroundColor: b.id === selectedBrandId ? GOLD_DIM : 'transparent',
                        }}
                      >
                        {b.id === selectedBrandId && <Check size={14} style={{ color: GOLD }} />}
                        <span className={b.id === selectedBrandId ? '' : 'ml-[22px]'}>{b.name}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Date Range Selector */}
            <div className="relative">
              <button
                onClick={() => { setDateDropdownOpen(!dateDropdownOpen); setBrandDropdownOpen(false); }}
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all"
                style={{
                  backgroundColor: '#111111',
                  border: '1px solid rgba(255,255,255,0.08)',
                  color: '#F5F5F8',
                }}
              >
                {selectedDateLabel}
                <ChevronDown size={14} className={dateDropdownOpen ? 'rotate-180 transition-transform' : 'transition-transform'} />
              </button>
              {dateDropdownOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setDateDropdownOpen(false)} />
                  <div
                    className="absolute top-full left-0 mt-1 w-48 rounded-lg z-20 py-1"
                    style={{
                      backgroundColor: '#111111',
                      border: '1px solid rgba(255,255,255,0.08)',
                      boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
                    }}
                  >
                    {DATE_RANGES.map((d) => (
                      <button
                        key={d.value}
                        onClick={() => { setDateRange(d.value); setDateDropdownOpen(false); }}
                        className="w-full flex items-center gap-2 px-4 py-2 text-sm transition-colors text-left"
                        style={{
                          color: d.value === dateRange ? GOLD : '#888',
                          backgroundColor: d.value === dateRange ? GOLD_DIM : 'transparent',
                        }}
                      >
                        {d.value === dateRange && <Check size={14} style={{ color: GOLD }} />}
                        <span className={d.value === dateRange ? '' : 'ml-[22px]'}>{d.label}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Loading indicator */}
            {loading && <Loader size={18} className="animate-spin text-gray-500" />}
          </div>

          {/* ── Errors ── */}
          {errors.length > 0 && (
            <div
              className="mb-6 p-4 rounded-lg flex items-start gap-3"
              style={{ backgroundColor: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}
            >
              <AlertTriangle size={16} style={{ color: RED, flexShrink: 0, marginTop: 1 }} />
              <div className="text-sm" style={{ color: '#FCA5A5' }}>
                {errors.map((e, i) => <div key={i}>{e}</div>)}
              </div>
            </div>
          )}

          {/* ── Summary Cards ── */}
          {totals && !loading && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
              <SummaryCard
                label="Total Spend"
                value={fmtCompact(totals.normalized_spend, currencySymbol(baseCurrency))}
                sub={`${data.length} countries`}
                icon={<DollarSign size={18} />}
                color={GOLD}
              />
              <SummaryCard
                label="Total Revenue"
                value={fmtCompact(totals.normalized_revenue, currencySymbol(baseCurrency))}
                sub={`${fmtNum(totals.total_orders)} orders`}
                icon={<ShoppingCart size={18} />}
                color="#60A5FA"
              />
              <SummaryCard
                label="Blended ROAS"
                value={fmtRoas(totals.normalized_roas)}
                sub={totals.normalized_roas >= (totals.normalized_roas > 2 ? 2 : totals.normalized_roas) ? 'Profitable' : 'Below target'}
                icon={<TrendingUp size={18} />}
                color={totals.normalized_roas >= 1 ? GREEN : RED}
              />
              <SummaryCard
                label="Top Country"
                value={data.length > 0 ? `${countryFlag(data[0].country)} ${data[0].country_name}` : '—'}
                sub={data.length > 0 ? `${fmtRoas(data[0].normalized_roas)} ROAS` : ''}
                icon={<Globe size={18} />}
                color="#A78BFA"
              />
            </div>
          )}

          {/* ── Loading State ── */}
          {loading && (
            <div className="flex items-center justify-center py-20">
              <Loader size={32} className="animate-spin" style={{ color: GOLD }} />
              <span className="ml-3 text-gray-400">Loading country data...</span>
            </div>
          )}

          {/* ── Empty State ── */}
          {!loading && !totals && errors.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-gray-500">
              <Globe size={48} className="mb-4 opacity-30" />
              <p>Select a brand to view geo performance data</p>
            </div>
          )}

          {/* ── Chart ── */}
          {!loading && chartData.length > 0 && (
            <div
              className="rounded-xl p-5 mb-8"
              style={{ backgroundColor: '#111111', border: '1px solid rgba(255,255,255,0.06)' }}
            >
              <h3 className="text-sm font-semibold text-gray-300 mb-4">Top Countries — Spend vs Revenue ({baseCurrency})</h3>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                  <XAxis
                    dataKey="country"
                    tick={{ fill: '#666', fontSize: 12 }}
                    axisLine={{ stroke: 'rgba(255,255,255,0.06)' }}
                  />
                  <YAxis
                    tick={{ fill: '#666', fontSize: 12 }}
                    axisLine={{ stroke: 'rgba(255,255,255,0.06)' }}
                    tickFormatter={(v: number) => fmtCompact(v, currencySymbol(baseCurrency))}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#1a1a1a',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '8px',
                      fontSize: '13px',
                    }}
                    formatter={(value: any, name: any) => [
                      fmtCurrency(Number(value), currencySymbol(baseCurrency)),
                      String(name),
                    ]}
                  />
                  <Bar dataKey="spend" name="Spend" fill={GOLD} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="revenue" name="Revenue" fill="#60A5FA" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* ── Country Table ── */}
          {!loading && data.length > 0 && (
            <div
              className="rounded-xl overflow-hidden"
              style={{ backgroundColor: '#111111', border: '1px solid rgba(255,255,255,0.06)' }}
            >
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                      <th className="text-left py-3 px-4 text-xs font-medium text-gray-500 uppercase tracking-wider">Country</th>
                      <th className="text-right py-3 px-4 text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Spend ({baseCurrency})
                      </th>
                      <th className="text-right py-3 px-4 text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Revenue ({baseCurrency})
                      </th>
                      <th className="text-right py-3 px-4 text-xs font-medium text-gray-500 uppercase tracking-wider">ROAS</th>
                      <th className="text-right py-3 px-4 text-xs font-medium text-gray-500 uppercase tracking-wider">Orders</th>
                      <th className="text-right py-3 px-4 text-xs font-medium text-gray-500 uppercase tracking-wider">AOV</th>
                      {/* Spend bar */}
                      <th className="py-3 px-4" style={{ width: '120px' }} />
                    </tr>
                  </thead>
                  <tbody>
                    {data.map((row, i) => {
                      const maxSpend = data[0]?.normalized_spend || 1;
                      const barWidth = maxSpend > 0 ? (row.normalized_spend / maxSpend) * 100 : 0;
                      const aov = row.orders > 0 ? row.normalized_revenue / row.orders : 0;

                      return (
                        <tr
                          key={row.country}
                          style={{ borderBottom: i < data.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none' }}
                          className="hover:bg-white/[0.02] transition-colors"
                        >
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2">
                              <span className="text-lg">{countryFlag(row.country)}</span>
                              <span className="text-[#F5F5F8] font-medium">{row.country_name || row.country}</span>
                              {row.meta_currency !== row.shopify_currency && (
                                <span className="text-[9px] px-1.5 py-0.5 rounded text-gray-500" style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}>
                                  {row.meta_currency}/{row.shopify_currency}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-3 px-4 text-right font-mono text-[#F5F5F8]">
                            {fmtCurrency(row.normalized_spend, currencySymbol(baseCurrency))}
                          </td>
                          <td className="py-3 px-4 text-right font-mono text-[#F5F5F8]">
                            {fmtCurrency(row.normalized_revenue, currencySymbol(baseCurrency))}
                          </td>
                          <td className="py-3 px-4 text-right font-mono">
                            <span style={{ color: row.normalized_roas >= 1 ? GREEN : RED }}>
                              {fmtRoas(row.normalized_roas)}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right font-mono text-gray-400">
                            {fmtNum(row.orders)}
                          </td>
                          <td className="py-3 px-4 text-right font-mono text-gray-400">
                            {fmtCurrency(aov, currencySymbol(baseCurrency))}
                          </td>
                          <td className="py-3 px-4">
                            <div className="w-full h-1.5 rounded-full" style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}>
                              <div
                                className="h-full rounded-full transition-all"
                                style={{
                                  width: `${barWidth}%`,
                                  backgroundColor: row.normalized_roas >= 1 ? GOLD : RED,
                                  minWidth: barWidth > 0 ? '4px' : 0,
                                }}
                              />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  {/* Totals row */}
                  {totals && (
                    <tfoot>
                      <tr style={{ borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                        <td className="py-3 px-4 font-semibold text-[#F5F5F8]">Totals</td>
                        <td className="py-3 px-4 text-right font-mono font-semibold" style={{ color: GOLD }}>
                          {fmtCurrency(totals.normalized_spend, currencySymbol(baseCurrency))}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-semibold text-[#60A5FA]">
                          {fmtCurrency(totals.normalized_revenue, currencySymbol(baseCurrency))}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-semibold">
                          <span style={{ color: totals.normalized_roas >= 1 ? GREEN : RED }}>
                            {fmtRoas(totals.normalized_roas)}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-semibold text-gray-300">
                          {fmtNum(totals.total_orders)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-semibold text-gray-300">
                          {fmtCurrency(
                            totals.total_orders > 0 ? totals.normalized_revenue / totals.total_orders : 0,
                            currencySymbol(baseCurrency)
                          )}
                        </td>
                        <td className="py-3 px-4" />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          )}
        </div>
      </Navbar>
    </div>
  );
}

// ─── Summary Card ───────────────────────────────────────────────

function SummaryCard({
  label,
  value,
  sub,
  icon,
  color,
}: {
  label: string;
  value: string;
  sub: string;
  icon: React.ReactNode;
  color: string;
}) {
  return (
    <div
      className="rounded-xl p-4"
      style={{ backgroundColor: '#111111', border: '1px solid rgba(255,255,255,0.06)' }}
    >
      <div className="flex items-center gap-2 mb-2" style={{ color }}>
        {icon}
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">{label}</span>
      </div>
      <div className="text-xl font-bold text-[#F5F5F8] mb-1">{value}</div>
      <div className="text-xs text-gray-500">{sub}</div>
    </div>
  );
}