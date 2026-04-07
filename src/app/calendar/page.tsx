'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  Loader,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Globe,
  Rocket,
  Tag,
  Sparkles,
  Plus,
  X,
  Check,
  Megaphone,
  Mail,
  Calendar as CalendarIcon,
} from 'lucide-react';
import Navbar from '@/components/Navbar';
import { createClient } from '@/lib/supabase';

// ─── Brand Palette (melch.cloud branding) ───────────────────────
const GOLD = '#C8B89A';
const GOLD_LIGHT = '#D9CBAE';
const GOLD_DIM = 'rgba(200,184,154,0.18)';
const GOLD_BORDER = 'rgba(200,184,154,0.30)';
const BG_CARD = '#111111';
const BG_DARK = '#131313';
const BG_HEADER = '#161616';
const BG_ROW_ALT = 'rgba(200,184,154,0.03)';
const BORDER = 'rgba(200,184,154,0.10)';
const BORDER_STRONG = 'rgba(200,184,154,0.18)';
const TEXT_PRIMARY = '#F5F5F8';
const TEXT_MUTED = '#999';
const TEXT_DIM = '#666';

// ─── Types ──────────────────────────────────────────────────────

interface Brand {
  id: string;
  name: string;
  slug: string;
}

interface BatchLaunch {
  id: string;
  batch_name: string;
  brand_id: string;
  brand_name: string;
  created_at: string;
  launched_at: string | null;
  batch_status: string;
}

interface ManualEvent {
  id: string;
  title: string;
  channel: string;
  event_date: string;
  brand_id: string | null;
}

interface KlaviyoCampaign {
  id: string;
  name: string;
  status: string;
  channel: string;
  send_time: string | null;
  subject: string | null;
  brand_id: string;
  brand_name: string;
}

interface CalendarEvent {
  label: string;
  month: number;
  day: number;
  category: string;
  hemisphere?: 'north' | 'south' | 'both';
}

// ─── Months ─────────────────────────────────────────────────────

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const MONTH_ABBR = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

// ─── Seasons ────────────────────────────────────────────────────

const SEASONS_NORTH = [
  { label: 'Winter', months: [0, 1], color: GOLD },
  { label: 'Spring', months: [2, 3, 4], color: '#9AC8A7' },
  { label: 'Summer', months: [5, 6, 7], color: '#C8B89A' },
  { label: 'Autumn', months: [8, 9, 10], color: '#B89A7A' },
  { label: 'Winter', months: [11], color: GOLD },
];

const SEASONS_SOUTH = [
  { label: 'Summer', months: [0, 1], color: '#C8B89A' },
  { label: 'Autumn', months: [2, 3, 4], color: '#B89A7A' },
  { label: 'Winter', months: [5, 6, 7], color: GOLD },
  { label: 'Spring', months: [8, 9, 10], color: '#9AC8A7' },
  { label: 'Summer', months: [11], color: '#C8B89A' },
];

// ─── Pill Colors by Category ────────────────────────────────────

const PILL_COLORS = {
  holiday: '#E8A838',     // warm amber — stands out clearly
  promo: '#E05ABC',       // magenta/pink — eye-catching for sales moments
  cultural: '#5DADE2',    // sky blue — distinct from promo/holiday
};

// ─── Status Colors ──────────────────────────────────────────────

const STATUS_COLORS: Record<string, { color: string; label: string }> = {
  new: { color: '#E8A838', label: 'Submitted' },
  building: { color: '#5DADE2', label: 'Building' },
  ready: { color: '#58D68D', label: 'Ready' },
  launched: { color: '#2ECC71', label: 'Launched' },
};

// ─── Channel Colors ─────────────────────────────────────────────

// Klaviyo-branded green for email campaigns
const KLAVIYO_COLOR = '#6BC06B';
const KLAVIYO_SMS_COLOR = '#5DADE2';

const CHANNEL_COLORS: Record<string, string> = {
  Email: '#E8A838',
  SMS: '#58D68D',
  Social: '#AF7AC5',
  'Meta Ads': '#5B8DEE',
  'Google Ads': '#F4D03F',
  Blog: '#E67E22',
  PR: '#5DADE2',
  Influencer: '#E05ABC',
  Other: TEXT_MUTED,
};

const CHANNEL_OPTIONS = Object.keys(CHANNEL_COLORS);

// ─── 2026 Holidays ──────────────────────────────────────────────

const KEY_HOLIDAYS: CalendarEvent[] = [
  { label: "New Year's", month: 0, day: 1, category: 'holiday', hemisphere: 'both' },
  { label: 'MLK Day', month: 0, day: 19, category: 'holiday', hemisphere: 'north' },
  { label: 'Australia Day', month: 0, day: 26, category: 'holiday', hemisphere: 'south' },
  { label: "Valentine's Day", month: 1, day: 14, category: 'promo', hemisphere: 'both' },
  { label: 'Chinese New Year', month: 1, day: 17, category: 'holiday', hemisphere: 'both' },
  { label: "Int'l Women's Day", month: 2, day: 8, category: 'cultural', hemisphere: 'both' },
  { label: "St. Patrick's", month: 2, day: 17, category: 'cultural', hemisphere: 'both' },
  { label: 'Easter', month: 3, day: 5, category: 'holiday', hemisphere: 'both' },
  { label: 'Earth Day', month: 3, day: 22, category: 'cultural', hemisphere: 'both' },
  { label: 'Anzac Day', month: 3, day: 25, category: 'holiday', hemisphere: 'south' },
  { label: "Mother's Day", month: 4, day: 10, category: 'promo', hemisphere: 'both' },
  { label: 'Memorial Day', month: 4, day: 25, category: 'holiday', hemisphere: 'north' },
  { label: "Father's Day (US)", month: 5, day: 21, category: 'promo', hemisphere: 'north' },
  { label: 'Juneteenth', month: 5, day: 19, category: 'holiday', hemisphere: 'north' },
  { label: '4th of July', month: 6, day: 4, category: 'holiday', hemisphere: 'north' },
  { label: 'Back to School', month: 7, day: 1, category: 'promo', hemisphere: 'north' },
  { label: 'Labor Day', month: 8, day: 7, category: 'holiday', hemisphere: 'north' },
  { label: "Father's Day (AU)", month: 8, day: 6, category: 'promo', hemisphere: 'south' },
  { label: 'Halloween', month: 9, day: 31, category: 'promo', hemisphere: 'both' },
  { label: 'Veterans Day', month: 10, day: 11, category: 'holiday', hemisphere: 'north' },
  { label: 'Thanksgiving', month: 10, day: 26, category: 'holiday', hemisphere: 'north' },
  { label: 'Black Friday', month: 10, day: 27, category: 'promo', hemisphere: 'both' },
  { label: 'Cyber Monday', month: 10, day: 30, category: 'promo', hemisphere: 'both' },
  { label: 'Christmas', month: 11, day: 25, category: 'holiday', hemisphere: 'both' },
  { label: 'Boxing Day', month: 11, day: 26, category: 'holiday', hemisphere: 'south' },
  { label: "NYE", month: 11, day: 31, category: 'holiday', hemisphere: 'both' },
];

// ═════════════════════════════════════════════════════════════════
// ─── Sub-Components ─────────────────────────────────────────────
// ═════════════════════════════════════════════════════════════════

function SeasonBar({ label, seasons }: { label: string; seasons: typeof SEASONS_NORTH }) {
  const monthMap: { label: string; color: string }[] = [];
  for (let m = 0; m < 12; m++) {
    const s = seasons.find((s) => s.months.includes(m));
    monthMap.push(s || { label: '', color: '#333' });
  }
  const groups: { label: string; color: string; span: number }[] = [];
  let i = 0;
  while (i < 12) {
    const cur = monthMap[i];
    let span = 1;
    while (i + span < 12 && monthMap[i + span].label === cur.label) span++;
    groups.push({ label: cur.label, color: cur.color, span });
    i += span;
  }

  return (
    <tr>
      <td className="sticky left-0 z-20 px-4 py-1" style={{ backgroundColor: BG_HEADER, color: TEXT_DIM, minWidth: '180px', boxShadow: '4px 0 12px rgba(0,0,0,0.3)' }}>
        <span className="text-[10px] font-semibold uppercase tracking-wider">{label}</span>
      </td>
      {groups.map((g, idx) => (
        <td
          key={idx}
          colSpan={g.span}
          className="text-center py-1.5 text-[10px] font-bold uppercase tracking-wider"
          style={{ backgroundColor: `${g.color}18`, color: g.color, borderLeft: `1px solid ${BORDER}` }}
        >
          {g.label}
        </td>
      ))}
    </tr>
  );
}

function Pill({
  label,
  color,
  sub,
  dot,
}: {
  label: string;
  color: string;
  sub?: string;
  dot?: boolean;
}) {
  return (
    <div
      className="inline-flex items-center gap-1 px-1.5 py-[3px] rounded text-[9px] font-semibold whitespace-nowrap mr-1 mb-1 leading-none"
      style={{ backgroundColor: `${color}20`, color, border: `1px solid ${color}35` }}
    >
      {dot && <div className="w-[5px] h-[5px] rounded-full flex-shrink-0" style={{ backgroundColor: color }} />}
      {sub && <span className="opacity-40 mr-0.5">{sub}</span>}
      {label}
    </div>
  );
}

function SectionHeader({ icon: Icon, label, color, count }: { icon: React.ElementType; label: string; color: string; count?: number }) {
  return (
    <tr>
      <td className="sticky left-0 z-20 px-4 py-2" style={{ backgroundColor: BG_HEADER, minWidth: '180px', boxShadow: '4px 0 12px rgba(0,0,0,0.3)' }}>
        <div className="flex items-center gap-2 whitespace-nowrap">
          <Icon size={12} style={{ color }} />
          <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color }}>{label}</span>
          {count !== undefined && (
            <span className="text-[10px]" style={{ color: TEXT_DIM }}>({count})</span>
          )}
        </div>
      </td>
      <td colSpan={12} style={{ backgroundColor: BG_HEADER }} />
    </tr>
  );
}

function Divider() {
  return (
    <tr>
      <td className="sticky left-0 z-20" style={{ height: '1px', backgroundColor: BORDER_STRONG }} />
      <td colSpan={12} style={{ height: '1px', backgroundColor: BORDER_STRONG }} />
    </tr>
  );
}

// ─── Add Event Modal ────────────────────────────────────────────

function AddEventModal({
  open,
  onClose,
  onSave,
  saving,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (title: string, channel: string, date: string) => void;
  saving: boolean;
}) {
  const [title, setTitle] = useState('');
  const [channel, setChannel] = useState('Email');
  const [date, setDate] = useState('');

  useEffect(() => {
    if (open) {
      setTitle('');
      setChannel('Email');
      setDate('');
    }
  }, [open]);

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-40" onClick={onClose} />
      <div
        className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md rounded-xl p-6 z-50 space-y-4"
        style={{ backgroundColor: '#141414', border: `1px solid rgba(255,255,255,0.08)` }}
      >
        <div>
          <h3 className="text-lg font-bold" style={{ color: TEXT_PRIMARY }}>Add Calendar Event</h3>
          <p className="text-xs mt-1" style={{ color: TEXT_DIM }}>
            Plot a marketing event on the calendar.
          </p>
        </div>

        <div className="space-y-3">
          {/* Title */}
          <div>
            <label className="text-[10px] font-medium block mb-1.5 uppercase tracking-wider" style={{ color: TEXT_DIM }}>
              Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Spring Sale Email Blast"
              autoFocus
              className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
              style={{ backgroundColor: 'rgba(255,255,255,0.04)', border: `1px solid rgba(255,255,255,0.1)`, color: TEXT_PRIMARY }}
            />
          </div>

          {/* Channel */}
          <div>
            <label className="text-[10px] font-medium block mb-1.5 uppercase tracking-wider" style={{ color: TEXT_DIM }}>
              Channel
            </label>
            <div className="flex flex-wrap gap-1.5">
              {CHANNEL_OPTIONS.map((ch) => (
                <button
                  key={ch}
                  onClick={() => setChannel(ch)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                  style={{
                    backgroundColor: channel === ch ? `${CHANNEL_COLORS[ch]}20` : 'rgba(255,255,255,0.04)',
                    color: channel === ch ? CHANNEL_COLORS[ch] : TEXT_MUTED,
                    border: `1px solid ${channel === ch ? `${CHANNEL_COLORS[ch]}40` : 'rgba(255,255,255,0.06)'}`,
                  }}
                >
                  {ch}
                </button>
              ))}
            </div>
          </div>

          {/* Date */}
          <div>
            <label className="text-[10px] font-medium block mb-1.5 uppercase tracking-wider" style={{ color: TEXT_DIM }}>
              Date
            </label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
              style={{ backgroundColor: 'rgba(255,255,255,0.04)', border: `1px solid rgba(255,255,255,0.1)`, color: TEXT_PRIMARY, colorScheme: 'dark' }}
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium" style={{ color: TEXT_MUTED }}>
            Cancel
          </button>
          <button
            onClick={() => { if (title.trim() && date) onSave(title.trim(), channel, date); }}
            disabled={!title.trim() || !date || saving}
            className="px-4 py-2 rounded-lg text-sm font-bold transition-all"
            style={{
              backgroundColor: title.trim() && date ? GOLD : `${GOLD}30`,
              color: title.trim() && date ? '#0A0A0A' : '#666',
              opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? 'Saving...' : 'Add Event'}
          </button>
        </div>
      </div>
    </>
  );
}

// ═════════════════════════════════════════════════════════════════
// ─── Main Calendar Page ─────────────────────────────────────────
// ═════════════════════════════════════════════════════════════════

export default function CalendarPage() {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState(new Date().getFullYear());
  const [userRole, setUserRole] = useState<string | null>(null);
  const [userBrandId, setUserBrandId] = useState<string | null>(null);

  // Data
  const [brands, setBrands] = useState<Brand[]>([]);
  const [batches, setBatches] = useState<BatchLaunch[]>([]);
  const [manualEvents, setManualEvents] = useState<ManualEvent[]>([]);
  const [klaviyoCampaigns, setKlaviyoCampaigns] = useState<KlaviyoCampaign[]>([]);

  // Filters — admin starts with no brand selected (holidays only)
  const [selectedBrandId, setSelectedBrandId] = useState<string>('none');
  const [hemisphere, setHemisphere] = useState<'both' | 'north' | 'south'>('both');
  const [showBrandDropdown, setShowBrandDropdown] = useState(false);

  // Modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2000);
  };

  // ─── Fetch Data ─────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    try {
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

      setUserRole(profile.role);
      setUserBrandId(profile.brand_id);

      // Fetch brands
      const { data: allBrands } = await supabase
        .from('brands')
        .select('id, name, slug')
        .neq('name', 'Test Brand')
        .order('name');
      setBrands(allBrands || []);

      // If strategist, lock to their brand
      if (profile.role === 'strategist' && profile.brand_id) {
        setSelectedBrandId(profile.brand_id);
      }

      // Fetch submissions
      let batchQuery = supabase
        .from('submissions')
        .select('id, batch_name, brand_id, batch_status, created_at, launched_at, brands:brand_id(name)')
        .gte('created_at', `${year}-01-01`)
        .lt('created_at', `${year + 1}-01-01`)
        .order('created_at', { ascending: true });

      if (profile.role === 'strategist' && profile.brand_id) {
        batchQuery = batchQuery.eq('brand_id', profile.brand_id);
      }

      const { data: subs } = await batchQuery;
      setBatches(
        (subs || []).map((s: any) => ({
          id: s.id,
          batch_name: s.batch_name,
          brand_id: s.brand_id,
          brand_name: s.brands?.name || 'Unknown',
          created_at: s.created_at,
          launched_at: s.launched_at,
          batch_status: s.batch_status || 'new',
        }))
      );

      // Fetch manual calendar events (gracefully handle table not existing)
      try {
        let eventsQuery = supabase
          .from('calendar_events')
          .select('id, title, channel, event_date, brand_id')
          .gte('event_date', `${year}-01-01`)
          .lt('event_date', `${year + 1}-01-01`)
          .order('event_date');

        if (profile.role === 'strategist' && profile.brand_id) {
          eventsQuery = eventsQuery.or(`brand_id.eq.${profile.brand_id},brand_id.is.null`);
        }

        const { data: events } = await eventsQuery;
        setManualEvents(events || []);
      } catch {
        // Table doesn't exist yet — no problem
        setManualEvents([]);
      }

      setLoading(false);
    } catch {
      setLoading(false);
    }
  }, [supabase, router, year]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ─── Fetch Klaviyo (separate, non-blocking, per-brand) ─────
  const [klaviyoLoading, setKlaviyoLoading] = useState(false);

  const fetchKlaviyo = useCallback(async () => {
    // Only fetch when a specific brand is selected
    if (loading || !userRole || selectedBrandId === 'none' || selectedBrandId === 'all') {
      setKlaviyoCampaigns([]);
      return;
    }

    setKlaviyoLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000);

      const res = await fetch(
        `/api/klaviyo/campaigns?year=${year}&channel=all&brand_id=${selectedBrandId}`,
        { headers: { Authorization: `Bearer ${session.access_token}` }, signal: controller.signal }
      );
      clearTimeout(timeoutId);

      if (res.ok) {
        const json = await res.json();
        setKlaviyoCampaigns(json.campaigns || []);
      } else {
        setKlaviyoCampaigns([]);
      }
    } catch {
      setKlaviyoCampaigns([]);
    }
    setKlaviyoLoading(false);
  }, [supabase, loading, userRole, selectedBrandId, year]);

  useEffect(() => {
    fetchKlaviyo();
  }, [fetchKlaviyo]);

  // ─── Add Manual Event ───────────────────────────────────────

  const handleAddEvent = useCallback(
    async (title: string, channel: string, date: string) => {
      setSaving(true);
      try {
        const brandId = (selectedBrandId !== 'all' && selectedBrandId !== 'none') ? selectedBrandId : null;
        const { data, error } = await supabase
          .from('calendar_events')
          .insert({ title, channel, event_date: date, brand_id: brandId })
          .select()
          .single();

        if (error) {
          // If table doesn't exist, show helpful message
          if (error.message.includes('calendar_events')) {
            showToast('Run the migration to create calendar_events table');
          } else {
            showToast(error.message);
          }
        } else if (data) {
          setManualEvents((prev) => [...prev, data].sort((a, b) => a.event_date.localeCompare(b.event_date)));
          setShowAddModal(false);
          showToast('Event added');
        }
      } catch {
        showToast('Failed to add event');
      }
      setSaving(false);
    },
    [supabase, selectedBrandId]
  );

  const handleDeleteEvent = useCallback(
    async (id: string) => {
      await supabase.from('calendar_events').delete().eq('id', id);
      setManualEvents((prev) => prev.filter((e) => e.id !== id));
      showToast('Event removed');
    },
    [supabase]
  );

  // ─── Filtered Data ──────────────────────────────────────────

  const hasBrandSelected = selectedBrandId !== 'none' && selectedBrandId !== 'all';

  const filteredBatches = useMemo(() => {
    if (!hasBrandSelected) return [];
    return batches.filter((b) => b.brand_id === selectedBrandId);
  }, [batches, selectedBrandId, hasBrandSelected]);

  // Only show launched batches on the calendar (with their go-live date)
  const launchedBatches = useMemo(() => {
    return filteredBatches.filter((b) => b.batch_status === 'launched' && b.launched_at);
  }, [filteredBatches]);

  const filteredManualEvents = useMemo(() => {
    if (!hasBrandSelected) return [];
    return manualEvents.filter((e) => e.brand_id === selectedBrandId || !e.brand_id);
  }, [manualEvents, selectedBrandId, hasBrandSelected]);

  // Klaviyo campaigns — already fetched per-brand, so just split by channel
  const filteredKlaviyoEmails = useMemo(() => {
    return klaviyoCampaigns.filter((c) => c.channel === 'email');
  }, [klaviyoCampaigns]);

  const filteredKlaviyoSMS = useMemo(() => {
    return klaviyoCampaigns.filter((c) => c.channel === 'sms');
  }, [klaviyoCampaigns]);

  const filteredHolidays = useMemo(() => {
    return KEY_HOLIDAYS.filter((h) => {
      if (hemisphere === 'both') return true;
      return h.hemisphere === 'both' || h.hemisphere === hemisphere;
    });
  }, [hemisphere]);

  const holidayEvents = filteredHolidays.filter((h) => h.category === 'holiday');
  const promoEvents = filteredHolidays.filter((h) => h.category === 'promo');
  const culturalEvents = filteredHolidays.filter((h) => h.category === 'cultural');

  const selectedBrandName = brands.find((b) => b.id === selectedBrandId)?.name || 'Select a Brand';

  // ─── Loading ────────────────────────────────────────────────

  if (loading) {
    return (
      <Navbar>
        <div className="min-h-screen flex items-center justify-center">
          <Loader className="w-8 h-8 animate-spin" style={{ color: GOLD }} />
        </div>
      </Navbar>
    );
  }

  // ═════════════════════════════════════════════════════════════
  // ─── Render ─────────────────────────────────────────────────
  // ═════════════════════════════════════════════════════════════

  return (
    <Navbar>
      <div className="p-6 md:p-8 max-w-[1800px] mx-auto">
        {/* ─── Header ──────────────────────────────────────── */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center gap-3">
              <CalendarDays size={24} style={{ color: GOLD_LIGHT }} />
              <h1 className="text-2xl font-bold tracking-tight" style={{ color: TEXT_PRIMARY }}>
                {year} Calendar
              </h1>
            </div>
            <p className="text-sm mt-1" style={{ color: TEXT_DIM }}>
              {hasBrandSelected
                ? `${selectedBrandName} — launches, holidays & marketing events`
                : 'Select a brand to view launches, events & Klaviyo campaigns'}
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Brand filter (admin only sees this) */}
            {userRole === 'admin' && (
              <div className="relative">
                <button
                  onClick={() => setShowBrandDropdown(!showBrandDropdown)}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition-colors"
                  style={{ backgroundColor: GOLD_DIM, border: `1px solid ${GOLD_BORDER}`, color: GOLD }}
                >
                  {selectedBrandName}
                  <ChevronDown size={12} />
                </button>
                {showBrandDropdown && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setShowBrandDropdown(false)} />
                    <div
                      className="absolute top-full right-0 mt-1 w-56 rounded-lg py-1 z-40 max-h-64 overflow-auto"
                      style={{ backgroundColor: '#1A1A1A', border: `1px solid rgba(255,255,255,0.1)`, boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}
                    >
                      {brands.map((b) => (
                        <button
                          key={b.id}
                          onClick={() => { setSelectedBrandId(b.id); setShowBrandDropdown(false); }}
                          className="w-full text-left px-4 py-2.5 text-xs transition-colors flex items-center justify-between"
                          style={{ color: selectedBrandId === b.id ? GOLD : '#CCC', backgroundColor: selectedBrandId === b.id ? GOLD_DIM : 'transparent' }}
                        >
                          {b.name}
                          {selectedBrandId === b.id && <Check size={12} style={{ color: GOLD }} />}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Hemisphere */}
            <div className="flex rounded-lg overflow-hidden" style={{ border: `1px solid ${BORDER}` }}>
              {(['both', 'north', 'south'] as const).map((h) => (
                <button
                  key={h}
                  onClick={() => setHemisphere(h)}
                  className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider transition-colors"
                  style={{
                    backgroundColor: hemisphere === h ? GOLD_DIM : 'rgba(255,255,255,0.04)',
                    color: hemisphere === h ? GOLD : TEXT_DIM,
                  }}
                >
                  {h === 'both' ? 'All' : h === 'north' ? 'N. Hemi' : 'S. Hemi'}
                </button>
              ))}
            </div>

            {/* Year nav */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => setYear((y) => y - 1)}
                className="p-2 rounded-lg transition-colors"
                style={{ backgroundColor: 'rgba(255,255,255,0.04)', border: `1px solid ${BORDER}`, color: TEXT_MUTED }}
              >
                <ChevronLeft size={14} />
              </button>
              <span className="px-2 text-sm font-bold" style={{ color: TEXT_PRIMARY }}>{year}</span>
              <button
                onClick={() => setYear((y) => y + 1)}
                className="p-2 rounded-lg transition-colors"
                style={{ backgroundColor: 'rgba(255,255,255,0.04)', border: `1px solid ${BORDER}`, color: TEXT_MUTED }}
              >
                <ChevronRight size={14} />
              </button>
            </div>

            {/* Add event */}
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-all"
              style={{ backgroundColor: GOLD, color: '#0A0A0A' }}
            >
              <Plus size={14} />
              Event
            </button>
          </div>
        </div>

        {/* ─── Calendar Grid ───────────────────────────────── */}
        <div className="rounded-xl overflow-hidden" style={{ backgroundColor: BG_CARD, border: `1px solid ${BORDER_STRONG}`, boxShadow: '0 4px 24px rgba(0,0,0,0.3)' }}>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse" style={{ minWidth: '1500px' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${BORDER_STRONG}` }}>
                  <th
                    className="sticky left-0 z-30 text-left px-4 py-3.5 text-xs font-bold uppercase tracking-widest"
                    style={{ backgroundColor: BG_HEADER, color: GOLD_LIGHT, minWidth: '180px', borderBottom: `2px solid ${GOLD}30`, boxShadow: '4px 0 12px rgba(0,0,0,0.3)' }}
                  >
                    {year}
                  </th>
                  {MONTHS.map((m, i) => {
                    const isCurrent = new Date().getFullYear() === year && new Date().getMonth() === i;
                    return (
                      <th
                        key={m}
                        className="text-center px-2 py-3.5 text-[11px] font-bold uppercase tracking-wider"
                        style={{
                          color: isCurrent ? GOLD_LIGHT : '#AAA',
                          backgroundColor: isCurrent ? 'rgba(200,184,154,0.08)' : BG_HEADER,
                          borderLeft: `1px solid ${BORDER}`,
                          borderBottom: isCurrent ? `2px solid ${GOLD}` : `2px solid ${GOLD}30`,
                          minWidth: '110px',
                        }}
                      >
                        {MONTH_ABBR[i]}
                        {isCurrent && <div className="w-1.5 h-1.5 rounded-full mx-auto mt-1" style={{ backgroundColor: GOLD_LIGHT }} />}
                      </th>
                    );
                  })}
                </tr>
              </thead>

              <tbody>
                {/* ─── Seasons ─────────────────────────────── */}
                {(hemisphere === 'both' || hemisphere === 'north') && (
                  <SeasonBar label="Northern Hemisphere" seasons={SEASONS_NORTH} />
                )}
                {(hemisphere === 'both' || hemisphere === 'south') && (
                  <SeasonBar label="Southern Hemisphere" seasons={SEASONS_SOUTH} />
                )}

                <Divider />

                {/* ─── Holidays ────────────────────────────── */}
                <SectionHeader icon={CalendarIcon} label="Holidays & Moments" color={PILL_COLORS.holiday} />
                {/* Holiday row */}
                <tr>
                  <td className="sticky left-0 z-20 px-4 py-1.5 align-top" style={{ backgroundColor: BG_HEADER, boxShadow: '4px 0 12px rgba(0,0,0,0.3)' }}>
                    <span className="text-[10px] font-medium" style={{ color: TEXT_DIM }}>Holidays</span>
                  </td>
                  {Array.from({ length: 12 }, (_, m) => (
                    <td key={m} className="px-1.5 py-1.5 align-top" style={{ borderLeft: `1px solid ${BORDER}` }}>
                      <div className="flex flex-wrap">
                        {holidayEvents.filter((e) => e.month === m).map((e, i) => (
                          <Pill key={i} label={e.label} color={PILL_COLORS.holiday} sub={`${e.day}`} />
                        ))}
                      </div>
                    </td>
                  ))}
                </tr>
                {/* Promo row */}
                <tr>
                  <td className="sticky left-0 z-20 px-4 py-1.5 align-top" style={{ backgroundColor: BG_HEADER, boxShadow: '4px 0 12px rgba(0,0,0,0.3)' }}>
                    <span className="text-[10px] font-medium" style={{ color: TEXT_DIM }}>Promos</span>
                  </td>
                  {Array.from({ length: 12 }, (_, m) => (
                    <td key={m} className="px-1.5 py-1.5 align-top" style={{ borderLeft: `1px solid ${BORDER}` }}>
                      <div className="flex flex-wrap">
                        {promoEvents.filter((e) => e.month === m).map((e, i) => (
                          <Pill key={i} label={e.label} color={PILL_COLORS.promo} sub={`${e.day}`} />
                        ))}
                      </div>
                    </td>
                  ))}
                </tr>
                {/* Cultural row */}
                <tr>
                  <td className="sticky left-0 z-20 px-4 py-1.5 align-top" style={{ backgroundColor: BG_HEADER, boxShadow: '4px 0 12px rgba(0,0,0,0.3)' }}>
                    <span className="text-[10px] font-medium" style={{ color: TEXT_DIM }}>Cultural</span>
                  </td>
                  {Array.from({ length: 12 }, (_, m) => (
                    <td key={m} className="px-1.5 py-1.5 align-top" style={{ borderLeft: `1px solid ${BORDER}` }}>
                      <div className="flex flex-wrap">
                        {culturalEvents.filter((e) => e.month === m).map((e, i) => (
                          <Pill key={i} label={e.label} color={PILL_COLORS.cultural} sub={`${e.day}`} />
                        ))}
                      </div>
                    </td>
                  ))}
                </tr>

                <Divider />

                {/* ─── Creative Launches ───────────────────── */}
                <SectionHeader icon={Rocket} label="Creative Launches" color="#2ECC71" count={launchedBatches.length} />

                {launchedBatches.length > 0 ? (
                  <tr>
                    <td className="sticky left-0 z-20 px-4 py-2 align-top" style={{ backgroundColor: BG_HEADER, boxShadow: '4px 0 12px rgba(0,0,0,0.3)' }}>
                      <span className="text-[10px] font-medium" style={{ color: TEXT_DIM }}>Launched</span>
                    </td>
                    {Array.from({ length: 12 }, (_, m) => {
                      const monthBatches = launchedBatches.filter((b) => {
                        const d = new Date(b.launched_at!);
                        return d.getMonth() === m;
                      });
                      return (
                        <td key={m} className="px-1.5 py-2 align-top" style={{ borderLeft: `1px solid ${BORDER}` }}>
                          <div className="flex flex-wrap">
                            {monthBatches.map((b) => {
                              const day = new Date(b.launched_at!).getDate();
                              return (
                                <Pill
                                  key={b.id}
                                  label={b.batch_name}
                                  color="#2ECC71"
                                  sub={`${day}`}
                                />
                              );
                            })}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ) : (
                  <tr>
                    <td colSpan={13} className="text-center py-4 text-xs" style={{ color: TEXT_DIM }}>
                      {hasBrandSelected
                        ? `No launched batches in ${year} for ${selectedBrandName}.`
                        : 'Select a brand to view creative launches.'}
                    </td>
                  </tr>
                )}

                <Divider />

                {/* ─── Klaviyo Email Campaigns ────────────── */}
                {klaviyoLoading && (
                  <tr>
                    <td colSpan={13} className="text-center py-3">
                      <div className="flex items-center justify-center gap-2">
                        <Loader className="w-3 h-3 animate-spin" style={{ color: KLAVIYO_COLOR }} />
                        <span className="text-[10px]" style={{ color: TEXT_DIM }}>Loading Klaviyo campaigns...</span>
                      </div>
                    </td>
                  </tr>
                )}
                {!klaviyoLoading && filteredKlaviyoEmails.length > 0 && (
                  <>
                    <SectionHeader icon={Mail} label="Klaviyo Emails" color={KLAVIYO_COLOR} count={filteredKlaviyoEmails.length} />
                    <tr>
                      <td className="sticky left-0 z-20 px-4 py-2 align-top" style={{ backgroundColor: BG_HEADER, boxShadow: '4px 0 12px rgba(0,0,0,0.3)' }}>
                        <span className="text-[10px] font-medium" style={{ color: KLAVIYO_COLOR }}>Sent / Scheduled</span>
                      </td>
                      {Array.from({ length: 12 }, (_, m) => {
                        const monthCampaigns = filteredKlaviyoEmails.filter((c) => {
                          if (!c.send_time) return false;
                          return new Date(c.send_time).getMonth() === m;
                        });
                        return (
                          <td key={m} className="px-1.5 py-2 align-top" style={{ borderLeft: `1px solid ${BORDER}` }}>
                            <div className="flex flex-wrap">
                              {monthCampaigns.map((c) => {
                                const day = new Date(c.send_time!).getDate();
                                return (
                                  <Pill
                                    key={c.id}
                                    label={c.name}
                                    color={KLAVIYO_COLOR}
                                    sub={`${day}`}
                                  />
                                );
                              })}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                    <Divider />
                  </>
                )}

                {/* ─── Klaviyo SMS Campaigns ──────────────── */}
                {filteredKlaviyoSMS.length > 0 && (
                  <>
                    <SectionHeader icon={Mail} label="Klaviyo SMS" color={KLAVIYO_SMS_COLOR} count={filteredKlaviyoSMS.length} />
                    <tr>
                      <td className="sticky left-0 z-20 px-4 py-2 align-top" style={{ backgroundColor: BG_HEADER, boxShadow: '4px 0 12px rgba(0,0,0,0.3)' }}>
                        <span className="text-[10px] font-medium" style={{ color: KLAVIYO_SMS_COLOR }}>Sent / Scheduled</span>
                      </td>
                      {Array.from({ length: 12 }, (_, m) => {
                        const monthCampaigns = filteredKlaviyoSMS.filter((c) => {
                          if (!c.send_time) return false;
                          return new Date(c.send_time).getMonth() === m;
                        });
                        return (
                          <td key={m} className="px-1.5 py-2 align-top" style={{ borderLeft: `1px solid ${BORDER}` }}>
                            <div className="flex flex-wrap">
                              {monthCampaigns.map((c) => {
                                const day = new Date(c.send_time!).getDate();
                                return (
                                  <Pill
                                    key={c.id}
                                    label={c.name}
                                    color={KLAVIYO_SMS_COLOR}
                                    sub={`${day}`}
                                  />
                                );
                              })}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                    <Divider />
                  </>
                )}

                {/* ─── Marketing Comms ─────────────────────── */}
                <SectionHeader icon={Megaphone} label="Marketing Comms" color="#AF7AC5" count={filteredManualEvents.length} />

                {filteredManualEvents.length > 0 ? (
                  // Group by channel
                  (() => {
                    const channelSet = new Set(filteredManualEvents.map((e) => e.channel));
                    const channels = Array.from(channelSet).sort();
                    return channels.map((ch) => {
                      const chEvents = filteredManualEvents.filter((e) => e.channel === ch);
                      const chColor = CHANNEL_COLORS[ch] || TEXT_MUTED;
                      return (
                        <tr key={ch}>
                          <td className="sticky left-0 z-20 px-4 py-1.5 align-top" style={{ backgroundColor: BG_HEADER, boxShadow: '4px 0 12px rgba(0,0,0,0.3)' }}>
                            <span className="text-[10px] font-medium" style={{ color: chColor }}>{ch}</span>
                          </td>
                          {Array.from({ length: 12 }, (_, m) => {
                            const monthEvents = chEvents.filter((e) => new Date(e.event_date).getMonth() === m);
                            return (
                              <td key={m} className="px-1.5 py-1.5 align-top" style={{ borderLeft: `1px solid ${BORDER}` }}>
                                <div className="flex flex-wrap">
                                  {monthEvents.map((e) => {
                                    const day = new Date(e.event_date).getDate();
                                    return (
                                      <div key={e.id} className="group relative">
                                        <Pill label={e.title} color={chColor} sub={`${day}`} />
                                        {userRole === 'admin' && (
                                          <button
                                            onClick={() => handleDeleteEvent(e.id)}
                                            className="absolute -top-1 -right-1 w-3 h-3 rounded-full items-center justify-center hidden group-hover:flex"
                                            style={{ backgroundColor: '#EF4444', color: '#fff', fontSize: '8px' }}
                                          >
                                            <X size={7} />
                                          </button>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    });
                  })()
                ) : (
                  <tr>
                    <td colSpan={13} className="text-center py-4 text-xs" style={{ color: TEXT_DIM }}>
                      No marketing events added yet. Click &quot;+ Event&quot; to plot one.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ─── Legend ───────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-4 mt-4 px-1">
          <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: TEXT_DIM }}>Holidays:</span>
          {[
            { label: 'Holiday', color: PILL_COLORS.holiday },
            { label: 'Promo', color: PILL_COLORS.promo },
            { label: 'Cultural', color: PILL_COLORS.cultural },
          ].map((item) => (
            <div key={item.label} className="flex items-center gap-1.5">
              <div className="w-2.5 h-2 rounded-sm" style={{ backgroundColor: `${item.color}25`, border: `1px solid ${item.color}50` }} />
              <span className="text-[10px]" style={{ color: item.color }}>{item.label}</span>
            </div>
          ))}
          <div style={{ width: '1px', height: '12px', backgroundColor: BORDER }} />
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2 rounded-sm" style={{ backgroundColor: '#2ECC7125', border: '1px solid #2ECC7150' }} />
            <span className="text-[10px]" style={{ color: '#2ECC71' }}>Launched</span>
          </div>
          {filteredKlaviyoEmails.length > 0 && (
            <>
              <div style={{ width: '1px', height: '12px', backgroundColor: BORDER }} />
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2 rounded-sm" style={{ backgroundColor: `${KLAVIYO_COLOR}25`, border: `1px solid ${KLAVIYO_COLOR}50` }} />
                <span className="text-[10px]" style={{ color: KLAVIYO_COLOR }}>Klaviyo Email</span>
              </div>
            </>
          )}
          {filteredKlaviyoSMS.length > 0 && (
            <>
              <div style={{ width: '1px', height: '12px', backgroundColor: BORDER }} />
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2 rounded-sm" style={{ backgroundColor: `${KLAVIYO_SMS_COLOR}25`, border: `1px solid ${KLAVIYO_SMS_COLOR}50` }} />
                <span className="text-[10px]" style={{ color: KLAVIYO_SMS_COLOR }}>Klaviyo SMS</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ─── Modals ────────────────────────────────────────── */}
      <AddEventModal
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSave={handleAddEvent}
        saving={saving}
      />

      {/* Toast */}
      {toast && (
        <div
          className="fixed bottom-6 right-6 px-4 py-3 rounded-lg flex items-center gap-2 text-sm font-medium z-50"
          style={{ backgroundColor: `${GOLD}20`, color: GOLD, border: `1px solid ${GOLD}40` }}
        >
          <Check className="w-4 h-4" />
          {toast}
        </div>
      )}
    </Navbar>
  );
}
