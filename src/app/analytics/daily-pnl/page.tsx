'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Loader,
  DollarSign,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Check,
  Lock,
  Info,
  Download,
  RefreshCw,
  Columns3,
  Search,
  X,
  TrendingUp,
  TrendingDown,
  Calendar,
  Save,
} from 'lucide-react';
import Navbar from '@/components/Navbar';
import { createClient } from '@/lib/supabase';

interface Brand {
  id: string;
  name: string;
  slug: string;
}

// ─── Types ──────────────────────────────────────────────────────

// RAW INPUTS — what comes from Shopify + ad platform APIs
// Everything else is calculated at render time
interface RawRow {
  date: string;
  dayLabel: string;
  // Shopify inputs
  ncOrders: number;      // New customer orders
  ncRevenue: number;     // NC gross revenue
  rcOrders: number;      // Returning customer orders
  rcRevenue: number;     // RC gross revenue
  grossSales: number;    // Total gross sales (NC + RC revenue)
  discounts: number;     // Stored negative (e.g. -1420)
  refunds: number;       // Stored negative (e.g. -218)
  taxes: number;         // Tax collected (positive)
  shipping: number;      // Shipping revenue (positive)
  // Off-Shopify revenue (Amazon, Retail, etc.)
  offShopifyRevenue: number;
  // Ad platform inputs
  metaSpend: number;
  googleSpend: number;
  otherSpend: number;    // From manual monthly input / lock
}

type RowType = 'day' | 'week' | 'month' | 'ytd';
type ViewGranularity = 'Day' | 'Week' | 'Month' | 'Quarter';
type DisplayMode = 'Absolute' | 'Margin %';

interface AggRow extends RawRow {
  rowType: RowType;
}

// CALCULATED — derived at render time from raw inputs + gross margin setting
// Revenue formula: gross after discounts and taxes, with shipping and returns added back in
interface CalcFields {
  ncNetRevenue: number;  // NC share of net revenue (proportional)
  rcNetRevenue: number;  // RC share of net revenue (proportional)
  netRevenue: number;    // grossSales + discounts + refunds - taxes + shipping
  totalSpend: number;    // meta + google + other
  cogs: number;          // netRevenue × (1 - margin%)
  contribution: number;  // netRevenue - cogs - totalSpend (pre-fee ad contribution)
  marginPct: number;     // contribution / netRevenue × 100
  kbContribution: number; // KB-compliant: netRevenue - cogs - totalSpend - merchantFee - fulfillmentCost
  kbMarginPct: number;    // kbContribution / netRevenue × 100
  ncAov: number;         // ncNetRevenue / ncOrders
  cac: number;           // totalSpend / ncOrders
  amer: number;          // ncNetRevenue / totalSpend — acquisition MER
  mer: number;           // netRevenue / totalSpend — blended MER
}

type YearData = { ytd: AggRow; months: { summary: AggRow; weeks: { summary: AggRow; days: AggRow[] }[] }[] };

// ─── Calculation Engine ─────────────────────────────────────────

function calcFields(row: RawRow | AggRow, grossMarginPct: number, merchantFeePct = 0, fulfillmentPerOrder = 0): CalcFields {
  // Net Revenue = Gross after discounts and refunds, plus shipping and off-Shopify
  // Taxes are NOT subtracted — grossSales is subtotal_price + total_discounts (no tax included),
  // so taxes are a pass-through collected on behalf of the government, not revenue.
  const shopifyNetRevenue = row.grossSales + row.discounts + row.refunds + row.shipping;
  const netRevenue = shopifyNetRevenue + row.offShopifyRevenue;

  // Proportionally allocate adjustments to NC and RC based on gross revenue share
  const ncShare = row.grossSales > 0 ? row.ncRevenue / row.grossSales : 0;
  const rcShare = row.grossSales > 0 ? row.rcRevenue / row.grossSales : 0;
  const ncNetRevenue = row.ncRevenue + (row.discounts * ncShare) + (row.refunds * ncShare) + (row.shipping * ncShare);
  const rcNetRevenue = row.rcRevenue + (row.discounts * rcShare) + (row.refunds * rcShare) + (row.shipping * rcShare);

  const totalSpend = row.metaSpend + row.googleSpend + row.otherSpend;
  // COGS applies only to Shopify revenue — off-Shopify revenue is input as fully-loaded net
  const cogs = shopifyNetRevenue * (1 - grossMarginPct / 100);
  const contribution = netRevenue - cogs - totalSpend;
  const totalOrders = row.ncOrders + row.rcOrders;
  const merchantFee = netRevenue * (merchantFeePct / 100);
  const fulfillmentCost = totalOrders * fulfillmentPerOrder;
  const kbContribution = contribution - merchantFee - fulfillmentCost;
  const marginPct = netRevenue > 0 ? (contribution / netRevenue) * 100 : 0;
  const kbMarginPct = netRevenue > 0 ? (kbContribution / netRevenue) * 100 : 0;
  const ncAov = row.ncOrders > 0 ? ncNetRevenue / row.ncOrders : 0;
  const cac = row.ncOrders > 0 ? totalSpend / row.ncOrders : 0;
  const amer = totalSpend > 0 ? ncNetRevenue / totalSpend : 0;
  const mer = totalSpend > 0 ? netRevenue / totalSpend : 0;
  return { ncNetRevenue, rcNetRevenue, netRevenue, totalSpend, cogs, contribution, marginPct, kbContribution, kbMarginPct, ncAov, cac, amer, mer };
}

// ─── Data Transformation ───────────────────────────────────────

// Helper: raw row builders (only raw inputs — no pre-calculated fields)
// Args: label, ncOrd, ncRev, rcOrd, rcRev, gross, disc, ref, tax, ship, meta, google, other
type R = (rt: RowType, label: string, d: string, nc: number, ncR: number, rc: number, rcR: number, gross: number, disc: number, ref: number, tax: number, ship: number, meta: number, google: number, other: number) => AggRow;

const mkRow: R = (rt, label, d, nc, ncR, rc, rcR, gross, disc, ref, tax, ship, meta, google, other) => ({
  rowType: rt, date: d, dayLabel: label,
  ncOrders: nc, ncRevenue: ncR, rcOrders: rc, rcRevenue: rcR,
  grossSales: gross, discounts: disc, refunds: ref, taxes: tax, shipping: ship,
  offShopifyRevenue: 0,
  metaSpend: meta, googleSpend: google, otherSpend: other,
});


// ─── Transform flat daily_pnl rows into hierarchical YearData ───

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/* PLACEHOLDER DATA REMOVED — ~950 lines of dead DATA_2025/DATA_2026 deleted */
interface PnlRow {
  date: string;
  nc_orders: number; nc_revenue: number; rc_orders: number; rc_revenue: number;
  gross_sales: number; discounts: number; refunds: number; taxes: number; shipping: number;
  meta_spend: number; google_spend: number; other_spend: number;
}

function buildYearData(rows: PnlRow[], year: number): YearData {
  if (rows.length === 0) {
    return { ytd: mkRow('ytd', `${year} YTD`, '', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0), months: [] };
  }

  // Group by month (descending)
  const byMonth = new Map<number, PnlRow[]>();
  for (const r of rows) {
    const m = parseInt(r.date.split('-')[1], 10);
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m)!.push(r);
  }

  const sortedMonths = Array.from(byMonth.keys()).sort((a, b) => b - a);

  const sumRows = (arr: PnlRow[]): Omit<PnlRow, 'date'> => ({
    nc_orders: arr.reduce((s, r) => s + r.nc_orders, 0),
    nc_revenue: arr.reduce((s, r) => s + r.nc_revenue, 0),
    rc_orders: arr.reduce((s, r) => s + r.rc_orders, 0),
    rc_revenue: arr.reduce((s, r) => s + r.rc_revenue, 0),
    gross_sales: arr.reduce((s, r) => s + r.gross_sales, 0),
    discounts: arr.reduce((s, r) => s + r.discounts, 0),
    refunds: arr.reduce((s, r) => s + r.refunds, 0),
    taxes: arr.reduce((s, r) => s + r.taxes, 0),
    shipping: arr.reduce((s, r) => s + r.shipping, 0),
    meta_spend: arr.reduce((s, r) => s + r.meta_spend, 0),
    google_spend: arr.reduce((s, r) => s + r.google_spend, 0),
    other_spend: arr.reduce((s, r) => s + r.other_spend, 0),
  });

  const toAgg = (rt: RowType, label: string, agg: Omit<PnlRow, 'date'>, date = ''): AggRow => ({
    rowType: rt, date, dayLabel: label,
    ncOrders: agg.nc_orders, ncRevenue: agg.nc_revenue,
    rcOrders: agg.rc_orders, rcRevenue: agg.rc_revenue,
    grossSales: agg.gross_sales, discounts: agg.discounts,
    refunds: agg.refunds, taxes: agg.taxes, shipping: agg.shipping,
    offShopifyRevenue: 0,
    metaSpend: agg.meta_spend, googleSpend: agg.google_spend, otherSpend: agg.other_spend,
  });

  // ISO week grouping
  const getISOWeek = (d: Date): number => {
    const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
    return Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  };

  const months: YearData['months'] = [];

  for (const m of sortedMonths) {
    const monthRows = byMonth.get(m)!;
    const monthAgg = sumRows(monthRows);
    const monthLabel = `${MONTHS_SHORT[m - 1]} Totals`;

    // Group into ISO weeks
    const weekMap = new Map<number, PnlRow[]>();
    for (const r of monthRows) {
      const d = new Date(r.date + 'T00:00:00');
      const wk = getISOWeek(d);
      if (!weekMap.has(wk)) weekMap.set(wk, []);
      weekMap.get(wk)!.push(r);
    }

    const sortedWeeks = Array.from(weekMap.keys()).sort((a, b) => b - a);
    const weeks: YearData['months'][0]['weeks'] = [];

    for (const wk of sortedWeeks) {
      const weekRows = weekMap.get(wk)!.sort((a, b) => b.date.localeCompare(a.date));
      const weekAgg = sumRows(weekRows);

      const firstDate = weekRows[weekRows.length - 1].date;
      const lastDate = weekRows[0].date;
      const fd = new Date(firstDate + 'T00:00:00');
      const ld = new Date(lastDate + 'T00:00:00');
      const weekLabel = `Wk ${wk} (${MONTHS_SHORT[fd.getMonth()]} ${fd.getDate()} – ${MONTHS_SHORT[ld.getMonth()]} ${ld.getDate()})`;

      const days: AggRow[] = weekRows.map((r) => {
        const d = new Date(r.date + 'T00:00:00');
        const dayLabel = `${DAYS[d.getDay()]}, ${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`;
        return toAgg('day', dayLabel, r, r.date);
      });

      weeks.push({
        summary: toAgg('week', weekLabel, weekAgg),
        days,
      });
    }

    months.push({
      summary: toAgg('month', monthLabel, monthAgg),
      weeks,
    });
  }

  const ytdAgg = sumRows(rows);
  const ytdLabel = `${year} YTD`;

  return { ytd: toAgg('ytd', ytdLabel, ytdAgg), months };
}

// ─── Formatters ─────────────────────────────────────────────────

const fmtCurrency = (v: number) => {
  const abs = Math.abs(v);
  const formatted = abs >= 1000
    ? `$${abs.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
    : `$${abs.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  return v < 0 ? `-${formatted}` : formatted;
};

const fmtNum = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 0 });
const fmtPct = (v: number) => `${v.toFixed(1)}%`;
const fmtDec = (v: number) => v.toFixed(2);

// ─── Summary Card ───────────────────────────────────────────────

// ─── Breakdown types ────────────────────────────────────────────

interface BreakdownLine {
  label: string;
  value: string;
  icon?: string;        // emoji or small text icon
  accent?: string;      // hex color override
  indent?: boolean;     // indented sub-item
  divider?: boolean;    // show divider above this line
  bold?: boolean;       // bold total line
  formula?: boolean;    // formula/result line
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
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50"
        style={{ backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
        onClick={onClose}
      />
      {/* Panel */}
      <div
        className="fixed z-50 rounded-xl overflow-hidden"
        style={{
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: '420px',
          maxWidth: 'calc(100vw - 32px)',
          maxHeight: 'calc(100vh - 64px)',
          backgroundColor: '#111',
          border: '1px solid rgba(255,255,255,0.08)',
          boxShadow: '0 32px 80px rgba(0,0,0,0.7), 0 0 1px rgba(255,255,255,0.1)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: accent }}
            />
            <span className="text-sm font-bold" style={{ color: '#F5F5F8' }}>
              {label}
            </span>
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

        {/* Hero value */}
        <div className="px-5 pt-4 pb-3">
          <div
            className="text-3xl font-extrabold tracking-tight"
            style={{ color: accent, lineHeight: 1.1 }}
          >
            {value}
          </div>
        </div>

        {/* Breakdown sections */}
        <div
          className="overflow-y-auto px-5 pb-5"
          style={{ maxHeight: 'calc(100vh - 240px)' }}
        >
          {sections.map((section, si) => (
            <div key={si} className="mb-4 last:mb-0">
              {/* Section title */}
              <div
                className="text-[9px] font-bold uppercase tracking-widest mb-2 pt-2"
                style={{
                  color: '#444',
                  letterSpacing: '0.08em',
                  borderTop: si > 0 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                }}
              >
                {section.title}
              </div>
              {/* Lines */}
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
                    {line.icon && (
                      <span className="text-xs" style={{ opacity: 0.7 }}>{line.icon}</span>
                    )}
                    <span
                      className="text-xs"
                      style={{
                        color: line.formula ? '#555' : line.bold ? '#F5F5F8' : '#888',
                        fontWeight: line.bold ? 700 : line.formula ? 500 : 500,
                        fontStyle: line.formula ? 'italic' : 'normal',
                      }}
                    >
                      {line.label}
                    </span>
                  </div>
                  <span
                    className="text-xs font-semibold tabular-nums"
                    style={{
                      color: line.accent || (line.bold ? '#F5F5F8' : '#999'),
                      fontWeight: line.bold ? 800 : 600,
                    }}
                  >
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

// ─── Metric Card ────────────────────────────────────────────────

function MetricCard({ label, value, sub, accent, negative, sections }: {
  label: string;
  value: string;
  sub?: string;
  accent?: 'gold' | 'green' | 'red' | 'purple' | 'blue';
  negative?: boolean;
  sections?: BreakdownSection[];
}) {
  const [open, setOpen] = useState(false);
  const accentColor = accent === 'gold' ? '#C8B89A'
    : accent === 'green' ? '#10B981'
    : accent === 'red' ? '#ef4444'
    : accent === 'purple' ? '#A855F7'
    : accent === 'blue' ? '#5DADE2'
    : '#F5F5F8';
  const valColor = negative ? '#ef4444' : accentColor;
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
        onMouseEnter={(e) => {
          if (hasBreakdown) e.currentTarget.style.borderColor = accentColor + '20';
        }}
        onMouseLeave={(e) => {
          if (hasBreakdown && !open) e.currentTarget.style.borderColor = 'rgba(255,255,255,0.04)';
        }}
      >
        {/* Subtle glow for hero cards */}
        {glowOpacity > 0 && (
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background: `radial-gradient(ellipse at bottom left, ${accentColor}${Math.round(glowOpacity * 255).toString(16).padStart(2, '0')}, transparent 70%)`,
            }}
          />
        )}
        <div className="flex items-center justify-between mb-2 relative">
          <div
            className="text-[9px] font-bold uppercase tracking-widest"
            style={{ color: '#555', letterSpacing: '0.08em' }}
          >
            {label}
          </div>
          {hasBreakdown && (
            <div
              className="w-4 h-4 rounded flex items-center justify-center"
              style={{ backgroundColor: 'rgba(255,255,255,0.04)' }}
            >
              <ChevronRight size={10} style={{ color: '#444' }} />
            </div>
          )}
        </div>
        <div
          className="text-xl md:text-2xl font-extrabold tracking-tight relative"
          style={{ color: valColor, lineHeight: 1.1 }}
        >
          {value}
        </div>
        {sub && (
          <div
            className="text-[10px] font-semibold mt-1.5 relative"
            style={{ color: '#444' }}
          >
            {sub}
          </div>
        )}
      </div>
      {/* Breakdown modal */}
      {open && sections && (
        <MetricBreakdown
          label={label}
          value={value}
          accent={accentColor}
          sections={sections}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

// ─── Margin Bar ─────────────────────────────────────────────────

function MarginBar({ pct }: { pct: number }) {
  const color = pct >= 25 ? '#10B981' : pct >= 15 ? '#C8B89A' : '#ef4444';
  return (
    <div className="flex items-center gap-1.5">
      <span style={{ color, fontSize: '12px', fontWeight: 600 }}>{fmtPct(pct)}</span>
      <div
        className="flex-1 h-1 rounded-full overflow-hidden"
        style={{ background: 'rgba(255,255,255,0.04)', minWidth: '32px' }}
      >
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.min(pct * 2, 100)}%`, background: color }}
        />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MAIN PAGE COMPONENT
// ═══════════════════════════════════════════════════════════════

export default function DailyPnlPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  // Auth state
  const [userRole, setUserRole] = useState<string | null>(null);
  const [userBrandId, setUserBrandId] = useState<string | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Brand state
  const [brands, setBrands] = useState<Brand[]>([]);
  const [selectedBrandId, setSelectedBrandId] = useState<string>('');
  const [fetchingBrands, setFetchingBrands] = useState(false);
  const [showBrandDropdown, setShowBrandDropdown] = useState(false);

  // Shopify / live data state
  const [shopifyConnected, setShopifyConnected] = useState(false);
  const [liveData, setLiveData] = useState<YearData | null>(null);
  const [liveDataYear, setLiveDataYear] = useState<number | null>(null);
  const [fetchingData, setFetchingData] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  // Settings state
  const [grossMargin, setGrossMargin] = useState(62);
  const [otherSpendMonth, setOtherSpendMonth] = useState('Apr 2026');
  const [otherSpendAmount, setOtherSpendAmount] = useState('0');
  const [isLocked, setIsLocked] = useState(false);
  const [offShopifyAmount, setOffShopifyAmount] = useState('0');
  const [isOffShopifyLocked, setIsOffShopifyLocked] = useState(false);
  const [merchantFeePct, setMerchantFeePct] = useState('2.9');
  const [fulfillmentPerOrder, setFulfillmentPerOrder] = useState('0');
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);

  // View state
  const [granularity, setGranularity] = useState<ViewGranularity>('Day');
  const [displayMode, setDisplayMode] = useState<DisplayMode>('Margin %');

  // Current month view
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1; // 1-indexed
  const currentMonthLabel = `${MONTHS_SHORT[currentMonth - 1]} ${currentYear}`;

  // Collapse state — expanded by default for week 0
  const [expandedWeeks, setExpandedWeeks] = useState<Set<string>>(new Set(['0-0']));

  const toggleWeek = (_monthIdx: number, weekIdx: number) => {
    const key = `0-${weekIdx}`;
    setExpandedWeeks((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // ─── Auth & Setup (admin-only) ──────────────────────────────

  useEffect(() => {
    const init = async () => {
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
      if (profile.brand_id) setUserBrandId(profile.brand_id);
      setAuthToken(session.access_token);
      setLoading(false);
    };

    init();
  }, [router, supabase]);

  // Fetch brands (admin sees all, founder sees their brand)
  useEffect(() => {
    if (!userRole || !['admin', 'founder'].includes(userRole)) return;

    const fetchBrands = async () => {
      setFetchingBrands(true);
      try {
        let query = supabase.from('brands').select('id, name, slug').is('archived_at', null).order('name');
        // Founders only see their own brand
        if (userRole === 'founder' && userBrandId) {
          query = query.eq('id', userBrandId);
        }
        const { data: allBrands } = await query;

        setBrands(allBrands || []);
        if (allBrands && allBrands.length > 0 && !selectedBrandId) {
          // Restore last-selected brand from localStorage, fallback to first
          const saved = localStorage.getItem('melch_selected_brand');
          const match = saved && allBrands.find((b: any) => b.id === saved);
          setSelectedBrandId(match ? saved : allBrands[0].id);
        }
      } catch (err) {
        console.error('Error fetching brands:', err);
      } finally {
        setFetchingBrands(false);
      }
    };

    fetchBrands();
  }, [userRole, supabase]); // eslint-disable-line react-hooks/exhaustive-deps

  const monthKey = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;

  // Fetch live P&L data + saved settings when brand or month changes
  useEffect(() => {
    if (!authToken || !selectedBrandId) return;

    const fetchPnlAndSettings = async () => {
      setFetchingData(true);
      setFetchError(null);
      try {
        // Fetch brand margin directly (not cached), P&L data, and saved settings in parallel
        const [brandRes, pnlRes, settingsRes] = await Promise.all([
          supabase
            .from('brands')
            .select('gross_margin_pct')
            .eq('id', selectedBrandId)
            .single(),
          fetch(
            `/api/shopify-sync?brand_id=${selectedBrandId}&year=${currentYear}`,
            { headers: { Authorization: `Bearer ${authToken}` } }
          ),
          fetch(
            `/api/pnl-settings?brand_id=${selectedBrandId}&month=${monthKey}`,
            { headers: { Authorization: `Bearer ${authToken}` } }
          ),
        ]);

        // Always use the brand's current margin — single source of truth
        if (brandRes.data?.gross_margin_pct != null) {
          setGrossMargin(brandRes.data.gross_margin_pct);
        }

        const pnlData = await pnlRes.json();
        const settingsData = await settingsRes.json();

        // 1. Apply Shopify data
        setShopifyConnected(pnlData.shopify_connected || false);
        if (pnlData.last_synced_at) setLastSyncedAt(pnlData.last_synced_at);

        if (pnlData.rows && pnlData.rows.length > 0) {
          const yearData = buildYearData(pnlData.rows, currentYear);
          setLiveData(yearData);
          setLiveDataYear(currentYear);
        } else {
          setLiveData(null);
          setLiveDataYear(null);
        }

        // 2. Apply saved settings — these OVERRIDE brand defaults
        if (settingsData.settings) {
          const s = settingsData.settings;
          if (s.otherSpend !== undefined) setOtherSpendAmount(String(s.otherSpend));
          if (s.otherSpendLocked !== undefined) setIsLocked(s.otherSpendLocked);
          if (s.offShopify !== undefined) setOffShopifyAmount(String(s.offShopify));
          if (s.offShopifyLocked !== undefined) setIsOffShopifyLocked(s.offShopifyLocked);
          if (s.merchantFeePct !== undefined) setMerchantFeePct(String(s.merchantFeePct));
          if (s.fulfillmentPerOrder !== undefined) setFulfillmentPerOrder(String(s.fulfillmentPerOrder));
          // grossMargin no longer read from per-month settings — always uses brand-level setting
          setSettingsSaved(true);
        } else {
          setOtherSpendAmount('0');
          setIsLocked(false);
          setOffShopifyAmount('0');
          setIsOffShopifyLocked(false);
          setSettingsSaved(false);
        }
      } catch (err: any) {
        console.error('Error fetching P&L data:', err);
        setFetchError(err?.message || 'Failed to load P&L data');
        setLiveData(null);
        setLiveDataYear(null);
      } finally {
        setFetchingData(false);
      }
    };

    fetchPnlAndSettings();
  }, [authToken, selectedBrandId, currentYear, monthKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Save P&L settings ──
  const saveSettings = useCallback(async () => {
    if (!authToken || !selectedBrandId) return;
    setSavingSettings(true);
    try {
      await fetch('/api/pnl-settings', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          brand_id: selectedBrandId,
          month: monthKey,
          settings: {
            otherSpend: otherSpendAmount,
            otherSpendLocked: isLocked,
            offShopify: offShopifyAmount,
            offShopifyLocked: isOffShopifyLocked,
            merchantFeePct: parseFloat(merchantFeePct) || 2.9,
            fulfillmentPerOrder: parseFloat(fulfillmentPerOrder) || 0,
          },
        }),
      });
      setSettingsSaved(true);
      setTimeout(() => setSettingsSaved(false), 2000);
    } catch (err) {
      console.error('Failed to save P&L settings:', err);
    } finally {
      setSavingSettings(false);
    }
  }, [authToken, selectedBrandId, monthKey, otherSpendAmount, isLocked, offShopifyAmount, isOffShopifyLocked, merchantFeePct, fulfillmentPerOrder]);

  // Sync handler — triggers Shopify order pull
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

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        setSyncResult(res.status === 504 ? 'Sync timed out — data may still be updating. Try refreshing in a moment.' : `Sync failed (${res.status}): ${text.slice(0, 100)}`);
        return;
      }
      const data = await res.json();

      if (data.success) {
        setSyncResult(`Synced ${data.orders_processed} orders → ${data.days_synced} days`);
        // Re-fetch data
        const refetch = await fetch(
          `/api/shopify-sync?brand_id=${selectedBrandId}&year=${currentYear}`,
          { headers: { Authorization: `Bearer ${authToken}` } }
        );
        const refetchData = await refetch.json();
        if (refetchData.rows && refetchData.rows.length > 0) {
          setLiveData(buildYearData(refetchData.rows, currentYear));
          setLiveDataYear(currentYear);
        }
      } else {
        setSyncResult(data.error || 'Sync failed');
      }
    } catch (err) {
      setSyncResult('Sync error — check console');
      console.error('Sync error:', err);
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncResult(null), 5000);
    }
  };

  // Expand all weeks by default when data loads
  useEffect(() => {
    const emptyYear: YearData = { ytd: mkRow('ytd', `${currentYear} YTD`, '', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0), months: [] };
    const fullYearDataTemp = (liveData && liveDataYear === currentYear)
      ? liveData
      : emptyYear;

    const monthIdx = fullYearDataTemp.months.findIndex(m =>
      m.summary.dayLabel.startsWith(MONTHS_SHORT[currentMonth - 1])
    );

    if (monthIdx >= 0) {
      const month = fullYearDataTemp.months[monthIdx];
      const allWeekKeys = new Set<string>();
      for (let wi = 0; wi < month.weeks.length; wi++) {
        allWeekKeys.add(`0-${wi}`);
      }
      setExpandedWeeks(allWeekKeys);
    }
  }, [liveData, liveDataYear, currentYear, currentMonth]);

  // ─── Derived data ─────────────────────────────────────────

  const parsedOtherSpend = useMemo(() => {
    const val = parseInt(otherSpendAmount.replace(/,/g, ''), 10);
    return isNaN(val) ? 0 : val;
  }, [otherSpendAmount]);

  const parsedOffShopify = useMemo(() => {
    const val = parseInt(offShopifyAmount.replace(/,/g, ''), 10);
    return isNaN(val) ? 0 : val;
  }, [offShopifyAmount]);

  // Calculate actual days in current month
  const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
  const dailyOtherSpend = parsedOtherSpend / daysInMonth;
  const dailyOffShopify = parsedOffShopify / daysInMonth;

  const cogsMultiplier = 1 - grossMargin / 100;
  const merchantFeePctNum = parseFloat(merchantFeePct) || 2.9;
  const fulfillmentPerOrderNum = parseFloat(fulfillmentPerOrder) || 0;

  const selectedBrand = brands.find((b) => b.id === selectedBrandId);

  // Build table rows from current month — only use live Supabase data (no placeholder fallback)
  const emptyYearData: YearData = { ytd: mkRow('ytd', `${currentYear} YTD`, '', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0), months: [] };
  const fullYearData: YearData = (liveData && liveDataYear === currentYear)
    ? liveData
    : emptyYearData;

  // Extract current month only - MTD view
  const currentMonthData = useMemo(() => {
    // Find the month matching current month in the year data
    const monthIdx = fullYearData.months.findIndex(m => {
      // Match by label - "Apr Totals" for April, etc.
      return m.summary.dayLabel.startsWith(MONTHS_SHORT[currentMonth - 1]);
    });

    if (monthIdx >= 0) {
      const month = fullYearData.months[monthIdx];
      return month;
    }

    // Fallback: use first month (or empty if no data)
    return fullYearData.months[0] || { summary: mkRow('month', `${MONTHS_SHORT[currentMonth - 1]} Totals`, '', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0), weeks: [] };
  }, [fullYearData, currentMonth]);

  // Apply other spend distribution when locked
  // Each day gets dailyOtherSpend, weeks sum their days, MTD gets full amount
  const applyOverrides = (row: AggRow, type: 'day' | 'week' | 'mtd', dayCount?: number): AggRow => {
    let result = { ...row };
    // Other spend
    if (isLocked && parsedOtherSpend > 0) {
      let otherAdd = 0;
      if (type === 'day') otherAdd = dailyOtherSpend;
      else if (type === 'week') otherAdd = (dayCount || 0) * dailyOtherSpend;
      else otherAdd = parsedOtherSpend;
      result = { ...result, otherSpend: result.otherSpend + otherAdd };
    }
    // Off-Shopify revenue (Amazon, Retail, etc.)
    if (isOffShopifyLocked && parsedOffShopify > 0) {
      let offAdd = 0;
      if (type === 'day') offAdd = dailyOffShopify;
      else if (type === 'week') offAdd = (dayCount || 0) * dailyOffShopify;
      else offAdd = parsedOffShopify;
      result = { ...result, offShopifyRevenue: result.offShopifyRevenue + offAdd };
    }
    return result;
  };

  // MTD summary row
  const totalDaysInData = currentMonthData.weeks.reduce((sum, w) => sum + w.days.length, 0);
  const mtdRow: AggRow = applyOverrides(
    { ...currentMonthData.summary, rowType: 'ytd', dayLabel: `${MONTHS_SHORT[currentMonth - 1]} MTD` },
    'mtd',
    totalDaysInData
  );
  const mtdCalc = calcFields(mtdRow, grossMargin, merchantFeePctNum, fulfillmentPerOrderNum);

  interface DisplayRow extends AggRow {
    id: string;
    monthIdx?: number;
    weekIdx?: number;
    isExpandable?: boolean;
    isExpanded?: boolean;
    hasChildren?: boolean;
    depth: number;
  }

  const tableRows: DisplayRow[] = useMemo(() => {
    const rows: DisplayRow[] = [];

    // MTD row always visible
    rows.push({ ...mtdRow, id: 'mtd', depth: 0 });

    // Weeks under MTD
    if (granularity === 'Week') {
      for (let wi = 0; wi < currentMonthData.weeks.length; wi++) {
        const week = currentMonthData.weeks[wi];
        const weekWithOther = applyOverrides(week.summary, 'week', week.days.length);
        rows.push({
          ...weekWithOther,
          id: `w-${wi}`,
          weekIdx: wi,
          depth: 1,
          isExpandable: false,
          hasChildren: false,
        });
      }
      return rows;
    }

    // Day granularity: weeks are collapsible, days visible when expanded
    for (let wi = 0; wi < currentMonthData.weeks.length; wi++) {
      const week = currentMonthData.weeks[wi];
      const weekKey = `0-${wi}`;
      const weekExpanded = expandedWeeks.has(weekKey);
      const hasDays = week.days.length > 0;
      const weekWithOther = applyOverrides(week.summary, 'week', week.days.length);

      rows.push({
        ...weekWithOther,
        id: `w-${wi}`,
        monthIdx: 0,
        weekIdx: wi,
        depth: 1,
        isExpandable: hasDays,
        isExpanded: weekExpanded,
        hasChildren: hasDays,
      });

      if (!weekExpanded || !hasDays) continue;

      for (let di = 0; di < week.days.length; di++) {
        const dayWithOther = applyOverrides(week.days[di], 'day');
        rows.push({
          ...dayWithOther,
          id: `d-${wi}-${di}`,
          depth: 2,
        });
      }
    }

    return rows;
  }, [mtdRow, currentMonthData, granularity, expandedWeeks, isLocked, parsedOtherSpend, dailyOtherSpend, isOffShopifyLocked, parsedOffShopify, dailyOffShopify]);

  // ─── CSV Export ──────────────────────────────────────

  const handleExportCSV = () => {
    if (!tableRows.length) return;
    const headers = [
      'Date', 'NC Orders', 'NC Revenue', 'RC Orders', 'RC Revenue',
      'Gross Sales', 'Discounts', 'Refunds', 'Taxes', 'Shipping',
      'Off-Shopify', 'Net Revenue', 'Meta Spend', 'Google Spend',
      'Other Spend', 'Total Spend', 'COGS', 'Contribution', 'Margin %',
      'NC AOV', 'CAC', 'AMER', 'MER',
    ];
    const csvCalcRow = (r: DisplayRow) => {
      const c = calcFields(r, grossMargin, merchantFeePctNum, fulfillmentPerOrderNum);
      return [
        r.dayLabel,
        r.ncOrders, r.ncRevenue.toFixed(2), r.rcOrders, r.rcRevenue.toFixed(2),
        r.grossSales.toFixed(2), r.discounts.toFixed(2), r.refunds.toFixed(2),
        r.taxes.toFixed(2), r.shipping.toFixed(2),
        r.offShopifyRevenue.toFixed(2), c.netRevenue.toFixed(2),
        r.metaSpend.toFixed(2), r.googleSpend.toFixed(2),
        r.otherSpend.toFixed(2), c.totalSpend.toFixed(2),
        c.cogs.toFixed(2), c.contribution.toFixed(2),
        c.marginPct.toFixed(2),
        c.ncAov.toFixed(2), c.cac.toFixed(2),
        c.amer.toFixed(2), c.mer.toFixed(2),
      ];
    };
    // Always export all daily rows regardless of current view mode
    const allDays: DisplayRow[] = [];
    if (currentMonthData) {
      for (const week of currentMonthData.weeks) {
        for (const day of week.days) {
          allDays.push(day as DisplayRow);
        }
      }
    }
    const exportRows = allDays.length > 0 ? allDays : tableRows;
    const csvRows = [headers, ...exportRows.map(csvCalcRow)];
    const csvContent = '\uFEFF' + csvRows.map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const brandSlug = selectedBrand?.name?.toLowerCase().replace(/\s+/g, '-') || 'pnl';
    a.href = url;
    a.download = `${brandSlug}-pnl-${MONTHS_SHORT[currentMonth - 1].toLowerCase()}-${currentYear}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ─── Preset buttons ──────────────────────────────────────


  // ─── Loading state ────────────────────────────────────────

  if (loading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ backgroundColor: '#0A0A0A' }}
      >
        <Loader
          size={32}
          className="animate-spin"
          style={{ color: '#C8B89A' }}
        />
      </div>
    );
  }

  // ═══ Row style helpers ═══

  const rowBg = (type: RowType) => {
    switch (type) {
      case 'ytd': return 'rgba(200,184,154,0.08)';
      case 'month': return 'rgba(200,184,154,0.06)';
      case 'week': return 'rgba(200,184,154,0.04)';
      default: return 'transparent';
    }
  };

  const rowBorder = (type: RowType) => {
    if (type === 'ytd' || type === 'month') return '2px solid rgba(200,184,154,0.12)';
    return '1px solid rgba(255,255,255,0.04)';
  };

  const dateCellStyle = (type: RowType): React.CSSProperties => {
    switch (type) {
      case 'ytd': return { color: '#C8B89A', fontWeight: 800, fontSize: '13px' };
      case 'month': return { color: '#C8B89A', fontWeight: 800 };
      case 'week': return { color: '#C8B89A', fontWeight: 700 };
      default: return { color: '#999', fontWeight: 500, paddingLeft: '28px' };
    }
  };

  const cellStyle = (type: RowType): React.CSSProperties => {
    switch (type) {
      case 'ytd': return { color: '#C8B89A', fontWeight: 800, fontSize: '13px' };
      case 'month': return { color: '#F5F5F8', fontWeight: 800 };
      case 'week': return { color: '#F5F5F8', fontWeight: 700 };
      default: return {};
    }
  };

  // ═══ RENDER ═══

  return (
    <Navbar>
      <div className="flex flex-col h-screen" style={{ backgroundColor: '#0A0A0A' }}>
        {/* ─── HEADER ─── */}
        <div
          className="flex-shrink-0 px-5 md:px-7 pt-5 pb-4"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}
        >
          {/* Row 1: Title + Brand + Sync */}
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
                <DollarSign size={15} />
              </span>
              <div>
                <h1 className="text-base md:text-lg font-extrabold tracking-tight flex items-center gap-2" style={{ color: '#F5F5F8' }}>
                  Daily P&L
                </h1>
                <p className="text-[11px] mt-0.5" style={{ color: '#444' }}>
                  {selectedBrand ? `${selectedBrand.name}` : 'Select a brand'} — Revenue, spend & margin
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              {/* Sync status + button */}
              <div className="flex items-center gap-2">
                {shopifyConnected ? (
                  <>
                    <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md" style={{ background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.1)' }}>
                      <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: '#10B981' }} />
                      <span className="text-[10px] font-semibold" style={{ color: '#10B981' }}>Connected</span>
                    </div>
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
                  </>
                ) : (
                  <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)' }}>
                    <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: '#555' }} />
                    <span className="text-[10px] font-medium" style={{ color: '#555' }}>Not connected</span>
                  </div>
                )}
                {syncResult && (
                  <span className="text-[10px] font-semibold" style={{ color: syncResult.includes('Synced') ? '#10B981' : '#ef4444' }}>
                    {syncResult}
                  </span>
                )}
                {lastSyncedAt && !syncResult && (
                  <span className="text-[10px]" style={{ color: '#555' }}>
                    Synced {(() => {
                      const mins = Math.floor((Date.now() - new Date(lastSyncedAt).getTime()) / 60000);
                      if (mins < 1) return 'just now';
                      if (mins < 60) return `${mins}m ago`;
                      const hrs = Math.floor(mins / 60);
                      if (hrs < 24) return `${hrs}h ago`;
                      return `${Math.floor(hrs / 24)}d ago`;
                    })()}
                  </span>
                )}
                {fetchingData && (
                  <Loader size={12} className="animate-spin" style={{ color: '#C8B89A' }} />
                )}
              </div>

              {/* Divider */}
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
                    style={{
                      backgroundColor: '#111',
                      border: '1px solid rgba(255,255,255,0.08)',
                      boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
                    }}
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
                        {brand.id === selectedBrandId && <Check size={14} style={{ color: '#C8B89A' }} />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Row 2: Unified Controls Pill */}
          <div
            className="rounded-xl px-4 py-3"
            style={{
              background: 'linear-gradient(135deg, rgba(200,184,154,0.025), rgba(200,184,154,0.005))',
              border: '1px solid rgba(200,184,154,0.08)',
            }}
          >
            <div className="flex items-center justify-between flex-wrap gap-y-2.5 gap-x-1">
              {/* ── Left: Inputs ── */}
              <div className="flex items-center flex-wrap gap-x-1 gap-y-2">

                {/* Margin (read-only — set on Team page) */}
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{ background: 'rgba(255,255,255,0.02)' }}>
                  <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#555' }}>Margin</span>
                  <span className="text-sm font-bold" style={{ color: '#C8B89A' }}>{grossMargin}%</span>
                  <span className="text-[10px]" style={{ color: '#444' }}>
                    COGS {100 - grossMargin}%
                  </span>
                </div>

                {/* Divider */}
                <div className="w-px h-5 mx-1 hidden md:block" style={{ background: 'rgba(255,255,255,0.06)' }} />

                {/* Other Spend */}
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{ background: 'rgba(255,255,255,0.02)' }}>
                  <span className="text-[10px] font-bold uppercase tracking-wider whitespace-nowrap" style={{ color: '#555' }}>Other Spend</span>
                  <div className="flex items-center rounded-md" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(200,184,154,0.12)' }}>
                    <span className="text-sm font-bold pl-2" style={{ color: '#C8B89A' }}>$</span>
                    <input
                      type="text"
                      value={otherSpendAmount}
                      onChange={(e) => setOtherSpendAmount(e.target.value)}
                      className="w-[56px] px-1 py-1 bg-transparent border-none text-sm font-bold text-right outline-none"
                      style={{ color: '#C8B89A' }}
                      placeholder="0"
                    />
                  </div>
                  <span className="text-[10px] hidden 2xl:inline" style={{ color: '#444' }}>
                    <strong style={{ color: '#666' }}>${Math.round(dailyOtherSpend)}</strong>/day
                  </span>
                  <button
                    onClick={() => setIsLocked(!isLocked)}
                    className="flex items-center gap-1 select-none rounded-md px-1.5 py-1 transition-all"
                    style={{
                      background: isLocked ? 'rgba(16,185,129,0.08)' : 'rgba(255,255,255,0.03)',
                      border: `1px solid ${isLocked ? 'rgba(16,185,129,0.12)' : 'rgba(255,255,255,0.04)'}`,
                    }}
                  >
                    <Lock size={10} style={{ color: isLocked ? '#10B981' : '#555' }} />
                    <span className="text-[10px] font-semibold" style={{ color: isLocked ? '#10B981' : '#555' }}>
                      {isLocked ? 'On' : 'Off'}
                    </span>
                  </button>
                </div>

                {/* Divider */}
                <div className="w-px h-5 mx-1 hidden md:block" style={{ background: 'rgba(255,255,255,0.06)' }} />

                {/* Off-Shopify */}
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{ background: 'rgba(255,255,255,0.02)' }}>
                  <span className="text-[10px] font-bold uppercase tracking-wider whitespace-nowrap" style={{ color: '#555' }}>Off-Shopify</span>
                  <div className="flex items-center rounded-md" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(168,85,247,0.12)' }}>
                    <span className="text-sm font-bold pl-2" style={{ color: '#A855F7' }}>$</span>
                    <input
                      type="text"
                      value={offShopifyAmount}
                      onChange={(e) => setOffShopifyAmount(e.target.value)}
                      className="w-[56px] px-1 py-1 bg-transparent border-none text-sm font-bold text-right outline-none"
                      style={{ color: '#A855F7' }}
                      placeholder="0"
                    />
                  </div>
                  <span className="text-[10px] hidden 2xl:inline" style={{ color: '#444' }}>
                    <strong style={{ color: '#666' }}>${Math.round(dailyOffShopify)}</strong>/day
                  </span>
                  <button
                    onClick={() => setIsOffShopifyLocked(!isOffShopifyLocked)}
                    className="flex items-center gap-1 select-none rounded-md px-1.5 py-1 transition-all"
                    style={{
                      background: isOffShopifyLocked ? 'rgba(168,85,247,0.08)' : 'rgba(255,255,255,0.03)',
                      border: `1px solid ${isOffShopifyLocked ? 'rgba(168,85,247,0.12)' : 'rgba(255,255,255,0.04)'}`,
                    }}
                  >
                    <Lock size={10} style={{ color: isOffShopifyLocked ? '#A855F7' : '#555' }} />
                    <span className="text-[10px] font-semibold" style={{ color: isOffShopifyLocked ? '#A855F7' : '#555' }}>
                      {isOffShopifyLocked ? 'On' : 'Off'}
                    </span>
                  </button>
                </div>

                {/* Divider */}
                <div className="w-px h-5 mx-1 hidden md:block" style={{ background: 'rgba(255,255,255,0.06)' }} />

                {/* Merchant Fee % */}
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{ background: 'rgba(255,255,255,0.02)' }}>
                  <span className="text-[10px] font-bold uppercase tracking-wider whitespace-nowrap" style={{ color: '#555' }}>Merchant %</span>
                  <div className="flex items-center rounded-md" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(200,184,154,0.12)' }}>
                    <input
                      type="text"
                      value={merchantFeePct}
                      onChange={(e) => setMerchantFeePct(e.target.value)}
                      className="w-[45px] px-1 py-1 bg-transparent border-none text-sm font-bold text-center outline-none"
                      style={{ color: '#C8B89A' }}
                      placeholder="2.9"
                    />
                  </div>
                  <span className="text-[10px]" style={{ color: '#444' }}>%</span>
                </div>

                <div className="w-px h-5 mx-1 hidden md:block" style={{ background: 'rgba(255,255,255,0.06)' }} />

                {/* Fulfillment $/order */}
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{ background: 'rgba(255,255,255,0.02)' }}>
                  <span className="text-[10px] font-bold uppercase tracking-wider whitespace-nowrap" style={{ color: '#555' }}>Fulfill/ord</span>
                  <div className="flex items-center rounded-md" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(200,184,154,0.12)' }}>
                    <span className="text-sm font-bold pl-2" style={{ color: '#C8B89A' }}>$</span>
                    <input
                      type="text"
                      value={fulfillmentPerOrder}
                      onChange={(e) => setFulfillmentPerOrder(e.target.value)}
                      className="w-[40px] px-1 py-1 bg-transparent border-none text-sm font-bold text-right outline-none"
                      style={{ color: '#C8B89A' }}
                      placeholder="0"
                    />
                  </div>
                </div>

                {/* Divider */}
                <div className="w-px h-5 mx-1 hidden md:block" style={{ background: 'rgba(255,255,255,0.06)' }} />

                {/* Save Settings */}
                <button
                  onClick={saveSettings}
                  disabled={savingSettings}
                  className="flex items-center gap-1.5 select-none rounded-md px-2.5 py-1.5 transition-all"
                  style={{
                    background: settingsSaved ? 'rgba(16,185,129,0.08)' : 'rgba(200,184,154,0.08)',
                    border: `1px solid ${settingsSaved ? 'rgba(16,185,129,0.15)' : 'rgba(200,184,154,0.12)'}`,
                  }}
                >
                  {settingsSaved ? (
                    <Check size={11} style={{ color: '#10B981' }} />
                  ) : (
                    <Save size={11} style={{ color: '#C8B89A' }} />
                  )}
                  <span className="text-[10px] font-semibold" style={{ color: settingsSaved ? '#10B981' : '#C8B89A' }}>
                    {savingSettings ? 'Saving...' : settingsSaved ? 'Saved' : 'Save'}
                  </span>
                </button>
              </div>

              {/* ── Right: View controls ── */}
              <div className="flex items-center gap-2">
                <div
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg"
                  style={{ background: 'rgba(200,184,154,0.06)', border: '1px solid rgba(200,184,154,0.08)' }}
                >
                  <Calendar size={11} style={{ color: '#C8B89A' }} />
                  <span className="text-[11px] font-bold" style={{ color: '#C8B89A' }}>
                    {MONTHS_SHORT[currentMonth - 1]} {currentYear}
                  </span>
                </div>
                <div
                  className="flex rounded-lg overflow-hidden"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}
                >
                  {(['Day', 'Week'] as ViewGranularity[]).map((g, i, arr) => (
                    <button
                      key={g}
                      onClick={() => setGranularity(g)}
                      className="px-3 py-1.5 text-[11px] font-semibold transition-all"
                      style={{
                        backgroundColor: granularity === g ? 'rgba(200,184,154,0.1)' : 'transparent',
                        color: granularity === g ? '#C8B89A' : '#555',
                        borderRight: i < arr.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                      }}
                    >
                      {g}
                    </button>
                  ))}
                </div>
                <button
                  title="Export CSV"
                  onClick={handleExportCSV}
                  className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors flex-shrink-0"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)', color: '#555' }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = '#C8B89A'; e.currentTarget.style.borderColor = 'rgba(200,184,154,0.12)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = '#555'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)'; }}
                >
                  <Download size={12} />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* ─── METRICS SHOWCASE ─── */}
        <div
          className="flex-shrink-0 px-5 md:px-7 py-4"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}
        >
          {/* Row 1 — Revenue & Profitability (5 cards) */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2 mb-2">
            <MetricCard
              label="Total Net Revenue"
              value={fmtCurrency(mtdCalc.netRevenue)}
              sub={`${MONTHS_SHORT[currentMonth - 1]} MTD — All Channels`}
              accent="gold"
              sections={[
                {
                  title: 'Revenue Breakdown',
                  lines: [
                    { label: 'Shopify Net Revenue', value: fmtCurrency(mtdCalc.netRevenue - mtdRow.offShopifyRevenue), icon: '🛍', bold: true },
                    { label: 'Gross Sales', value: fmtCurrency(mtdRow.grossSales), indent: true },
                    { label: 'Discounts', value: fmtCurrency(mtdRow.discounts), indent: true, accent: mtdRow.discounts < 0 ? '#ef4444' : undefined },
                    { label: 'Refunds', value: fmtCurrency(mtdRow.refunds), indent: true, accent: mtdRow.refunds < 0 ? '#ef4444' : undefined },
                    { label: 'Taxes', value: `−${fmtCurrency(mtdRow.taxes)}`, indent: true },
                    { label: 'Shipping', value: fmtCurrency(mtdRow.shipping), indent: true },
                    { label: 'Off-Shopify Revenue', value: fmtCurrency(mtdRow.offShopifyRevenue), icon: '📦', bold: true, divider: true, accent: mtdRow.offShopifyRevenue > 0 ? '#A855F7' : undefined },
                    { label: 'Total Net Revenue', value: fmtCurrency(mtdCalc.netRevenue), divider: true, bold: true, accent: '#C8B89A' },
                  ],
                },
                {
                  title: 'Formula',
                  lines: [
                    { label: 'Gross Sales + Discounts + Refunds − Taxes + Shipping + Off-Shopify', value: '', formula: true },
                  ],
                },
              ]}
            />
            <MetricCard
              label="Shopify Revenue"
              value={fmtCurrency(mtdCalc.netRevenue - mtdRow.offShopifyRevenue)}
              sub="DTC Only"
              sections={[
                {
                  title: 'Shopify Revenue Breakdown',
                  lines: [
                    { label: 'NC Net Revenue', value: fmtCurrency(mtdCalc.ncNetRevenue), icon: '🆕', accent: '#5DADE2' },
                    { label: 'RC Net Revenue', value: fmtCurrency(mtdCalc.rcNetRevenue), icon: '🔄' },
                    { label: 'Shopify Net Revenue', value: fmtCurrency(mtdCalc.netRevenue - mtdRow.offShopifyRevenue), divider: true, bold: true },
                  ],
                },
                {
                  title: 'Components',
                  lines: [
                    { label: 'Gross Sales', value: fmtCurrency(mtdRow.grossSales) },
                    { label: 'Discounts', value: fmtCurrency(mtdRow.discounts), accent: mtdRow.discounts < 0 ? '#ef4444' : undefined },
                    { label: 'Refunds', value: fmtCurrency(mtdRow.refunds), accent: mtdRow.refunds < 0 ? '#ef4444' : undefined },
                    { label: 'Taxes', value: `−${fmtCurrency(mtdRow.taxes)}` },
                    { label: 'Shipping', value: fmtCurrency(mtdRow.shipping) },
                  ],
                },
              ]}
            />
            <MetricCard
              label="Off-Shopify Revenue"
              value={fmtCurrency(mtdRow.offShopifyRevenue)}
              sub="Amazon + Retail"
              accent={mtdRow.offShopifyRevenue > 0 ? 'purple' : undefined}
              sections={[
                {
                  title: 'Off-Shopify Breakdown',
                  lines: [
                    { label: 'Monthly Input', value: `$${offShopifyAmount}`, icon: '📊', accent: '#A855F7' },
                    { label: 'Daily Distribution', value: `$${Math.round(dailyOffShopify)}/day`, indent: true },
                    { label: `Days in ${MONTHS_SHORT[currentMonth - 1]}`, value: `${daysInMonth}`, indent: true },
                    { label: isOffShopifyLocked ? 'Status: Locked ✓' : 'Status: Unlocked', value: '', accent: isOffShopifyLocked ? '#A855F7' : '#555', divider: true },
                  ],
                },
                {
                  title: 'Note',
                  lines: [
                    { label: 'Input fully loaded net revenue (after fees, COGS, etc.)', value: '', formula: true },
                  ],
                },
              ]}
            />
            <MetricCard
              label="Contribution"
              value={fmtCurrency(mtdCalc.contribution)}
              sub={`${fmtPct(mtdCalc.marginPct)} margin`}
              accent={mtdCalc.contribution >= 0 ? 'green' : 'red'}
              negative={mtdCalc.contribution < 0}
              sections={[
                {
                  title: 'Contribution Breakdown',
                  lines: [
                    { label: 'Net Revenue', value: fmtCurrency(mtdCalc.netRevenue), icon: '💰', accent: '#C8B89A' },
                    { label: `COGS (${100 - grossMargin}% of revenue)`, value: `−${fmtCurrency(mtdCalc.cogs)}`, icon: '📦', accent: '#ef4444' },
                    { label: 'Total Ad Spend', value: `−${fmtCurrency(mtdCalc.totalSpend)}`, icon: '📣', accent: '#ef4444' },
                    { label: 'Contribution', value: fmtCurrency(mtdCalc.contribution), divider: true, bold: true, accent: mtdCalc.contribution >= 0 ? '#10B981' : '#ef4444' },
                  ],
                },
                {
                  title: 'Margin',
                  lines: [
                    { label: 'Contribution Margin %', value: fmtPct(mtdCalc.marginPct), accent: mtdCalc.marginPct >= 15 ? '#10B981' : '#ef4444', bold: true },
                    { label: 'Contribution ÷ Net Revenue × 100', value: '', formula: true },
                  ],
                },
              ]}
            />
            <MetricCard
              label="Total Ad Spend"
              value={fmtCurrency(mtdCalc.totalSpend)}
              sub={`Meta ${fmtCurrency(mtdRow.metaSpend)} · Google ${fmtCurrency(mtdRow.googleSpend)}`}
              sections={[
                {
                  title: 'Blended Ad Spend',
                  lines: [
                    { label: 'Meta Ads', value: fmtCurrency(mtdRow.metaSpend), icon: '🔵', accent: '#5DADE2' },
                    { label: 'Google Ads', value: fmtCurrency(mtdRow.googleSpend), icon: '🟡' },
                    { label: `Other Spend${isLocked ? ' (locked)' : ''}`, value: fmtCurrency(mtdRow.otherSpend), icon: '🔧', accent: isLocked ? '#10B981' : undefined },
                    { label: 'Total Ad Spend', value: fmtCurrency(mtdCalc.totalSpend), divider: true, bold: true },
                  ],
                },
                {
                  title: 'Channel Mix',
                  lines: [
                    { label: 'Meta', value: mtdCalc.totalSpend > 0 ? fmtPct(mtdRow.metaSpend / mtdCalc.totalSpend * 100) : '0%' },
                    { label: 'Google', value: mtdCalc.totalSpend > 0 ? fmtPct(mtdRow.googleSpend / mtdCalc.totalSpend * 100) : '0%' },
                    { label: 'Other', value: mtdCalc.totalSpend > 0 ? fmtPct(mtdRow.otherSpend / mtdCalc.totalSpend * 100) : '0%' },
                  ],
                },
              ]}
            />
          </div>
          {/* Row 2 — Efficiency & Acquisition (5 cards) */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
            <MetricCard
              label="Blended MER"
              value={`${fmtDec(mtdCalc.mer)}x`}
              sub="Net Revenue ÷ Ad Spend"
              accent="gold"
              sections={[
                {
                  title: 'Blended MER Calculation',
                  lines: [
                    { label: 'Net Revenue (all channels)', value: fmtCurrency(mtdCalc.netRevenue), icon: '💰', accent: '#C8B89A' },
                    { label: 'Total Ad Spend', value: fmtCurrency(mtdCalc.totalSpend), icon: '📣' },
                    { label: 'Blended MER', value: `${fmtDec(mtdCalc.mer)}x`, divider: true, bold: true, accent: '#C8B89A' },
                  ],
                },
                {
                  title: 'Formula',
                  lines: [
                    { label: 'Net Revenue ÷ Total Ad Spend', value: '', formula: true },
                  ],
                },
                {
                  title: 'Revenue Sources',
                  lines: [
                    { label: 'Shopify Net', value: fmtCurrency(mtdCalc.netRevenue - mtdRow.offShopifyRevenue), indent: true },
                    { label: 'Off-Shopify', value: fmtCurrency(mtdRow.offShopifyRevenue), indent: true, accent: mtdRow.offShopifyRevenue > 0 ? '#A855F7' : undefined },
                  ],
                },
              ]}
            />
            <MetricCard
              label="AMER"
              value={`${fmtDec(mtdCalc.amer)}x`}
              sub="NC Revenue ÷ Ad Spend"
              accent="blue"
              sections={[
                {
                  title: 'Acquisition MER',
                  lines: [
                    { label: 'NC Net Revenue', value: fmtCurrency(mtdCalc.ncNetRevenue), icon: '🆕', accent: '#5DADE2' },
                    { label: 'Total Ad Spend', value: fmtCurrency(mtdCalc.totalSpend), icon: '📣' },
                    { label: 'AMER', value: `${fmtDec(mtdCalc.amer)}x`, divider: true, bold: true, accent: '#5DADE2' },
                  ],
                },
                {
                  title: 'Formula',
                  lines: [
                    { label: 'NC Net Revenue ÷ Total Ad Spend', value: '', formula: true },
                    { label: 'Shopify-attributed only (off-Shopify excluded)', value: '', formula: true },
                  ],
                },
              ]}
            />
            <MetricCard
              label="CAC"
              value={`$${mtdCalc.cac.toFixed(2)}`}
              sub={`${fmtNum(mtdRow.ncOrders)} new customers`}
              sections={[
                {
                  title: 'Customer Acquisition Cost',
                  lines: [
                    { label: 'Total Ad Spend', value: fmtCurrency(mtdCalc.totalSpend), icon: '📣' },
                    { label: 'NC Orders', value: fmtNum(mtdRow.ncOrders), icon: '🆕' },
                    { label: 'CAC', value: `$${mtdCalc.cac.toFixed(2)}`, divider: true, bold: true },
                  ],
                },
                {
                  title: 'Formula',
                  lines: [
                    { label: 'Total Ad Spend ÷ NC Orders', value: '', formula: true },
                  ],
                },
              ]}
            />
            <MetricCard
              label="NC AOV"
              value={`$${mtdCalc.ncAov.toFixed(2)}`}
              sub={`${fmtNum(mtdRow.ncOrders)} NC · ${fmtNum(mtdRow.rcOrders)} RC orders`}
              sections={[
                {
                  title: 'New Customer AOV',
                  lines: [
                    { label: 'NC Net Revenue', value: fmtCurrency(mtdCalc.ncNetRevenue), icon: '🆕', accent: '#5DADE2' },
                    { label: 'NC Orders', value: fmtNum(mtdRow.ncOrders) },
                    { label: 'NC AOV', value: `$${mtdCalc.ncAov.toFixed(2)}`, divider: true, bold: true },
                  ],
                },
                {
                  title: 'Formula',
                  lines: [
                    { label: 'NC Net Revenue ÷ NC Orders', value: '', formula: true },
                  ],
                },
                {
                  title: 'Comparison',
                  lines: [
                    { label: 'RC AOV', value: mtdRow.rcOrders > 0 ? `$${(mtdCalc.rcNetRevenue / mtdRow.rcOrders).toFixed(2)}` : '—' },
                    { label: 'Blended AOV', value: (mtdRow.ncOrders + mtdRow.rcOrders) > 0 ? `$${((mtdCalc.netRevenue - mtdRow.offShopifyRevenue) / (mtdRow.ncOrders + mtdRow.rcOrders)).toFixed(2)}` : '—' },
                  ],
                },
              ]}
            />
            <MetricCard
              label="Total Orders"
              value={fmtNum(mtdRow.ncOrders + mtdRow.rcOrders)}
              sub={`${fmtNum(mtdRow.ncOrders)} NC · ${fmtNum(mtdRow.rcOrders)} RC`}
              sections={[
                {
                  title: 'Order Breakdown',
                  lines: [
                    { label: 'New Customer Orders', value: fmtNum(mtdRow.ncOrders), icon: '🆕', accent: '#5DADE2' },
                    { label: 'Returning Customer Orders', value: fmtNum(mtdRow.rcOrders), icon: '🔄' },
                    { label: 'Total Shopify Orders', value: fmtNum(mtdRow.ncOrders + mtdRow.rcOrders), divider: true, bold: true },
                  ],
                },
                {
                  title: 'NC / RC Split',
                  lines: [
                    { label: 'NC %', value: (mtdRow.ncOrders + mtdRow.rcOrders) > 0 ? fmtPct(mtdRow.ncOrders / (mtdRow.ncOrders + mtdRow.rcOrders) * 100) : '0%', accent: '#5DADE2' },
                    { label: 'RC %', value: (mtdRow.ncOrders + mtdRow.rcOrders) > 0 ? fmtPct(mtdRow.rcOrders / (mtdRow.ncOrders + mtdRow.rcOrders) * 100) : '0%' },
                  ],
                },
              ]}
            />
          </div>
        </div>

        {/* Error banner */}
        {fetchError && (
          <div className="flex-shrink-0 mx-5 mb-3 px-4 py-3 rounded-lg flex items-center gap-3"
            style={{ backgroundColor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
            <span className="text-xs text-red-400 flex-1">{fetchError}</span>
            <button onClick={() => { setFetchError(null); setFetchingData(true); }}
              className="text-xs font-medium px-3 py-1 rounded-md"
              style={{ backgroundColor: 'rgba(239,68,68,0.15)', color: '#ef4444' }}>
              Retry
            </button>
          </div>
        )}

        {/* ─── DATA TABLE ─── */}
        <div className="flex-1 overflow-auto relative">
          <table className="w-full border-collapse text-xs" style={{ minWidth: '1600px' }}>
            <thead>
              <tr>
                {/* Frozen Date column — sticky left + top */}
                <th
                  className="sticky top-0 left-0 z-20 px-3.5 py-2.5 text-[10px] font-bold uppercase tracking-wider whitespace-nowrap"
                  style={{
                    backgroundColor: '#0e0e0e',
                    textAlign: 'left',
                    color: '#555',
                    borderBottom: '1px solid rgba(255,255,255,0.08)',
                    borderRight: '1px solid rgba(255,255,255,0.06)',
                    minWidth: '160px',
                    boxShadow: '4px 0 8px -2px rgba(0,0,0,0.4)',
                  }}
                >
                  Date
                </th>
                {[
                  { label: 'NC Orders' },
                  { label: 'NC Revenue', calc: true },
                  { label: 'RC Orders' },
                  { label: 'RC Revenue', calc: true },
                  { label: 'Gross Sales' },
                  { label: 'Discounts' },
                  { label: 'Refunds' },
                  { label: 'Taxes' },
                  { label: 'Shipping' },
                  { label: 'Off-Shopify', locked: true },
                  { label: 'Net Revenue', sorted: true, calc: true },
                  { label: 'Meta' },
                  { label: 'Google' },
                  { label: 'Other', locked: true },
                  { label: 'Total Spend', calc: true },
                  { label: 'COGS', calc: true },
                  { label: 'Contribution', calc: true },
                  { label: 'Margin %', calc: true },
                  { label: 'NC AOV', calc: true },
                  { label: 'CAC', calc: true },
                  { label: 'AMER', calc: true },
                  { label: 'MER', calc: true },
                ].map((col) => (
                  <th
                    key={col.label}
                    className="sticky top-0 z-10 px-3.5 py-2.5 text-[10px] font-bold uppercase tracking-wider whitespace-nowrap cursor-pointer"
                    style={{
                      backgroundColor: '#0e0e0e',
                      textAlign: 'right',
                      color: col.sorted ? '#C8B89A' : '#555',
                      borderBottom: '1px solid rgba(255,255,255,0.08)',
                    }}
                  >
                    <span className="inline-flex items-center gap-1">
                      {col.label}
                      {col.calc && (
                        <span
                          className="text-[8px] font-bold px-1 py-0.5 rounded"
                          style={{
                            background: 'rgba(93,173,226,0.08)',
                            color: '#5DADE2',
                            letterSpacing: '0.03em',
                          }}
                          title={
                            col.label === 'NC Revenue' ? 'NC Gross × (Net Revenue ÷ Gross Sales)' :
                            col.label === 'RC Revenue' ? 'RC Gross × (Net Revenue ÷ Gross Sales)' :
                            col.label === 'Net Revenue' ? 'Gross Sales + Discounts + Refunds − Taxes + Shipping' :
                            col.label === 'Total Spend' ? 'Meta + Google + Other' :
                            col.label === 'COGS' ? 'Net Revenue × (1 − Margin%)' :
                            col.label === 'Contribution' ? 'Net Revenue − COGS − Total Spend' :
                            col.label === 'Margin %' ? 'Contribution ÷ Net Revenue' :
                            col.label === 'NC AOV' ? 'NC Revenue ÷ NC Orders' :
                            col.label === 'CAC' ? 'Total Spend ÷ NC Orders' :
                            col.label === 'AMER' ? 'NC Revenue ÷ Total Spend' :
                            col.label === 'MER' ? 'Net Revenue ÷ Total Spend' : ''
                          }
                        >
                          fx
                        </span>
                      )}
                      {col.locked && col.label === 'Other' && isLocked && (
                        <span
                          className="inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded"
                          style={{
                            background: 'rgba(16,185,129,0.08)',
                            color: '#10B981',
                            letterSpacing: '0.03em',
                          }}
                        >
                          <Lock size={8} /> Locked
                        </span>
                      )}
                      {col.locked && col.label === 'Off-Shopify' && isOffShopifyLocked && (
                        <span
                          className="inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded"
                          style={{
                            background: 'rgba(168,85,247,0.08)',
                            color: '#A855F7',
                            letterSpacing: '0.03em',
                          }}
                        >
                          <Lock size={8} /> Locked
                        </span>
                      )}
                      {col.sorted && <span className="text-[8px]"> ↓</span>}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableRows.map((row) => {
                const rt = row.rowType;
                const frozenBg = rt === 'ytd' ? '#16140f'
                  : rt === 'month' ? '#14120d'
                  : rt === 'week' ? '#11100c'
                  : '#0A0A0A';

                // Click handler for expandable rows
                const handleRowClick = () => {
                  if (rt === 'week' && row.isExpandable && row.monthIdx !== undefined && row.weekIdx !== undefined) {
                    toggleWeek(row.monthIdx, row.weekIdx);
                  }
                };

                const isClickable = row.isExpandable;
                const ChevIcon = row.isExpanded ? ChevronDown : ChevronRight;

                return (
                  <tr
                    key={row.id}
                    className="group transition-colors"
                    style={{
                      backgroundColor: rowBg(rt),
                      borderBottom: rowBorder(rt),
                      cursor: isClickable ? 'pointer' : undefined,
                    }}
                    onClick={isClickable ? handleRowClick : undefined}
                    onMouseEnter={(e) => {
                      if (rt === 'day') e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.02)';
                      if (isClickable) e.currentTarget.style.backgroundColor = rt === 'month'
                        ? 'rgba(200,184,154,0.09)' : 'rgba(200,184,154,0.06)';
                    }}
                    onMouseLeave={(e) => {
                      if (rt === 'day') e.currentTarget.style.backgroundColor = 'transparent';
                      if (isClickable) e.currentTarget.style.backgroundColor = rowBg(rt);
                    }}
                  >
                    {/* Frozen Date cell — sticky left */}
                    <td
                      className="sticky left-0 z-[5] px-3.5 py-2.5 whitespace-nowrap select-none"
                      style={{
                        ...dateCellStyle(rt),
                        backgroundColor: frozenBg,
                        borderRight: '1px solid rgba(255,255,255,0.06)',
                        boxShadow: '4px 0 8px -2px rgba(0,0,0,0.4)',
                        minWidth: '180px',
                      }}
                    >
                      <span className="inline-flex items-center gap-1.5">
                        {row.isExpandable && (
                          <ChevIcon
                            size={12}
                            className="flex-shrink-0 transition-transform duration-150"
                            style={{ color: '#C8B89A', opacity: 0.7 }}
                          />
                        )}
                        {!row.isExpandable && rt !== 'ytd' && rt !== 'day' && (
                          <span className="w-3 inline-block" />
                        )}
                        {row.dayLabel}
                        {row.isExpandable && !row.isExpanded && row.hasChildren && (
                          <span
                            className="text-[9px] font-bold px-1.5 py-0.5 rounded ml-1"
                            style={{
                              background: 'rgba(255,255,255,0.04)',
                              color: '#555',
                            }}
                          >
                            {rt === 'month'
                              ? `${fullYearData.months[row.monthIdx!]?.weeks.length || 0}w`
                              : rt === 'week'
                              ? `${currentMonthData.weeks[row.weekIdx!]?.days.length || 0}d`
                              : ''}
                          </span>
                        )}
                      </span>
                    </td>
                    {/* ── Raw input cells ── */}
                    {(() => {
                      const c = calcFields(row, grossMargin, merchantFeePctNum, fulfillmentPerOrderNum);
                      const cs = cellStyle(rt);
                      const calcCs = { ...cs, color: rt === 'ytd' ? '#C8B89A' : '#5DADE2' };
                      const td = "px-3.5 py-2.5 text-right whitespace-nowrap tabular-nums";
                      return (
                        <>
                          <td className={td} style={cs}>{fmtNum(row.ncOrders)}</td>
                          <td className={td} style={calcCs}>{fmtCurrency(c.ncNetRevenue)}</td>
                          <td className={td} style={cs}>{fmtNum(row.rcOrders)}</td>
                          <td className={td} style={calcCs}>{fmtCurrency(c.rcNetRevenue)}</td>
                          <td className={td} style={cs}>{fmtCurrency(row.grossSales)}</td>
                          <td className={td} style={{ ...cs, color: row.discounts < 0 ? '#ef4444' : undefined }}>
                            {row.discounts === 0 ? '$0' : fmtCurrency(row.discounts)}
                          </td>
                          <td className={td} style={{ ...cs, color: row.refunds < 0 ? '#ef4444' : undefined }}>
                            {row.refunds === 0 ? '$0' : fmtCurrency(row.refunds)}
                          </td>
                          <td className={td} style={{ ...cs, color: rt === 'day' ? '#555' : undefined }}>
                            {fmtCurrency(row.taxes)}
                          </td>
                          <td className={td} style={{ ...cs, color: rt === 'day' ? '#555' : undefined }}>
                            {fmtCurrency(row.shipping)}
                          </td>
                          {/* ── Off-Shopify Revenue ── */}
                          <td className={td} style={{
                            ...cs,
                            color: isOffShopifyLocked && rt === 'day' ? '#A855F7' : row.offShopifyRevenue > 0 ? '#A855F7' : '#555',
                            fontStyle: isOffShopifyLocked && rt === 'day' ? 'italic' : 'normal',
                          }}>
                            {fmtCurrency(row.offShopifyRevenue)}
                          </td>
                          {/* ── Calculated: Net Revenue ── */}
                          <td className={td} style={{ ...calcCs, fontWeight: rt === 'day' ? 600 : cs.fontWeight }}>
                            {fmtCurrency(c.netRevenue)}
                          </td>
                          {/* ── Ad spend (raw inputs) ── */}
                          <td className={td} style={{ ...cs, color: rt === 'day' ? '#555' : undefined }}>
                            {fmtCurrency(row.metaSpend)}
                          </td>
                          <td className={td} style={{ ...cs, color: rt === 'day' ? '#555' : undefined }}>
                            {fmtCurrency(row.googleSpend)}
                          </td>
                          <td className={td} style={{
                            ...cs,
                            color: isLocked && rt === 'day' ? '#10B981' : undefined,
                            fontStyle: isLocked && rt === 'day' ? 'italic' : 'normal',
                          }}>
                            {fmtCurrency(row.otherSpend)}
                          </td>
                          {/* ── Calculated fields ── */}
                          <td className={td} style={calcCs}>{fmtCurrency(c.totalSpend)}</td>
                          <td className={td} style={calcCs}>{fmtCurrency(c.cogs)}</td>
                          <td className={td} style={{ ...calcCs, color: c.contribution >= 0 ? '#10B981' : '#ef4444' }}>
                            {fmtCurrency(c.contribution)}
                          </td>
                          <td className="px-3.5 py-2.5 text-right whitespace-nowrap" style={calcCs}>
                            {rt === 'day' ? (
                              <MarginBar pct={c.marginPct} />
                            ) : (
                              <span style={{ color: c.marginPct >= 15 ? '#10B981' : '#ef4444' }}>
                                {fmtPct(c.marginPct)}
                              </span>
                            )}
                          </td>
                          <td className={td} style={calcCs}>${c.ncAov.toFixed(2)}</td>
                          <td className={td} style={calcCs}>${c.cac.toFixed(2)}</td>
                          <td className={td} style={calcCs}>{fmtDec(c.amer)}</td>
                          <td className={td} style={calcCs}>{fmtDec(c.mer)}</td>
                        </>
                      );
                    })()}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </Navbar>
  );
}
