'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  Loader,
  ChevronDown,
  ChevronRight,
  Check,
  RefreshCw,
  Activity,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Eye,
  MousePointerClick,
  ShoppingCart,
  Target,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  X,
} from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, Cell,
} from 'recharts';
import Navbar from '@/components/Navbar';
import { createClient } from '@/lib/supabase';

// ─── Brand Palette ──────────────────────────────────────────────
const GOLD = '#C8B89A';
const GOLD_DIM = 'rgba(200,184,154,0.08)';
const META_BLUE = '#1877F2';
const GOOGLE_GREEN = '#34A853';
const GOOGLE_YELLOW = '#FBBC04';

// ─── Types ──────────────────────────────────────────────────────

interface Brand {
  id: string;
  name: string;
  slug: string;
  meta_ad_account_id?: string;
  google_ads_customer_id?: string;
}

interface DailyMetric {
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
  purchases: number;
  purchaseValue: number;
}

interface Campaign {
  platform: 'meta' | 'google';
  campaignId: string;
  campaignName: string;
  campaignType: string;
  status: string;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  cpm: number;
  purchases: number;
  purchaseValue: number;
  roas: number;
  cpa: number;
  reach: number;
  daily: DailyMetric[];
}

type DateRange = 'last_7d' | 'last_14d' | 'last_30d' | 'last_90d' | 'this_month';
type SortKey = 'spend' | 'roas' | 'purchases' | 'purchaseValue' | 'ctr' | 'cpc' | 'cpm' | 'impressions' | 'clicks' | 'cpa';
type SortDir = 'asc' | 'desc';
type PlatformFilter = 'all' | 'meta' | 'google';

const DATE_RANGES: { value: DateRange; label: string }[] = [
  { value: 'last_7d', label: 'Last 7 Days' },
  { value: 'last_14d', label: 'Last 14 Days' },
  { value: 'last_30d', label: 'Last 30 Days' },
  { value: 'last_90d', label: 'Last 90 Days' },
  { value: 'this_month', label: 'This Month' },
];

const GOOGLE_RANGE_MAP: Record<DateRange, string> = {
  'last_7d': 'LAST_7_DAYS',
  'last_14d': 'LAST_7_DAYS',
  'last_30d': 'LAST_30_DAYS',
  'last_90d': 'LAST_90_DAYS',
  'this_month': 'THIS_MONTH',
};

// ─── Formatters ─────────────────────────────────────────────────

const fmtCurrency = (n: number) => {
  if (Math.abs(n) >= 1000000) return `$${(n / 1000000).toFixed(1)}M`;
  if (Math.abs(n) >= 10000) return `$${(n / 1000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
};
const fmtNum = (n: number) => {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 10000) return `${(n / 1000).toFixed(1)}K`;
  return n.toLocaleString();
};
const fmtPct = (n: number) => `${n.toFixed(2)}%`;
const fmtDec = (n: number) => n.toFixed(2);

// ─── Helpers ────────────────────────────────────────────────────

function extractMetaAction(actions: any[] | undefined, actionType: string): number {
  if (!actions) return 0;
  const found = actions.find((a: any) => a.action_type === actionType);
  return found ? parseFloat(found.value) : 0;
}

// ─── Platform Badge ─────────────────────────────────────────────

function PlatformBadge({ platform }: { platform: 'meta' | 'google' }) {
  const color = platform === 'meta' ? META_BLUE : GOOGLE_GREEN;
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider"
      style={{
        backgroundColor: `${color}15`,
        color,
        border: `1px solid ${color}25`,
      }}
    >
      {platform === 'meta' ? '⬡ Meta' : '▲ Google'}
    </span>
  );
}

// ─── Custom Tooltip ─────────────────────────────────────────────

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="rounded-lg px-3 py-2"
      style={{
        backgroundColor: '#1a1a1a',
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
      }}
    >
      <div className="text-[10px] font-semibold mb-1" style={{ color: '#666' }}>
        {label}
      </div>
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-2 text-xs">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
          <span style={{ color: '#999' }}>{p.name}:</span>
          <span className="font-semibold" style={{ color: '#F5F5F8' }}>
            {p.name.includes('Spend') || p.name.includes('Revenue') ? fmtCurrency(p.value) : fmtNum(p.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Breakdown Types ────────────────────────────────────────────

interface BreakdownLine {
  label: string;
  value: string;
  icon?: string;
  accent?: string;
  bold?: boolean;
  indent?: boolean;
  divider?: boolean;
  formula?: boolean;
}

interface BreakdownSection {
  title: string;
  lines: BreakdownLine[];
}

// ─── Metric Breakdown Modal ─────────────────────────────────────

function MetricBreakdown({ label, value, accent, sections, onClose }: {
  label: string;
  value: string;
  accent: string;
  sections: BreakdownSection[];
  onClose: () => void;
}) {
  return (
    <>
      <div
        className="fixed inset-0 z-50"
        style={{ backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
        onClick={onClose}
      />
      <div
        className="fixed z-50 rounded-xl overflow-hidden"
        style={{
          top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          width: '420px', maxWidth: 'calc(100vw - 32px)', maxHeight: 'calc(100vh - 64px)',
          backgroundColor: '#111', border: '1px solid rgba(255,255,255,0.08)',
          boxShadow: '0 32px 80px rgba(0,0,0,0.7), 0 0 1px rgba(255,255,255,0.1)',
        }}
      >
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: accent }} />
            <span className="text-sm font-bold" style={{ color: '#F5F5F8' }}>{label}</span>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-md flex items-center justify-center transition-colors"
            style={{ color: '#555' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = '#999'; e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.06)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = '#555'; e.currentTarget.style.backgroundColor = 'transparent'; }}
          >
            <X size={14} />
          </button>
        </div>
        <div className="px-5 pt-4 pb-3">
          <div className="text-3xl font-extrabold tracking-tight" style={{ color: accent, lineHeight: 1.1 }}>{value}</div>
        </div>
        <div className="overflow-y-auto px-5 pb-5" style={{ maxHeight: 'calc(100vh - 240px)' }}>
          {sections.map((section, si) => (
            <div key={si} className="mb-4 last:mb-0">
              <div
                className="text-[9px] font-bold uppercase tracking-widest mb-2 pt-2"
                style={{ color: '#444', letterSpacing: '0.08em', borderTop: si > 0 ? '1px solid rgba(255,255,255,0.04)' : 'none' }}
              >
                {section.title}
              </div>
              {section.lines.map((line, li) => (
                <div
                  key={li}
                  className="flex items-center justify-between py-1.5"
                  style={{
                    paddingLeft: line.indent ? '16px' : '0',
                    borderTop: line.divider ? '1px solid rgba(255,255,255,0.04)' : 'none',
                    marginTop: line.divider ? '4px' : '0',
                    paddingTop: line.divider ? '8px' : undefined,
                  }}
                >
                  <div className="flex items-center gap-2">
                    {line.icon && <span className="text-xs" style={{ opacity: 0.7 }}>{line.icon}</span>}
                    <span className="text-xs" style={{
                      color: line.formula ? '#555' : line.bold ? '#F5F5F8' : '#888',
                      fontWeight: line.bold ? 700 : 500,
                      fontStyle: line.formula ? 'italic' : 'normal',
                    }}>
                      {line.label}
                    </span>
                  </div>
                  <span className="text-xs font-semibold tabular-nums" style={{
                    color: line.accent || (line.bold ? '#F5F5F8' : '#999'),
                    fontWeight: line.bold ? 800 : 600,
                  }}>
                    {line.value}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// ─── Metric Card (clickable with breakdown) ─────────────────────

function MetricCard({ label, value, sub, accent, sections }: {
  label: string;
  value: string;
  sub?: string;
  accent?: 'gold' | 'green' | 'red' | 'blue';
  sections?: BreakdownSection[];
}) {
  const [open, setOpen] = useState(false);
  const accentColor = accent === 'gold' ? GOLD
    : accent === 'green' ? '#10B981'
    : accent === 'red' ? '#ef4444'
    : accent === 'blue' ? META_BLUE
    : '#F5F5F8';
  const glowOpacity = accent === 'gold' ? 0.06 : accent === 'green' ? 0.04 : 0;
  const hasBreakdown = sections && sections.length > 0;
  return (
    <>
      <div
        className="relative overflow-hidden rounded-lg p-4 transition-all"
        style={{
          backgroundColor: '#0e0e0e',
          border: `1px solid ${open ? accentColor + '30' : 'rgba(255,255,255,0.04)'}`,
          cursor: hasBreakdown ? 'pointer' : 'default',
        }}
        onClick={() => hasBreakdown && setOpen(true)}
        onMouseEnter={(e) => { if (hasBreakdown) e.currentTarget.style.borderColor = accentColor + '20'; }}
        onMouseLeave={(e) => { if (hasBreakdown && !open) e.currentTarget.style.borderColor = 'rgba(255,255,255,0.04)'; }}
      >
        {glowOpacity > 0 && (
          <div
            className="absolute inset-0 pointer-events-none"
            style={{ background: `radial-gradient(ellipse at bottom left, ${accentColor}${Math.round(glowOpacity * 255).toString(16).padStart(2, '0')}, transparent 70%)` }}
          />
        )}
        <div className="flex items-center justify-between mb-2 relative">
          <div className="text-[9px] font-bold uppercase tracking-widest" style={{ color: '#555', letterSpacing: '0.08em' }}>{label}</div>
          {hasBreakdown && (
            <div className="w-4 h-4 rounded flex items-center justify-center" style={{ backgroundColor: 'rgba(255,255,255,0.04)' }}>
              <ChevronRight size={10} style={{ color: '#444' }} />
            </div>
          )}
        </div>
        <div className="text-xl md:text-2xl font-extrabold tracking-tight relative" style={{ color: accentColor, lineHeight: 1.1 }}>{value}</div>
        {sub && <div className="text-[10px] font-semibold mt-1.5 relative" style={{ color: '#444' }}>{sub}</div>}
      </div>
      {open && sections && (
        <MetricBreakdown label={label} value={value} accent={accentColor} sections={sections} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════
// ═══ MAIN COMPONENT ═══════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════

export default function CampaignPerformancePage() {
  const router = useRouter();
  const supabase = createClient();

  // Auth state
  const [loading, setLoading] = useState(true);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [selectedBrandId, setSelectedBrandId] = useState<string | null>(null);
  const [showBrandDropdown, setShowBrandDropdown] = useState(false);
  const [fetchingBrands, setFetchingBrands] = useState(true);

  // Data state
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // View state
  const [dateRange, setDateRange] = useState<DateRange>('last_30d');
  const [platformFilter, setPlatformFilter] = useState<PlatformFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('spend');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [selectedCampaign, setSelectedCampaign] = useState<string | null>(null);
  const [chartMetric, setChartMetric] = useState<'spend' | 'roas' | 'purchases'>('spend');

  // ── Auth & brands ──
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push('/'); return; }

      const { data: profile } = await supabase
        .from('users_profile')
        .select('role, brand_id')
        .eq('id', session.user.id)
        .single();

      if (!profile || !['admin', 'strategist', 'founder'].includes(profile.role)) {
        router.push('/');
        return;
      }

      let brandsQuery = supabase
        .from('brands')
        .select('id, name, slug, meta_ad_account_id, google_ads_customer_id')
        .order('name');
      // Founders only see their own brand
      if (profile.role === 'founder' && profile.brand_id) {
        brandsQuery = brandsQuery.eq('id', profile.brand_id);
      }
      const { data: brandsData } = await brandsQuery;

      if (brandsData?.length) {
        setBrands(brandsData);
        // Restore last-selected brand from localStorage, fallback to first
        const saved = localStorage.getItem('melch_selected_brand');
        const match = saved && brandsData.find((b: Brand) => b.id === saved);
        setSelectedBrandId(match ? saved : brandsData[0].id);
      }
      setFetchingBrands(false);
      setLoading(false);
    })();
  }, []);

  // ── Fetch campaign data ──
  useEffect(() => {
    if (!selectedBrandId) return;
    fetchCampaigns();
  }, [selectedBrandId, dateRange]);

  const fetchCampaigns = async () => {
    if (!selectedBrandId) return;
    setFetching(true);
    setError(null);

    const brand = brands.find(b => b.id === selectedBrandId);
    if (!brand) { setFetching(false); return; }

    const allCampaigns: Campaign[] = [];

    try {
      // Single API call fetches both Meta + Google scoped to this brand
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `/api/campaign-metrics?brandId=${selectedBrandId}&dateRange=${dateRange}`,
        { headers: { Authorization: `Bearer ${session?.access_token}` } }
      );
      const data = await res.json();
      if (data.campaigns) allCampaigns.push(...data.campaigns);
      if (data.errors?.length) {
        console.warn('Campaign fetch warnings:', data.errors);
        setError(data.errors.join(' | '));
      }
      if (data.error) {
        setError(data.error);
      }
      // Surface when the brand has no ad accounts configured
      if (!data.campaigns?.length && !data.errors?.length && !data.error) {
        const b = brands.find(br => br.id === selectedBrandId);
        const missing: string[] = [];
        if (!b?.meta_ad_account_id) missing.push('Meta Ad Account ID');
        if (!b?.google_ads_customer_id) missing.push('Google Ads Customer ID');
        if (missing.length > 0) {
          setError(`No ad accounts configured for this brand. Missing: ${missing.join(', ')}. Set them in Team settings.`);
        }
      }
    } catch (e: any) {
      setError(e.message);
    }

    setCampaigns(allCampaigns);
    setFetching(false);
  };

  // ── Computed ──
  const selectedBrand = brands.find(b => b.id === selectedBrandId);

  const filteredCampaigns = useMemo(() => {
    let filtered = campaigns.filter(c => c.spend > 0);
    if (platformFilter !== 'all') {
      filtered = filtered.filter(c => c.platform === platformFilter);
    }
    return filtered.sort((a, b) => {
      const av = a[sortKey] as number;
      const bv = b[sortKey] as number;
      return sortDir === 'desc' ? bv - av : av - bv;
    });
  }, [campaigns, platformFilter, sortKey, sortDir]);

  // Aggregate metrics
  const totals = useMemo(() => {
    const t = filteredCampaigns.reduce((acc, c) => ({
      spend: acc.spend + c.spend,
      impressions: acc.impressions + c.impressions,
      clicks: acc.clicks + c.clicks,
      purchases: acc.purchases + c.purchases,
      purchaseValue: acc.purchaseValue + c.purchaseValue,
      reach: acc.reach + c.reach,
    }), { spend: 0, impressions: 0, clicks: 0, purchases: 0, purchaseValue: 0, reach: 0 });

    return {
      ...t,
      roas: t.spend > 0 ? t.purchaseValue / t.spend : 0,
      ctr: t.impressions > 0 ? (t.clicks / t.impressions) * 100 : 0,
      cpc: t.clicks > 0 ? t.spend / t.clicks : 0,
      cpm: t.impressions > 0 ? (t.spend / t.impressions) * 1000 : 0,
      cpa: t.purchases > 0 ? t.spend / t.purchases : 0,
    };
  }, [filteredCampaigns]);

  // Per-platform subtotals (always computed from filteredCampaigns, so respects toggle)
  const platformTotals = useMemo(() => {
    const calc = (platform: 'meta' | 'google') => {
      const pCampaigns = filteredCampaigns.filter(c => c.platform === platform);
      const t = pCampaigns.reduce((acc, c) => ({
        spend: acc.spend + c.spend,
        impressions: acc.impressions + c.impressions,
        clicks: acc.clicks + c.clicks,
        purchases: acc.purchases + c.purchases,
        purchaseValue: acc.purchaseValue + c.purchaseValue,
        reach: acc.reach + c.reach,
        count: acc.count + 1,
      }), { spend: 0, impressions: 0, clicks: 0, purchases: 0, purchaseValue: 0, reach: 0, count: 0 });
      return {
        ...t,
        roas: t.spend > 0 ? t.purchaseValue / t.spend : 0,
        ctr: t.impressions > 0 ? (t.clicks / t.impressions) * 100 : 0,
        cpc: t.clicks > 0 ? t.spend / t.clicks : 0,
        cpm: t.impressions > 0 ? (t.spend / t.impressions) * 1000 : 0,
        cpa: t.purchases > 0 ? t.spend / t.purchases : 0,
      };
    };
    return { meta: calc('meta'), google: calc('google') };
  }, [filteredCampaigns]);

  const dateLabel = DATE_RANGES.find(d => d.value === dateRange)?.label || dateRange;
  const platformLabel = platformFilter === 'all' ? 'All Platforms' : platformFilter === 'meta' ? 'Meta Only' : 'Google Only';

  // Build daily chart data (aggregate across all filtered campaigns)
  const chartData = useMemo(() => {
    const byDate = new Map<string, { date: string; metaSpend: number; googleSpend: number; metaRev: number; googleRev: number; metaPurchases: number; googlePurchases: number }>();

    for (const c of filteredCampaigns) {
      for (const d of c.daily) {
        if (!byDate.has(d.date)) {
          byDate.set(d.date, { date: d.date, metaSpend: 0, googleSpend: 0, metaRev: 0, googleRev: 0, metaPurchases: 0, googlePurchases: 0 });
        }
        const entry = byDate.get(d.date)!;
        if (c.platform === 'meta') {
          entry.metaSpend += d.spend;
          entry.metaRev += d.purchaseValue;
          entry.metaPurchases += d.purchases;
        } else {
          entry.googleSpend += d.spend;
          entry.googleRev += d.purchaseValue;
          entry.googlePurchases += d.purchases;
        }
      }
    }

    return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [filteredCampaigns]);

  // Campaign-specific chart data
  const campaignChartData = useMemo(() => {
    if (!selectedCampaign) return null;
    const c = campaigns.find(c => c.campaignId === selectedCampaign);
    if (!c) return null;
    return c.daily.map(d => ({
      date: d.date,
      Spend: d.spend,
      Revenue: d.purchaseValue,
      Purchases: d.purchases,
      ROAS: d.spend > 0 ? d.purchaseValue / d.spend : 0,
    }));
  }, [selectedCampaign, campaigns]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <ArrowUpDown size={10} style={{ color: '#333' }} />;
    return sortDir === 'desc'
      ? <ArrowDown size={10} style={{ color: GOLD }} />
      : <ArrowUp size={10} style={{ color: GOLD }} />;
  };

  // ── Loading ──
  if (loading) {
    return (
      <Navbar>
        <div className="flex items-center justify-center h-screen" style={{ backgroundColor: '#0A0A0A' }}>
          <Loader className="animate-spin" size={24} style={{ color: GOLD }} />
        </div>
      </Navbar>
    );
  }

  // ═══ RENDER ═══

  return (
    <Navbar>
      <div className="flex flex-col h-screen" style={{ backgroundColor: '#0A0A0A' }}>
        {/* ─── TOP BAR ─── */}
        <div
          className="flex items-center justify-between px-5 md:px-7 py-5 flex-shrink-0"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}
        >
          <div>
            <h1 className="text-lg md:text-xl font-extrabold tracking-tight flex items-center gap-2.5" style={{ color: '#F5F5F8' }}>
              <span
                className="w-7 h-7 rounded-lg flex items-center justify-center text-sm"
                style={{ backgroundColor: GOLD_DIM, border: '1px solid rgba(200,184,154,0.12)', color: GOLD }}
              >
                <Activity size={14} />
              </span>
              Campaign Performance
            </h1>
            <p className="text-xs mt-0.5" style={{ color: '#555' }}>
              {selectedBrand ? `${selectedBrand.name} — ` : ''}Cross-platform campaign metrics and trends
            </p>
          </div>

          <div className="flex items-center gap-2">
            {/* Date range selector */}
            <div
              className="flex rounded-md overflow-hidden"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.04)' }}
            >
              {DATE_RANGES.map((dr) => (
                <button
                  key={dr.value}
                  onClick={() => setDateRange(dr.value)}
                  className="px-3 py-1.5 text-[11px] font-semibold transition-all"
                  style={{
                    backgroundColor: dateRange === dr.value ? 'rgba(200,184,154,0.1)' : 'transparent',
                    color: dateRange === dr.value ? GOLD : '#555',
                    borderRight: '1px solid rgba(255,255,255,0.04)',
                  }}
                >
                  {dr.label}
                </button>
              ))}
            </div>

            {/* Platform filter */}
            <div
              className="flex rounded-md overflow-hidden"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.04)' }}
            >
              {([
                { value: 'all', label: 'All', color: GOLD },
                { value: 'meta', label: 'Meta', color: META_BLUE },
                { value: 'google', label: 'Google', color: GOOGLE_GREEN },
              ] as const).map((pf) => (
                <button
                  key={pf.value}
                  onClick={() => setPlatformFilter(pf.value)}
                  className="px-3 py-1.5 text-[11px] font-semibold transition-all"
                  style={{
                    backgroundColor: platformFilter === pf.value ? `${pf.color}15` : 'transparent',
                    color: platformFilter === pf.value ? pf.color : '#555',
                    borderRight: '1px solid rgba(255,255,255,0.04)',
                  }}
                >
                  {pf.label}
                </button>
              ))}
            </div>

            {/* Refresh */}
            <button
              onClick={fetchCampaigns}
              disabled={fetching}
              className="w-8 h-8 rounded-md flex items-center justify-center transition-colors"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.04)', color: '#555' }}
            >
              <RefreshCw size={14} className={fetching ? 'animate-spin' : ''} />
            </button>

            {/* Brand selector */}
            <div className="relative ml-2">
              <button
                onClick={() => setShowBrandDropdown(!showBrandDropdown)}
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-all"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)', color: selectedBrand ? GOLD : '#999' }}
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
                      onClick={() => { setSelectedBrandId(brand.id); localStorage.setItem('melch_selected_brand', brand.id); setShowBrandDropdown(false); }}
                      className="w-full flex items-center justify-between px-3 py-2 text-xs transition-colors"
                      style={{ color: brand.id === selectedBrandId ? GOLD : '#CCC', backgroundColor: brand.id === selectedBrandId ? GOLD_DIM : 'transparent' }}
                    >
                      {brand.name}
                      {brand.id === selectedBrandId && <Check size={14} style={{ color: GOLD }} />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ─── SCROLLABLE CONTENT ─── */}
        <div className="flex-1 overflow-y-auto">
          {/* Loading state */}
          {fetching && campaigns.length === 0 && (
            <div className="flex items-center justify-center py-20">
              <Loader className="animate-spin mr-3" size={20} style={{ color: GOLD }} />
              <span className="text-sm" style={{ color: '#666' }}>Loading campaign data...</span>
            </div>
          )}

          {/* Error state */}
          {error && (
            <div className="mx-5 md:mx-7 mt-5 rounded-lg p-4" style={{ backgroundColor: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)' }}>
              <span className="text-xs font-semibold" style={{ color: '#ef4444' }}>{error}</span>
            </div>
          )}

          {/* Main content */}
          {campaigns.length > 0 && (
            <>
              {/* ── Metrics Showcase ── */}
              <div className="px-5 md:px-7 py-5">
                {/* Row 1 — Spend, Revenue, ROAS, Purchases (4 cards) */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-2">
                  <MetricCard
                    label="Total Spend"
                    value={fmtCurrency(totals.spend)}
                    sub={`${dateLabel} · ${platformLabel}`}
                    accent="gold"
                    sections={[
                      {
                        title: 'Spend Breakdown',
                        lines: [
                          { label: 'Meta Ads', value: fmtCurrency(platformTotals.meta.spend), icon: '🔵', accent: META_BLUE },
                          { label: `${platformTotals.meta.count} campaigns`, value: '', indent: true },
                          { label: 'Google Ads', value: fmtCurrency(platformTotals.google.spend), icon: '🟢', accent: GOOGLE_GREEN },
                          { label: `${platformTotals.google.count} campaigns`, value: '', indent: true },
                          { label: 'Total Spend', value: fmtCurrency(totals.spend), divider: true, bold: true, accent: GOLD },
                        ],
                      },
                      {
                        title: 'Channel Mix',
                        lines: [
                          { label: 'Meta %', value: totals.spend > 0 ? fmtPct(platformTotals.meta.spend / totals.spend * 100) : '0%', accent: META_BLUE },
                          { label: 'Google %', value: totals.spend > 0 ? fmtPct(platformTotals.google.spend / totals.spend * 100) : '0%', accent: GOOGLE_GREEN },
                        ],
                      },
                    ]}
                  />
                  <MetricCard
                    label="Revenue"
                    value={fmtCurrency(totals.purchaseValue)}
                    sub={`${fmtNum(Math.round(totals.purchases))} purchases`}
                    accent="green"
                    sections={[
                      {
                        title: 'Revenue Breakdown',
                        lines: [
                          { label: 'Meta Revenue', value: fmtCurrency(platformTotals.meta.purchaseValue), icon: '🔵', accent: META_BLUE },
                          { label: `${Math.round(platformTotals.meta.purchases)} purchases`, value: '', indent: true },
                          { label: 'Google Revenue', value: fmtCurrency(platformTotals.google.purchaseValue), icon: '🟢', accent: GOOGLE_GREEN },
                          { label: `${Math.round(platformTotals.google.purchases)} purchases`, value: '', indent: true },
                          { label: 'Total Revenue', value: fmtCurrency(totals.purchaseValue), divider: true, bold: true, accent: '#10B981' },
                        ],
                      },
                      {
                        title: 'Revenue per Platform',
                        lines: [
                          { label: 'Meta %', value: totals.purchaseValue > 0 ? fmtPct(platformTotals.meta.purchaseValue / totals.purchaseValue * 100) : '0%', accent: META_BLUE },
                          { label: 'Google %', value: totals.purchaseValue > 0 ? fmtPct(platformTotals.google.purchaseValue / totals.purchaseValue * 100) : '0%', accent: GOOGLE_GREEN },
                        ],
                      },
                    ]}
                  />
                  <MetricCard
                    label="ROAS"
                    value={`${fmtDec(totals.roas)}x`}
                    sub="Revenue ÷ Spend"
                    accent={totals.roas >= 2 ? 'green' : totals.roas >= 1 ? 'gold' : 'red'}
                    sections={[
                      {
                        title: 'Blended ROAS Calculation',
                        lines: [
                          { label: 'Total Revenue', value: fmtCurrency(totals.purchaseValue), icon: '💰', accent: '#10B981' },
                          { label: 'Total Spend', value: fmtCurrency(totals.spend), icon: '📣', accent: GOLD },
                          { label: 'Blended ROAS', value: `${fmtDec(totals.roas)}x`, divider: true, bold: true, accent: totals.roas >= 2 ? '#10B981' : totals.roas >= 1 ? GOLD : '#ef4444' },
                        ],
                      },
                      {
                        title: 'Per-Platform ROAS',
                        lines: [
                          { label: 'Meta ROAS', value: `${fmtDec(platformTotals.meta.roas)}x`, icon: '🔵', accent: META_BLUE },
                          { label: `${fmtCurrency(platformTotals.meta.purchaseValue)} rev ÷ ${fmtCurrency(platformTotals.meta.spend)} spend`, value: '', indent: true },
                          { label: 'Google ROAS', value: `${fmtDec(platformTotals.google.roas)}x`, icon: '🟢', accent: GOOGLE_GREEN },
                          { label: `${fmtCurrency(platformTotals.google.purchaseValue)} rev ÷ ${fmtCurrency(platformTotals.google.spend)} spend`, value: '', indent: true },
                        ],
                      },
                      {
                        title: 'Formula',
                        lines: [
                          { label: 'Total Purchase Value ÷ Total Ad Spend', value: '', formula: true },
                        ],
                      },
                    ]}
                  />
                  <MetricCard
                    label="Purchases"
                    value={fmtNum(Math.round(totals.purchases))}
                    sub={`CPA: ${fmtCurrency(totals.cpa)}`}
                    sections={[
                      {
                        title: 'Purchase Breakdown',
                        lines: [
                          { label: 'Meta Purchases', value: fmtNum(Math.round(platformTotals.meta.purchases)), icon: '🔵', accent: META_BLUE },
                          { label: `CPA: ${fmtCurrency(platformTotals.meta.cpa)}`, value: '', indent: true },
                          { label: 'Google Purchases', value: fmtNum(Math.round(platformTotals.google.purchases)), icon: '🟢', accent: GOOGLE_GREEN },
                          { label: `CPA: ${fmtCurrency(platformTotals.google.cpa)}`, value: '', indent: true },
                          { label: 'Total Purchases', value: fmtNum(Math.round(totals.purchases)), divider: true, bold: true },
                        ],
                      },
                      {
                        title: 'Blended CPA',
                        lines: [
                          { label: 'Total Spend ÷ Total Purchases', value: fmtCurrency(totals.cpa), bold: true },
                        ],
                      },
                    ]}
                  />
                </div>
                {/* Row 2 — CPA, CTR, CPC, CPM (4 cards) */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <MetricCard
                    label="CPA"
                    value={fmtCurrency(totals.cpa)}
                    sub="Cost per Acquisition"
                    sections={[
                      {
                        title: 'CPA Calculation',
                        lines: [
                          { label: 'Total Ad Spend', value: fmtCurrency(totals.spend), icon: '📣' },
                          { label: 'Total Purchases', value: fmtNum(Math.round(totals.purchases)), icon: '🛒' },
                          { label: 'Blended CPA', value: fmtCurrency(totals.cpa), divider: true, bold: true },
                        ],
                      },
                      {
                        title: 'Per-Platform CPA',
                        lines: [
                          { label: 'Meta CPA', value: fmtCurrency(platformTotals.meta.cpa), icon: '🔵', accent: META_BLUE },
                          { label: `${fmtCurrency(platformTotals.meta.spend)} ÷ ${Math.round(platformTotals.meta.purchases)} purchases`, value: '', indent: true },
                          { label: 'Google CPA', value: fmtCurrency(platformTotals.google.cpa), icon: '🟢', accent: GOOGLE_GREEN },
                          { label: `${fmtCurrency(platformTotals.google.spend)} ÷ ${Math.round(platformTotals.google.purchases)} purchases`, value: '', indent: true },
                        ],
                      },
                      {
                        title: 'Formula',
                        lines: [
                          { label: 'Total Ad Spend ÷ Total Purchases', value: '', formula: true },
                        ],
                      },
                    ]}
                  />
                  <MetricCard
                    label="CTR"
                    value={fmtPct(totals.ctr)}
                    sub="Click-Through Rate"
                    sections={[
                      {
                        title: 'CTR Calculation',
                        lines: [
                          { label: 'Total Clicks', value: fmtNum(totals.clicks), icon: '👆' },
                          { label: 'Total Impressions', value: fmtNum(totals.impressions), icon: '👁' },
                          { label: 'Blended CTR', value: fmtPct(totals.ctr), divider: true, bold: true },
                        ],
                      },
                      {
                        title: 'Per-Platform CTR',
                        lines: [
                          { label: 'Meta CTR', value: fmtPct(platformTotals.meta.ctr), icon: '🔵', accent: META_BLUE },
                          { label: `${fmtNum(platformTotals.meta.clicks)} clicks ÷ ${fmtNum(platformTotals.meta.impressions)} impr.`, value: '', indent: true },
                          { label: 'Google CTR', value: fmtPct(platformTotals.google.ctr), icon: '🟢', accent: GOOGLE_GREEN },
                          { label: `${fmtNum(platformTotals.google.clicks)} clicks ÷ ${fmtNum(platformTotals.google.impressions)} impr.`, value: '', indent: true },
                        ],
                      },
                      {
                        title: 'Formula',
                        lines: [
                          { label: '(Clicks ÷ Impressions) × 100', value: '', formula: true },
                        ],
                      },
                    ]}
                  />
                  <MetricCard
                    label="CPC"
                    value={fmtCurrency(totals.cpc)}
                    sub="Cost per Click"
                    sections={[
                      {
                        title: 'CPC Calculation',
                        lines: [
                          { label: 'Total Ad Spend', value: fmtCurrency(totals.spend), icon: '📣' },
                          { label: 'Total Clicks', value: fmtNum(totals.clicks), icon: '👆' },
                          { label: 'Blended CPC', value: fmtCurrency(totals.cpc), divider: true, bold: true },
                        ],
                      },
                      {
                        title: 'Per-Platform CPC',
                        lines: [
                          { label: 'Meta CPC', value: fmtCurrency(platformTotals.meta.cpc), icon: '🔵', accent: META_BLUE },
                          { label: `${fmtCurrency(platformTotals.meta.spend)} ÷ ${fmtNum(platformTotals.meta.clicks)} clicks`, value: '', indent: true },
                          { label: 'Google CPC', value: fmtCurrency(platformTotals.google.cpc), icon: '🟢', accent: GOOGLE_GREEN },
                          { label: `${fmtCurrency(platformTotals.google.spend)} ÷ ${fmtNum(platformTotals.google.clicks)} clicks`, value: '', indent: true },
                        ],
                      },
                      {
                        title: 'Formula',
                        lines: [
                          { label: 'Total Ad Spend ÷ Total Clicks', value: '', formula: true },
                        ],
                      },
                    ]}
                  />
                  <MetricCard
                    label="CPM"
                    value={fmtCurrency(totals.cpm)}
                    sub="Cost per 1,000 Impressions"
                    sections={[
                      {
                        title: 'CPM Calculation',
                        lines: [
                          { label: 'Total Ad Spend', value: fmtCurrency(totals.spend), icon: '📣' },
                          { label: 'Total Impressions', value: fmtNum(totals.impressions), icon: '👁' },
                          { label: 'Blended CPM', value: fmtCurrency(totals.cpm), divider: true, bold: true },
                        ],
                      },
                      {
                        title: 'Per-Platform CPM',
                        lines: [
                          { label: 'Meta CPM', value: fmtCurrency(platformTotals.meta.cpm), icon: '🔵', accent: META_BLUE },
                          { label: `${fmtCurrency(platformTotals.meta.spend)} ÷ ${fmtNum(platformTotals.meta.impressions)} × 1000`, value: '', indent: true },
                          { label: 'Google CPM', value: fmtCurrency(platformTotals.google.cpm), icon: '🟢', accent: GOOGLE_GREEN },
                          { label: `${fmtCurrency(platformTotals.google.spend)} ÷ ${fmtNum(platformTotals.google.impressions)} × 1000`, value: '', indent: true },
                        ],
                      },
                      {
                        title: 'Formula',
                        lines: [
                          { label: '(Total Ad Spend ÷ Total Impressions) × 1,000', value: '', formula: true },
                        ],
                      },
                    ]}
                  />
                </div>
              </div>

              {/* ── Daily Spend / Revenue Chart ── */}
              <div
                className="mx-5 md:mx-7 mb-5 rounded-xl p-5"
                style={{ backgroundColor: '#0e0e0e', border: '1px solid rgba(255,255,255,0.04)' }}
              >
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-bold" style={{ color: '#F5F5F8' }}>
                    Daily Performance
                  </h2>
                  <div className="flex rounded-md overflow-hidden" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.04)' }}>
                    {(['spend', 'roas', 'purchases'] as const).map((m) => (
                      <button
                        key={m}
                        onClick={() => setChartMetric(m)}
                        className="px-3 py-1 text-[10px] font-semibold uppercase transition-all"
                        style={{
                          backgroundColor: chartMetric === m ? GOLD_DIM : 'transparent',
                          color: chartMetric === m ? GOLD : '#555',
                        }}
                      >
                        {m === 'spend' ? 'Spend & Revenue' : m === 'roas' ? 'ROAS' : 'Purchases'}
                      </button>
                    ))}
                  </div>
                </div>

                <ResponsiveContainer width="100%" height={280}>
                  {chartMetric === 'spend' ? (
                    <AreaChart data={chartData}>
                      <defs>
                        <linearGradient id="metaGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={META_BLUE} stopOpacity={0.2} />
                          <stop offset="95%" stopColor={META_BLUE} stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="googleGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={GOOGLE_GREEN} stopOpacity={0.2} />
                          <stop offset="95%" stopColor={GOOGLE_GREEN} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                      <XAxis
                        dataKey="date"
                        tick={{ fill: '#444', fontSize: 10 }}
                        tickFormatter={(v) => { const d = new Date(v + 'T12:00:00'); return `${d.getMonth()+1}/${d.getDate()}`; }}
                        axisLine={{ stroke: 'rgba(255,255,255,0.04)' }}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fill: '#444', fontSize: 10 }}
                        tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`}
                        axisLine={false}
                        tickLine={false}
                        width={50}
                      />
                      <Tooltip content={<ChartTooltip />} />
                      <Legend
                        wrapperStyle={{ fontSize: '10px', color: '#666' }}
                        iconType="circle"
                        iconSize={6}
                      />
                      <Area type="monotone" dataKey="metaSpend" name="Meta Spend" stroke={META_BLUE} fill="url(#metaGrad)" strokeWidth={2} />
                      <Area type="monotone" dataKey="googleSpend" name="Google Spend" stroke={GOOGLE_GREEN} fill="url(#googleGrad)" strokeWidth={2} />
                      <Area type="monotone" dataKey="metaRev" name="Meta Revenue" stroke="#A855F7" fill="none" strokeWidth={1.5} strokeDasharray="4 2" />
                      <Area type="monotone" dataKey="googleRev" name="Google Revenue" stroke={GOOGLE_YELLOW} fill="none" strokeWidth={1.5} strokeDasharray="4 2" />
                    </AreaChart>
                  ) : chartMetric === 'purchases' ? (
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                      <XAxis
                        dataKey="date"
                        tick={{ fill: '#444', fontSize: 10 }}
                        tickFormatter={(v) => { const d = new Date(v + 'T12:00:00'); return `${d.getMonth()+1}/${d.getDate()}`; }}
                        axisLine={{ stroke: 'rgba(255,255,255,0.04)' }}
                        tickLine={false}
                      />
                      <YAxis tick={{ fill: '#444', fontSize: 10 }} axisLine={false} tickLine={false} width={40} />
                      <Tooltip content={<ChartTooltip />} />
                      <Legend wrapperStyle={{ fontSize: '10px', color: '#666' }} iconType="circle" iconSize={6} />
                      <Bar dataKey="metaPurchases" name="Meta Purchases" fill={META_BLUE} radius={[2, 2, 0, 0]} />
                      <Bar dataKey="googlePurchases" name="Google Purchases" fill={GOOGLE_GREEN} radius={[2, 2, 0, 0]} />
                    </BarChart>
                  ) : (
                    <AreaChart data={chartData.map(d => ({
                      ...d,
                      metaROAS: d.metaSpend > 0 ? d.metaRev / d.metaSpend : 0,
                      googleROAS: d.googleSpend > 0 ? d.googleRev / d.googleSpend : 0,
                    }))}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                      <XAxis
                        dataKey="date"
                        tick={{ fill: '#444', fontSize: 10 }}
                        tickFormatter={(v) => { const d = new Date(v + 'T12:00:00'); return `${d.getMonth()+1}/${d.getDate()}`; }}
                        axisLine={{ stroke: 'rgba(255,255,255,0.04)' }}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fill: '#444', fontSize: 10 }}
                        tickFormatter={(v) => `${v.toFixed(1)}x`}
                        axisLine={false}
                        tickLine={false}
                        width={40}
                      />
                      <Tooltip content={<ChartTooltip />} />
                      <Legend wrapperStyle={{ fontSize: '10px', color: '#666' }} iconType="circle" iconSize={6} />
                      <Area type="monotone" dataKey="metaROAS" name="Meta ROAS" stroke={META_BLUE} fill="none" strokeWidth={2} />
                      <Area type="monotone" dataKey="googleROAS" name="Google ROAS" stroke={GOOGLE_GREEN} fill="none" strokeWidth={2} />
                    </AreaChart>
                  )}
                </ResponsiveContainer>
              </div>

              {/* ── Campaign Table ── */}
              <div
                className="mx-5 md:mx-7 mb-7 rounded-xl overflow-hidden"
                style={{ backgroundColor: '#0e0e0e', border: '1px solid rgba(255,255,255,0.04)' }}
              >
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr style={{ backgroundColor: '#0a0a0a', borderBottom: '2px solid rgba(200,184,154,0.12)' }}>
                        <th className="sticky left-0 z-10 px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wider whitespace-nowrap"
                          style={{ backgroundColor: '#0a0a0a', color: '#555', minWidth: '280px' }}>
                          Campaign
                        </th>
                        {([
                          { key: 'spend', label: 'Spend' },
                          { key: 'purchaseValue', label: 'Revenue' },
                          { key: 'roas', label: 'ROAS' },
                          { key: 'purchases', label: 'Purchases' },
                          { key: 'cpa', label: 'CPA' },
                          { key: 'impressions', label: 'Impr.' },
                          { key: 'clicks', label: 'Clicks' },
                          { key: 'ctr', label: 'CTR' },
                          { key: 'cpc', label: 'CPC' },
                          { key: 'cpm', label: 'CPM' },
                        ] as { key: SortKey; label: string }[]).map((col) => (
                          <th
                            key={col.key}
                            onClick={() => handleSort(col.key)}
                            className="px-3 py-3 text-right text-[10px] font-bold uppercase tracking-wider whitespace-nowrap cursor-pointer select-none"
                            style={{ color: sortKey === col.key ? GOLD : '#555' }}
                          >
                            <span className="inline-flex items-center gap-1">
                              {col.label}
                              <SortIcon col={col.key} />
                            </span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredCampaigns.map((c) => {
                        const isSelected = selectedCampaign === c.campaignId;
                        return (
                          <tr
                            key={`${c.platform}-${c.campaignId}`}
                            className="transition-colors cursor-pointer"
                            style={{
                              backgroundColor: isSelected ? 'rgba(200,184,154,0.06)' : 'transparent',
                              borderBottom: '1px solid rgba(255,255,255,0.03)',
                            }}
                            onClick={() => setSelectedCampaign(isSelected ? null : c.campaignId)}
                            onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.02)'; }}
                            onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.backgroundColor = 'transparent'; }}
                          >
                            <td
                              className="sticky left-0 z-10 px-4 py-3"
                              style={{ backgroundColor: isSelected ? '#141210' : '#0e0e0e' }}
                            >
                              <div className="flex items-center gap-2">
                                <PlatformBadge platform={c.platform} />
                                <div>
                                  <div className="text-xs font-semibold truncate max-w-[200px]" style={{ color: '#F5F5F8' }}>
                                    {c.campaignName}
                                  </div>
                                  <div className="text-[10px]" style={{ color: '#555' }}>
                                    {c.campaignType}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="px-3 py-3 text-right text-xs font-semibold tabular-nums" style={{ color: GOLD }}>
                              {fmtCurrency(c.spend)}
                            </td>
                            <td className="px-3 py-3 text-right text-xs font-semibold tabular-nums" style={{ color: '#10B981' }}>
                              {fmtCurrency(c.purchaseValue)}
                            </td>
                            <td className="px-3 py-3 text-right text-xs font-bold tabular-nums" style={{
                              color: c.roas >= 3 ? '#10B981' : c.roas >= 1.5 ? GOLD : '#ef4444',
                            }}>
                              {fmtDec(c.roas)}x
                            </td>
                            <td className="px-3 py-3 text-right text-xs font-semibold tabular-nums" style={{ color: '#999' }}>
                              {Math.round(c.purchases)}
                            </td>
                            <td className="px-3 py-3 text-right text-xs font-semibold tabular-nums" style={{ color: '#999' }}>
                              {fmtCurrency(c.cpa)}
                            </td>
                            <td className="px-3 py-3 text-right text-xs tabular-nums" style={{ color: '#666' }}>
                              {fmtNum(c.impressions)}
                            </td>
                            <td className="px-3 py-3 text-right text-xs tabular-nums" style={{ color: '#666' }}>
                              {fmtNum(c.clicks)}
                            </td>
                            <td className="px-3 py-3 text-right text-xs tabular-nums" style={{ color: '#666' }}>
                              {fmtPct(c.ctr)}
                            </td>
                            <td className="px-3 py-3 text-right text-xs tabular-nums" style={{ color: '#666' }}>
                              {fmtCurrency(c.cpc)}
                            </td>
                            <td className="px-3 py-3 text-right text-xs tabular-nums" style={{ color: '#666' }}>
                              {fmtCurrency(c.cpm)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Campaign drill-down chart */}
                {selectedCampaign && campaignChartData && (
                  <div
                    className="px-5 py-4"
                    style={{ borderTop: '1px solid rgba(200,184,154,0.08)' }}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <PlatformBadge platform={campaigns.find(c => c.campaignId === selectedCampaign)?.platform || 'meta'} />
                        <span className="text-xs font-bold" style={{ color: '#F5F5F8' }}>
                          {campaigns.find(c => c.campaignId === selectedCampaign)?.campaignName}
                        </span>
                      </div>
                      <button
                        onClick={() => setSelectedCampaign(null)}
                        className="w-6 h-6 rounded flex items-center justify-center"
                        style={{ backgroundColor: 'rgba(255,255,255,0.04)', color: '#555' }}
                      >
                        <X size={12} />
                      </button>
                    </div>
                    <ResponsiveContainer width="100%" height={200}>
                      <AreaChart data={campaignChartData}>
                        <defs>
                          <linearGradient id="spendGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={GOLD} stopOpacity={0.15} />
                            <stop offset="95%" stopColor={GOLD} stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#10B981" stopOpacity={0.15} />
                            <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                        <XAxis
                          dataKey="date"
                          tick={{ fill: '#444', fontSize: 10 }}
                          tickFormatter={(v) => { const d = new Date(v + 'T12:00:00'); return `${d.getMonth()+1}/${d.getDate()}`; }}
                          axisLine={{ stroke: 'rgba(255,255,255,0.04)' }}
                          tickLine={false}
                        />
                        <YAxis tick={{ fill: '#444', fontSize: 10 }} tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`} axisLine={false} tickLine={false} width={45} />
                        <Tooltip content={<ChartTooltip />} />
                        <Legend wrapperStyle={{ fontSize: '10px', color: '#666' }} iconType="circle" iconSize={6} />
                        <Area type="monotone" dataKey="Spend" stroke={GOLD} fill="url(#spendGrad)" strokeWidth={2} />
                        <Area type="monotone" dataKey="Revenue" stroke="#10B981" fill="url(#revGrad)" strokeWidth={2} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Empty state */}
          {!fetching && campaigns.length === 0 && !error && (
            <div className="flex flex-col items-center justify-center py-20">
              <Activity size={40} style={{ color: '#333' }} />
              <p className="text-sm mt-3" style={{ color: '#555' }}>
                {selectedBrand ? 'No campaign data found for this date range.' : 'Select a brand to view campaign performance.'}
              </p>
            </div>
          )}
        </div>
      </div>
    </Navbar>
  );
}
