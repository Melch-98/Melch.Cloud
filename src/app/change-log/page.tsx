'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Loader,
  FileText,
  Shield,
  BarChart3,
  CalendarDays,
  Mail,
  Users,
  Zap,
  Rocket,
  ChevronDown,
  ChevronUp,
  Tag,
  Lightbulb,
  Plus,
  X,
  Check,
  ArrowUp,
  ArrowDown,
  MessageSquare,
  Clock,
  CheckCircle2,
  XCircle,
  Circle,
  Wrench,
  ClipboardList,
} from 'lucide-react';
import Navbar from '@/components/Navbar';
import { createClient } from '@/lib/supabase';

// ─── Brand Palette ──────────────────────────────────────────────
const GOLD = '#C8B89A';
const GOLD_LIGHT = '#D9CBAE';
const GOLD_DIM = 'rgba(200,184,154,0.18)';
const GOLD_BORDER = 'rgba(200,184,154,0.30)';
const BG_CARD = '#111111';
const BG_HEADER = '#161616';
const BORDER = 'rgba(200,184,154,0.10)';
const BORDER_STRONG = 'rgba(200,184,154,0.18)';
const TEXT_PRIMARY = '#F5F5F8';
const TEXT_MUTED = '#999';
const TEXT_DIM = '#666';

// ─── Types ──────────────────────────────────────────────────────

type ChangeType = 'feature' | 'improvement' | 'fix' | 'security' | 'integration';

interface Change {
  text: string;
  type: ChangeType;
}

interface Release {
  version: string;
  date: string;
  title: string;
  description: string;
  icon: React.ElementType;
  iconColor: string;
  changes: Change[];
  tags: string[];
}

type RequestStatus = 'open' | 'planned' | 'in_progress' | 'shipped' | 'declined';

interface FeatureRequest {
  id: string;
  title: string;
  description: string | null;
  status: RequestStatus;
  category: string;
  submitted_by: string;
  submitted_by_email: string;
  submitted_by_role: string;
  brand_id: string | null;
  admin_note: string | null;
  created_at: string;
  score: number;
  upvotes: number;
  downvotes: number;
  user_vote: number; // 1, -1, or 0
}

// ─── Configs ────────────────────────────────────────────────────

const CHANGE_TYPE_CONFIG: Record<ChangeType, { label: string; color: string }> = {
  feature: { label: 'Feature', color: '#2ECC71' },
  improvement: { label: 'Improvement', color: '#5DADE2' },
  fix: { label: 'Fix', color: '#E8A838' },
  security: { label: 'Security', color: '#E05ABC' },
  integration: { label: 'Integration', color: '#AF7AC5' },
};

const STATUS_CONFIG: Record<RequestStatus, { label: string; color: string; icon: React.ElementType }> = {
  open: { label: 'Open', color: TEXT_MUTED, icon: Circle },
  planned: { label: 'Planned', color: '#5DADE2', icon: Clock },
  in_progress: { label: 'In Progress', color: '#E8A838', icon: Wrench },
  shipped: { label: 'Shipped', color: '#2ECC71', icon: CheckCircle2 },
  declined: { label: 'Declined', color: '#E74C3C', icon: XCircle },
};

const CATEGORIES = [
  { value: 'general', label: 'General' },
  { value: 'analytics', label: 'Analytics' },
  { value: 'calendar', label: 'Calendar' },
  { value: 'upload', label: 'Upload' },
  { value: 'integrations', label: 'Integrations' },
  { value: 'ui', label: 'UI / Design' },
];

// ─── Changelog Data ─────────────────────────────────────────────

const RELEASES: Release[] = [
  {
    version: '1.2.0',
    date: 'April 5, 2026',
    title: 'Copy Templates, Ad Account Changelog & Strategist Workflow',
    description:
      'A full copy template management system lands — create, edit, and organize ad copy templates per brand with collapsible cards for clean navigation. Strategists now pick from saved templates when uploading creatives. Ad account changelog tracks every campaign status change and budget shift across Meta and Google in a real-time timeline, with automated weekly snapshots.',
    icon: ClipboardList,
    iconColor: '#C8B89A',
    tags: ['Copy', 'Changelog', 'Meta', 'Google', 'Automation'],
    changes: [
      { text: 'Copy Templates page — full CRUD for ad copy templates with primary texts, headlines, descriptions, and landing page URL per brand', type: 'feature' },
      { text: 'Copy template cards are now collapsible — collapsed view shows title and field counts, click to expand full details', type: 'improvement' },
      { text: 'Copy template dropdown in strategist uploader — select from saved templates when submitting creatives instead of free-typing', type: 'feature' },
      { text: 'Bulk imported 19 ad copy templates from Google Sheets for Seven Weeks Coffee Co', type: 'feature' },
      { text: 'Ad Account Changelog — snapshot/diff system that detects status changes, budget changes, new entities, and removed campaigns across Meta and Google', type: 'feature' },
      { text: 'Changelog timeline UI with date grouping, color-coded badges, platform filters, and change type filters', type: 'feature' },
      { text: 'Manual "Refresh Now" button to trigger an on-demand ad account scan from the changelog page', type: 'feature' },
      { text: 'Meta integration fetches campaigns and ad sets via Graph API with budget tracking (daily + lifetime)', type: 'integration' },
      { text: 'Google Ads integration via Windsor.ai proxy for campaign status monitoring', type: 'integration' },
      { text: 'Automated weekly ad account snapshot scheduled every Monday at 8 AM', type: 'feature' },
      { text: 'Nav reorganized — Ad Changelog moved above Calendar for quicker access', type: 'improvement' },
      { text: 'Product Change Log now visible to admin only — removes confusion between ad changelog and product changelog', type: 'improvement' },
    ],
  },
  {
    version: '1.1.0',
    date: 'April 4, 2026',
    title: 'P&L Metrics Showcase, Off-Shopify Revenue & Breakdown Panels',
    description:
      'The Daily P&L gets a major upgrade. A 10-metric showcase replaces the old summary cards, covering both blended business health and acquisition efficiency. Off-Shopify revenue (Amazon, Retail) can now be input and distributed daily, flowing into blended calculations. Every metric card is clickable with a full calculation breakdown — revenue waterfalls, formula trees, channel mix percentages, and NC/RC splits.',
    icon: BarChart3,
    iconColor: '#C8B89A',
    tags: ['Analytics', 'P&L', 'Revenue', 'UX'],
    changes: [
      { text: '10-metric showcase — 2-row, 5-column grid replacing the old 6-card summary strip', type: 'feature' },
      { text: 'Clickable metric breakdowns — each card opens a modal showing the full calculation tree, formula, and component values', type: 'feature' },
      { text: 'Off-Shopify Revenue input — monthly Amazon + Retail revenue with lock-to-distribute-daily, mirroring Other Spend pattern', type: 'feature' },
      { text: 'Off-Shopify revenue flows into Net Revenue, updating Blended MER, Contribution, and Margin % automatically', type: 'feature' },
      { text: 'Off-Shopify column in table between Shipping and Net Revenue with purple accent and locked state styling', type: 'feature' },
      { text: 'NC Revenue and RC Revenue columns now display proportionally-allocated net values (calc fields) instead of raw gross', type: 'fix' },
      { text: 'NC/RC Revenue columns styled as calculated (blue text, fx badge, formula tooltips)', type: 'improvement' },
      { text: 'Blended MER breakdown shows Shopify vs Off-Shopify revenue sources', type: 'improvement' },
      { text: 'AMER breakdown notes off-Shopify is excluded since NC attribution is Shopify-only', type: 'improvement' },
      { text: 'NC AOV breakdown includes RC AOV and Blended AOV comparison', type: 'improvement' },
      { text: 'Total Ad Spend breakdown includes channel mix percentages (Meta / Google / Other)', type: 'improvement' },
      { text: 'Contribution breakdown shows Revenue − COGS − Spend waterfall with margin %', type: 'improvement' },
      { text: 'Metric cards feature subtle radial glow on hero metrics (Total Revenue, Blended MER)', type: 'improvement' },
    ],
  },
  {
    version: '1.0.0',
    date: 'April 4, 2026',
    title: 'Ad Perspective, Uptime Monitoring & Brand Assets',
    description:
      'Ad Perspective gets CSV export, friendly error messages, and a rebuilt creative sidecar with full media. BetterStack uptime monitoring and a public status page go live. Date range options trimmed to 90 days max to keep API loads healthy. Brand assets packaged as horizontal wordmark SVGs and PNGs.',
    icon: Rocket,
    iconColor: '#C8B89A',
    tags: ['Analytics', 'Infrastructure', 'Branding', 'DX'],
    changes: [
      { text: 'Ad Perspective sidecar rebuilt — full-res thumbnails and inline video playback restored, matching Top Creatives pattern', type: 'fix' },
      { text: 'CSV export on Ad Perspective — download outlier table data with one click', type: 'feature' },
      { text: 'CSV export on Copy Analysis — same one-click download for copy performance data', type: 'feature' },
      { text: 'Friendly error messages — raw Meta API errors mapped to human-readable explanations across all analytics pages', type: 'improvement' },
      { text: 'Data freshness indicator component added to analytics pages', type: 'feature' },
      { text: 'Removed 6-month, 12-month, and All Time date presets from Ad Perspective to prevent API overload', type: 'improvement' },
      { text: 'Removed in-memory caching layer from meta-insights and copy-analysis API routes for simpler, more predictable data flow', type: 'improvement' },
      { text: 'BetterStack uptime monitoring — 3-minute health checks from US and EU regions with Slack alerts', type: 'feature' },
      { text: 'Public status page live at status.melch.cloud (CNAME to BetterStack)', type: 'feature' },
      { text: 'Horizontal wordmark logos — SVG and PNG exports in dark-bg and light-bg variants at 1x, 2x, and 4x sizes', type: 'feature' },
      { text: 'Dedicated /api/ad-media endpoint for single-ad creative media lookups with full-res image resolution pipeline', type: 'feature' },
    ],
  },
  {
    version: '0.9.0',
    date: 'April 4, 2026',
    title: 'Analytics Premium Redesign',
    description:
      'The analytics page gets a luxury dark minimal facelift. Ad cards, the creative detail sidecar, type badges, and metric displays have all been redesigned with the Melch Cloud gold-accent brand palette for a premium feel that stands on its own.',
    icon: Zap,
    iconColor: '#C8B89A',
    tags: ['Analytics', 'UI / Design', 'Branding'],
    changes: [
      { text: 'Ad cards redesigned — 4:5 portrait aspect ratio, lift-on-hover animation, deeper shadows, and gradient overlays', type: 'improvement' },
      { text: 'Gold-accent play button on video cards, revealed on hover', type: 'improvement' },
      { text: 'Winner glow — cards with ROAS 3x+ get a gold border and ROAS pill overlay', type: 'feature' },
      { text: 'Type badges reworked — glass-morphism style with gold tones, moved to top-left of thumbnail', type: 'improvement' },
      { text: 'Spend and Revenue values tinted gold on ad cards for visual hierarchy', type: 'improvement' },
      { text: 'Creative detail sidecar — hero metric cards (Spend / Revenue / ROAS) in a 3-column grid at the top', type: 'feature' },
      { text: 'ROAS color-coding in sidecar — green for 3x+, gold for 1.5x+, red for sub-1.0', type: 'feature' },
      { text: 'Metric groups in bordered containers with gold section headers and row dividers', type: 'improvement' },
      { text: 'Video player — gold progress bar, gold play/pause controls, frosted play overlay', type: 'improvement' },
      { text: 'Smoother sidecar slide-in with cubic-bezier easing and frosted backdrop blur', type: 'improvement' },
    ],
  },
  {
    version: '0.8.0',
    date: 'April 4, 2026',
    title: 'Full-Res Thumbnails & Video Playback',
    description:
      'Every ad creative thumbnail is now served at full resolution from our own CDN. Video ads play directly in the dashboard. This release fixed multiple root causes that had been producing blurry 64px thumbnails across both ad accounts.',
    icon: BarChart3,
    iconColor: '#5DADE2',
    tags: ['Analytics', 'Meta Ads', 'CDN', 'Infrastructure'],
    changes: [
      { text: 'Vercel Blob CDN — all creative images cached and served from our own CDN permanently', type: 'feature' },
      { text: 'Fixed URL encoding bug — creative{id} was not URL-encoded, causing Step 2a to silently fail (zero creative IDs fetched)', type: 'fix' },
      { text: 'Meta system user token upgraded with ads_management permission for full creative field access', type: 'fix' },
      { text: 'Image hash resolution — Advantage+ creatives with only hash (no URL) now resolved via adimages endpoint', type: 'feature' },
      { text: 'Asset feed spec video thumbnails — thumbnail_url extracted from asset_feed_spec.videos for flexible video creatives', type: 'fix' },
      { text: 'Video source URLs — switched from direct /?ids= (permission denied) to advideos endpoint on the ad account', type: 'fix' },
      { text: 'Video playback restored — 24 of 28 video ads now play directly in analytics cards and sidecar', type: 'fix' },
      { text: 'Blob caching runs in batches of 10 concurrent downloads with best-effort fallback', type: 'improvement' },
      { text: 'maxDuration = 60 on insights API route to prevent Vercel timeout during creative fetching', type: 'improvement' },
    ],
  },
  {
    version: '0.7.0',
    date: 'April 4, 2026',
    title: 'Feature Requests & Voting',
    description:
      'Users can now submit feature requests, upvote or downvote ideas from others, and track status as requests move from open to shipped. Admins can manage statuses and leave notes.',
    icon: Lightbulb,
    iconColor: '#E8A838',
    tags: ['Community', 'Change Log', 'Collaboration'],
    changes: [
      { text: 'Feature request submission form with title, description, and category', type: 'feature' },
      { text: 'Upvote and downvote system — one vote per user per request', type: 'feature' },
      { text: 'Status tracking: Open → Planned → In Progress → Shipped / Declined', type: 'feature' },
      { text: 'Admin status management with dropdown controls', type: 'feature' },
      { text: 'Admin notes on feature requests (visible to all users)', type: 'feature' },
      { text: 'Sort by votes, newest, or status', type: 'improvement' },
      { text: 'Status filter to view requests by lifecycle stage', type: 'improvement' },
      { text: 'Tabbed layout — Releases and Feature Requests on the same page', type: 'improvement' },
    ],
  },
  {
    version: '0.6.0',
    date: 'April 4, 2026',
    title: 'Klaviyo Email Integration',
    description:
      'The calendar now automatically pulls sent and scheduled email campaigns from Klaviyo. Each brand\'s Klaviyo account is connected via API key, and campaigns appear as green pills on the calendar alongside creative launches and manual events.',
    icon: Mail,
    iconColor: '#6BC06B',
    tags: ['Calendar', 'Integrations', 'Klaviyo'],
    changes: [
      { text: 'Klaviyo API integration — fetches sent and scheduled email campaigns per brand', type: 'integration' },
      { text: 'New brand_integrations table for storing third-party API keys securely', type: 'feature' },
      { text: 'Klaviyo campaigns render as green pills with send date in the calendar', type: 'feature' },
      { text: 'SMS campaign support included (renders as sky-blue pills when present)', type: 'feature' },
      { text: 'Non-blocking fetch — calendar loads instantly, Klaviyo data populates in background', type: 'improvement' },
      { text: 'Per-brand Klaviyo fetch respects the brand filter dropdown', type: 'improvement' },
      { text: 'Loading spinner shown while Klaviyo campaigns are being fetched', type: 'improvement' },
    ],
  },
  {
    version: '0.5.0',
    date: 'April 4, 2026',
    title: 'Full-Year Calendar',
    description:
      'A brand-new calendar page gives admin and strategists a bird\'s-eye view of the entire year — holidays, promotional moments, creative batch launches, and manual marketing events all in one place.',
    icon: CalendarDays,
    iconColor: '#E8A838',
    tags: ['Calendar', 'Planning', 'Admin'],
    changes: [
      { text: 'Full-year calendar grid with month columns and categorized rows', type: 'feature' },
      { text: 'Hemisphere toggle — view Northern, Southern, or both hemisphere holidays', type: 'feature' },
      { text: 'Holidays, Promotional Moments, and Cultural Moments rows with color-coded pills', type: 'feature' },
      { text: 'Creative Launches section — shows only launched batches as green pills with go-live date', type: 'feature' },
      { text: 'Manual Marketing Comms — add custom events with title, channel, and date', type: 'feature' },
      { text: 'Brand filter dropdown for admin (strategists locked to their own brand)', type: 'feature' },
      { text: 'Year navigation with arrow controls', type: 'feature' },
      { text: 'Premium dark styling with gold-accented melch.cloud branding', type: 'improvement' },
      { text: 'Admin can delete manual events on hover', type: 'feature' },
      { text: 'Calendar Events table migration (calendar_events) with RLS policies', type: 'feature' },
    ],
  },
  {
    version: '0.4.0',
    date: 'April 4, 2026',
    title: 'Permission Enforcement & Security',
    description:
      'All API routes and protected pages now enforce granular permissions. Previously, permissions were stored in the database but never actually checked — this release closes that gap entirely.',
    icon: Shield,
    iconColor: '#E05ABC',
    tags: ['Security', 'API', 'Permissions'],
    changes: [
      { text: 'Shared authenticateRequest() helper — verifies JWT, fetches profile + permissions in one call', type: 'security' },
      { text: '/api/export — now requires auth + can_download permission', type: 'security' },
      { text: '/api/batch-download — now requires auth + can_download; strategists scoped to own brand', type: 'security' },
      { text: '/api/batch-delete — now requires auth + can_delete; strategists scoped to own brand', type: 'security' },
      { text: '/api/batch-status — now requires auth + admin role', type: 'security' },
      { text: 'Upload page checks can_upload permission for strategists', type: 'security' },
      { text: 'Submissions page checks can_view_pipeline permission for strategists', type: 'security' },
      { text: 'Admins automatically receive all permissions by default', type: 'improvement' },
      { text: 'Client-side auth token passing via getAuthHeaders() helper in admin page', type: 'improvement' },
    ],
  },
  {
    version: '0.3.0',
    date: 'April 4, 2026',
    title: 'Analytics Enhancements',
    description:
      'Higher resolution ad creative images and Link CTR replaces CTR (All) as the default metric across the analytics dashboard.',
    icon: BarChart3,
    iconColor: '#5DADE2',
    tags: ['Analytics', 'Meta Ads'],
    changes: [
      { text: 'Ad card images now use full-resolution image_url instead of 64px thumbnail_url', type: 'improvement' },
      { text: 'Link CTR (inline_link_click_ctr) replaces CTR (All) as the default card metric', type: 'improvement' },
      { text: 'Summary row computes impression-weighted Link CTR across all visible ads', type: 'fix' },
      { text: 'Beta badge added to Analytics nav link', type: 'improvement' },
    ],
  },
  {
    version: '0.2.0',
    date: 'April 3, 2026',
    title: 'Team Management & Brand Onboarding',
    description:
      'New team management capabilities and brand onboarding. Strategist accounts can be created with granular permissions, and new ad accounts can be linked to brands.',
    icon: Users,
    iconColor: '#AF7AC5',
    tags: ['Team', 'Onboarding', 'Admin'],
    changes: [
      { text: 'Team page redesign with role-based user management', type: 'feature' },
      { text: 'Seven Weeks Coffee Co ad account linked (act_1090524680973626)', type: 'feature' },
      { text: 'Madison (madison@tallowtwins.ca) onboarded as Creative Strategist for Tallow Twins', type: 'feature' },
      { text: 'Granular permission assignment: upload, view pipeline, download, delete', type: 'feature' },
    ],
  },
  {
    version: '0.1.0',
    date: 'April 2, 2026',
    title: 'Foundation — Creative Upload Portal',
    description:
      'Initial release of melch.cloud — a creative upload portal with batch management, file tracking, analytics, and multi-brand support.',
    icon: Rocket,
    iconColor: '#2ECC71',
    tags: ['Launch', 'Core Platform'],
    changes: [
      { text: 'Creative upload flow with batch naming, type selection, and multi-file support', type: 'feature' },
      { text: 'Admin Creative Queue with batch status management (new → building → ready → launched)', type: 'feature' },
      { text: 'Submissions pipeline for strategists with file preview and status tracking', type: 'feature' },
      { text: 'Multi-brand architecture with brand-scoped data isolation', type: 'feature' },
      { text: 'Meta Ads analytics dashboard with per-creative performance cards', type: 'feature' },
      { text: 'Statistics page with aggregate performance metrics', type: 'feature' },
      { text: 'Supabase Auth with role-based access control (admin / strategist)', type: 'feature' },
      { text: 'Responsive dark-mode UI with melch.cloud gold branding', type: 'feature' },
    ],
  },
];

// ═════════════════════════════════════════════════════════════════
// ─── Sub-Components ─────────────────────────────────────────────
// ═════════════════════════════════════════════════════════════════

function TypeBadge({ type }: { type: ChangeType }) {
  const config = CHANGE_TYPE_CONFIG[type];
  return (
    <span
      className="inline-flex items-center px-1.5 py-[2px] rounded text-[9px] font-bold uppercase tracking-wider flex-shrink-0"
      style={{ backgroundColor: `${config.color}18`, color: config.color, border: `1px solid ${config.color}30` }}
    >
      {config.label}
    </span>
  );
}

function StatusBadge({ status }: { status: RequestStatus }) {
  const config = STATUS_CONFIG[status];
  const Icon = config.icon;
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-[3px] rounded text-[10px] font-bold uppercase tracking-wider"
      style={{ backgroundColor: `${config.color}15`, color: config.color, border: `1px solid ${config.color}30` }}
    >
      <Icon size={10} />
      {config.label}
    </span>
  );
}

function ReleaseCard({ release, isLatest }: { release: Release; isLatest: boolean }) {
  const [expanded, setExpanded] = useState(isLatest);
  const Icon = release.icon;

  return (
    <div
      className="rounded-xl overflow-hidden transition-all"
      style={{
        backgroundColor: BG_CARD,
        border: `1px solid ${isLatest ? GOLD_BORDER : BORDER_STRONG}`,
        boxShadow: isLatest ? '0 4px 24px rgba(200,184,154,0.08)' : '0 2px 12px rgba(0,0,0,0.2)',
      }}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left px-6 py-5 flex items-start gap-4 transition-colors"
        style={{ backgroundColor: expanded ? BG_HEADER : 'transparent' }}
      >
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
          style={{ backgroundColor: `${release.iconColor}15`, border: `1px solid ${release.iconColor}30` }}
        >
          <Icon size={18} style={{ color: release.iconColor }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <span
              className="text-xs font-bold px-2 py-0.5 rounded"
              style={{
                backgroundColor: isLatest ? `${GOLD}20` : 'rgba(255,255,255,0.06)',
                color: isLatest ? GOLD : TEXT_MUTED,
                border: isLatest ? `1px solid ${GOLD}30` : '1px solid rgba(255,255,255,0.08)',
              }}
            >
              v{release.version}
            </span>
            {isLatest && (
              <span
                className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                style={{ backgroundColor: '#2ECC7120', color: '#2ECC71', border: '1px solid #2ECC7130' }}
              >
                Latest
              </span>
            )}
            <span className="text-xs" style={{ color: TEXT_DIM }}>{release.date}</span>
          </div>
          <h3 className="text-base font-bold mt-1.5" style={{ color: TEXT_PRIMARY }}>{release.title}</h3>
          <p className="text-sm mt-1 leading-relaxed" style={{ color: TEXT_MUTED }}>{release.description}</p>
          <div className="flex flex-wrap gap-1.5 mt-3">
            {release.tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full"
                style={{ backgroundColor: 'rgba(255,255,255,0.04)', color: TEXT_DIM, border: '1px solid rgba(255,255,255,0.06)' }}
              >
                <Tag size={8} />{tag}
              </span>
            ))}
          </div>
        </div>
        <div className="flex-shrink-0 mt-1" style={{ color: TEXT_DIM }}>
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </button>
      {expanded && (
        <div className="px-6 pb-5 pt-2" style={{ borderTop: `1px solid ${BORDER}` }}>
          <div className="space-y-2.5 ml-14">
            {release.changes.map((change, i) => (
              <div key={i} className="flex items-start gap-2.5">
                <TypeBadge type={change.type} />
                <span className="text-sm leading-relaxed" style={{ color: '#CCC' }}>{change.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Vote Button Component ──────────────────────────────────────

function VoteControl({
  score,
  userVote,
  onVote,
  disabled,
}: {
  score: number;
  userVote: number;
  onVote: (vote: number) => void;
  disabled: boolean;
}) {
  const scoreColor = score > 0 ? '#2ECC71' : score < 0 ? '#E74C3C' : TEXT_DIM;

  return (
    <div className="flex flex-col items-center gap-0.5">
      <button
        onClick={() => onVote(userVote === 1 ? 0 : 1)}
        disabled={disabled}
        className="p-1 rounded transition-all"
        style={{
          color: userVote === 1 ? '#2ECC71' : TEXT_DIM,
          backgroundColor: userVote === 1 ? '#2ECC7115' : 'transparent',
        }}
        title="Upvote"
      >
        <ArrowUp size={16} strokeWidth={userVote === 1 ? 3 : 2} />
      </button>
      <span className="text-sm font-bold tabular-nums" style={{ color: scoreColor }}>
        {score}
      </span>
      <button
        onClick={() => onVote(userVote === -1 ? 0 : -1)}
        disabled={disabled}
        className="p-1 rounded transition-all"
        style={{
          color: userVote === -1 ? '#E74C3C' : TEXT_DIM,
          backgroundColor: userVote === -1 ? '#E74C3C15' : 'transparent',
        }}
        title="Downvote"
      >
        <ArrowDown size={16} strokeWidth={userVote === -1 ? 3 : 2} />
      </button>
    </div>
  );
}

// ─── Feature Request Card ───────────────────────────────────────

function FeatureRequestCard({
  request,
  isAdmin,
  onVote,
  onStatusChange,
  voting,
}: {
  request: FeatureRequest;
  isAdmin: boolean;
  onVote: (featureId: string, vote: number) => void;
  onStatusChange: (featureId: string, status: RequestStatus) => void;
  voting: boolean;
}) {
  const [showStatusDropdown, setShowStatusDropdown] = useState(false);
  const categoryLabel = CATEGORIES.find((c) => c.value === request.category)?.label || request.category;
  const timeAgo = getTimeAgo(request.created_at);

  return (
    <div
      className="rounded-xl p-4 flex gap-4 transition-all"
      style={{
        backgroundColor: BG_CARD,
        border: `1px solid ${BORDER_STRONG}`,
      }}
    >
      {/* Vote controls */}
      <VoteControl
        score={request.score}
        userVote={request.user_vote}
        onVote={(vote) => onVote(request.id, vote)}
        disabled={voting}
      />

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <h4 className="text-sm font-bold" style={{ color: TEXT_PRIMARY }}>{request.title}</h4>
            {request.description && (
              <p className="text-xs mt-1 leading-relaxed" style={{ color: TEXT_MUTED }}>
                {request.description}
              </p>
            )}
          </div>

          {/* Status badge / admin dropdown */}
          {isAdmin ? (
            <div className="relative flex-shrink-0">
              <button onClick={() => setShowStatusDropdown(!showStatusDropdown)}>
                <StatusBadge status={request.status} />
              </button>
              {showStatusDropdown && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setShowStatusDropdown(false)} />
                  <div
                    className="absolute top-full right-0 mt-1 w-40 rounded-lg py-1 z-40"
                    style={{ backgroundColor: '#1A1A1A', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}
                  >
                    {(Object.entries(STATUS_CONFIG) as [RequestStatus, typeof STATUS_CONFIG[RequestStatus]][]).map(
                      ([key, config]) => {
                        const StatusIcon = config.icon;
                        return (
                          <button
                            key={key}
                            onClick={() => {
                              onStatusChange(request.id, key);
                              setShowStatusDropdown(false);
                            }}
                            className="w-full text-left px-3 py-2 text-xs flex items-center gap-2 transition-colors"
                            style={{
                              color: request.status === key ? config.color : '#CCC',
                              backgroundColor: request.status === key ? `${config.color}10` : 'transparent',
                            }}
                          >
                            <StatusIcon size={12} />
                            {config.label}
                            {request.status === key && <Check size={10} className="ml-auto" />}
                          </button>
                        );
                      }
                    )}
                  </div>
                </>
              )}
            </div>
          ) : (
            <StatusBadge status={request.status} />
          )}
        </div>

        {/* Meta */}
        <div className="flex items-center gap-3 mt-2.5 flex-wrap">
          <span
            className="text-[10px] px-1.5 py-[2px] rounded font-medium"
            style={{ backgroundColor: 'rgba(255,255,255,0.04)', color: TEXT_DIM, border: '1px solid rgba(255,255,255,0.06)' }}
          >
            {categoryLabel}
          </span>
          <span className="text-[10px]" style={{ color: TEXT_DIM }}>
            {request.submitted_by_email?.split('@')[0]} · {timeAgo}
          </span>
        </div>

        {/* Admin note */}
        {request.admin_note && (
          <div
            className="mt-3 px-3 py-2 rounded-lg flex items-start gap-2"
            style={{ backgroundColor: `${GOLD}08`, border: `1px solid ${GOLD}15` }}
          >
            <MessageSquare size={12} style={{ color: GOLD, marginTop: '2px' }} />
            <p className="text-xs leading-relaxed" style={{ color: GOLD_LIGHT }}>
              {request.admin_note}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Submit Request Modal ───────────────────────────────────────

function SubmitRequestModal({
  open,
  onClose,
  onSubmit,
  saving,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (title: string, description: string, category: string) => void;
  saving: boolean;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('general');

  useEffect(() => {
    if (open) { setTitle(''); setDescription(''); setCategory('general'); }
  }, [open]);

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-40" onClick={onClose} />
      <div
        className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg rounded-xl p-6 z-50 space-y-4"
        style={{ backgroundColor: '#141414', border: '1px solid rgba(255,255,255,0.08)' }}
      >
        <div>
          <h3 className="text-lg font-bold" style={{ color: TEXT_PRIMARY }}>Request a Feature</h3>
          <p className="text-xs mt-1" style={{ color: TEXT_DIM }}>
            Describe what you&apos;d like to see in melch.cloud.
          </p>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-[10px] font-medium block mb-1.5 uppercase tracking-wider" style={{ color: TEXT_DIM }}>Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Dark mode for the upload page"
              autoFocus
              className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
              style={{ backgroundColor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: TEXT_PRIMARY }}
            />
          </div>

          <div>
            <label className="text-[10px] font-medium block mb-1.5 uppercase tracking-wider" style={{ color: TEXT_DIM }}>Description (optional)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add more detail about what you're looking for..."
              rows={3}
              className="w-full px-3 py-2.5 rounded-lg text-sm outline-none resize-none"
              style={{ backgroundColor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: TEXT_PRIMARY }}
            />
          </div>

          <div>
            <label className="text-[10px] font-medium block mb-1.5 uppercase tracking-wider" style={{ color: TEXT_DIM }}>Category</label>
            <div className="flex flex-wrap gap-1.5">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.value}
                  onClick={() => setCategory(cat.value)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                  style={{
                    backgroundColor: category === cat.value ? GOLD_DIM : 'rgba(255,255,255,0.04)',
                    color: category === cat.value ? GOLD : TEXT_MUTED,
                    border: `1px solid ${category === cat.value ? GOLD_BORDER : 'rgba(255,255,255,0.06)'}`,
                  }}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium" style={{ color: TEXT_MUTED }}>Cancel</button>
          <button
            onClick={() => { if (title.trim()) onSubmit(title.trim(), description.trim(), category); }}
            disabled={!title.trim() || saving}
            className="px-4 py-2 rounded-lg text-sm font-bold transition-all"
            style={{
              backgroundColor: title.trim() ? GOLD : `${GOLD}30`,
              color: title.trim() ? '#0A0A0A' : '#666',
              opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? 'Submitting...' : 'Submit Request'}
          </button>
        </div>
      </div>
    </>
  );
}

// ─── Helpers ────────────────────────────────────────────────────

function getTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ═════════════════════════════════════════════════════════════════
// ─── Main Page ──────────────────────────────────────────────────
// ═════════════════════════════════════════════════════════════════

export default function ChangeLogPage() {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState<string | null>(null);

  // Tabs
  const [activeTab, setActiveTab] = useState<'releases' | 'requests'>('releases');

  // Releases
  const [filterType, setFilterType] = useState<ChangeType | 'all'>('all');

  // Feature requests
  const [requests, setRequests] = useState<FeatureRequest[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [voting, setVoting] = useState(false);
  const [sortBy, setSortBy] = useState<'votes' | 'newest' | 'status'>('votes');
  const [statusFilter, setStatusFilter] = useState<RequestStatus | 'all'>('all');
  const [toast, setToast] = useState('');

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2500);
  };

  const getAuthHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return {};
    return { Authorization: `Bearer ${session.access_token}` };
  }, [supabase]);

  // Auth check
  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push('/'); return; }

      const { data: profile } = await supabase
        .from('users_profile')
        .select('role')
        .eq('id', session.user.id)
        .single();

      setUserRole(profile?.role || null);
      setLoading(false);
    };
    checkAuth();
  }, [supabase, router]);

  // Fetch feature requests
  const fetchRequests = useCallback(async () => {
    setRequestsLoading(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/feature-requests', { headers });
      if (res.ok) {
        const json = await res.json();
        setRequests(json.requests || []);
      }
    } catch {
      // table might not exist yet
    }
    setRequestsLoading(false);
  }, [getAuthHeaders]);

  useEffect(() => {
    if (!loading) fetchRequests();
  }, [loading, fetchRequests]);

  // Submit request
  const handleSubmit = useCallback(async (title: string, description: string, category: string) => {
    setSaving(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/feature-requests', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description, category }),
      });
      if (res.ok) {
        const json = await res.json();
        setRequests((prev) => [json.request, ...prev]);
        setShowSubmitModal(false);
        showToast('Feature request submitted');
      }
    } catch {
      showToast('Failed to submit');
    }
    setSaving(false);
  }, [getAuthHeaders]);

  // Vote
  const handleVote = useCallback(async (featureId: string, vote: number) => {
    setVoting(true);
    // Optimistic update
    setRequests((prev) =>
      prev.map((r) => {
        if (r.id !== featureId) return r;
        const oldVote = r.user_vote;
        const scoreDelta = vote - oldVote;
        return {
          ...r,
          user_vote: vote,
          score: r.score + scoreDelta,
          upvotes: r.upvotes + (vote === 1 ? 1 : 0) - (oldVote === 1 ? 1 : 0),
          downvotes: r.downvotes + (vote === -1 ? 1 : 0) - (oldVote === -1 ? 1 : 0),
        };
      })
    );

    try {
      const headers = await getAuthHeaders();
      await fetch('/api/feature-requests/vote', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ feature_id: featureId, vote }),
      });
    } catch {
      // Revert on failure
      fetchRequests();
    }
    setVoting(false);
  }, [getAuthHeaders, fetchRequests]);

  // Admin status change
  const handleStatusChange = useCallback(async (featureId: string, status: RequestStatus) => {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/feature-requests/status', {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ feature_id: featureId, status }),
      });
      if (res.ok) {
        setRequests((prev) =>
          prev.map((r) => (r.id === featureId ? { ...r, status } : r))
        );
        showToast(`Status updated to ${STATUS_CONFIG[status].label}`);
      }
    } catch {
      showToast('Failed to update status');
    }
  }, [getAuthHeaders]);

  if (loading) {
    return (
      <Navbar>
        <div className="min-h-screen flex items-center justify-center">
          <Loader className="w-8 h-8 animate-spin" style={{ color: GOLD }} />
        </div>
      </Navbar>
    );
  }

  const isAdmin = userRole === 'admin';

  // Filter & sort requests
  const filteredRequests = requests
    .filter((r) => statusFilter === 'all' || r.status === statusFilter)
    .sort((a, b) => {
      if (sortBy === 'votes') return b.score - a.score;
      if (sortBy === 'newest') return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      // status: open → planned → in_progress → shipped → declined
      const order = ['open', 'planned', 'in_progress', 'shipped', 'declined'];
      return order.indexOf(a.status) - order.indexOf(b.status);
    });

  // Filter releases
  const filteredReleases = filterType === 'all'
    ? RELEASES
    : RELEASES.map((r) => ({ ...r, changes: r.changes.filter((c) => c.type === filterType) })).filter((r) => r.changes.length > 0);

  const totalChanges = RELEASES.reduce((acc, r) => acc + r.changes.length, 0);

  return (
    <Navbar>
      <div className="p-6 md:p-8 max-w-4xl mx-auto">
        {/* ─── Header ──────────────────────────────────────── */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-2">
            <FileText size={24} style={{ color: GOLD_LIGHT }} />
            <h1 className="text-2xl font-bold tracking-tight" style={{ color: TEXT_PRIMARY }}>
              Change Log
            </h1>
          </div>
          <p className="text-sm" style={{ color: TEXT_DIM }}>
            Track releases and shape what&apos;s next — {RELEASES.length} releases, {totalChanges} changes, {requests.length} feature requests.
          </p>
        </div>

        {/* ─── Tabs ────────────────────────────────────────── */}
        <div className="flex items-center gap-1 mb-6 p-1 rounded-lg" style={{ backgroundColor: 'rgba(255,255,255,0.03)', border: `1px solid ${BORDER}` }}>
          <button
            onClick={() => setActiveTab('releases')}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-md text-sm font-semibold transition-all"
            style={{
              backgroundColor: activeTab === 'releases' ? GOLD_DIM : 'transparent',
              color: activeTab === 'releases' ? GOLD : TEXT_DIM,
            }}
          >
            <Zap size={14} />
            Releases
            <span
              className="text-[10px] px-1.5 py-0.5 rounded-full font-bold"
              style={{ backgroundColor: activeTab === 'releases' ? `${GOLD}20` : 'rgba(255,255,255,0.06)', color: activeTab === 'releases' ? GOLD : TEXT_DIM }}
            >
              {RELEASES.length}
            </span>
          </button>
          <button
            onClick={() => setActiveTab('requests')}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-md text-sm font-semibold transition-all"
            style={{
              backgroundColor: activeTab === 'requests' ? GOLD_DIM : 'transparent',
              color: activeTab === 'requests' ? GOLD : TEXT_DIM,
            }}
          >
            <Lightbulb size={14} />
            Feature Requests
            <span
              className="text-[10px] px-1.5 py-0.5 rounded-full font-bold"
              style={{ backgroundColor: activeTab === 'requests' ? `${GOLD}20` : 'rgba(255,255,255,0.06)', color: activeTab === 'requests' ? GOLD : TEXT_DIM }}
            >
              {requests.length}
            </span>
          </button>
        </div>

        {/* ═══════════════════════════════════════════════════ */}
        {/* ─── Releases Tab ─────────────────────────────────  */}
        {/* ═══════════════════════════════════════════════════ */}
        {activeTab === 'releases' && (
          <>
            {/* Type filters */}
            <div className="flex flex-wrap gap-2 mb-6">
              <button
                onClick={() => setFilterType('all')}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                style={{
                  backgroundColor: filterType === 'all' ? GOLD_DIM : 'rgba(255,255,255,0.04)',
                  color: filterType === 'all' ? GOLD : TEXT_DIM,
                  border: `1px solid ${filterType === 'all' ? GOLD_BORDER : 'rgba(255,255,255,0.06)'}`,
                }}
              >
                All
              </button>
              {(Object.entries(CHANGE_TYPE_CONFIG) as [ChangeType, { label: string; color: string }][]).map(
                ([type, config]) => (
                  <button
                    key={type}
                    onClick={() => setFilterType(type)}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                    style={{
                      backgroundColor: filterType === type ? `${config.color}18` : 'rgba(255,255,255,0.04)',
                      color: filterType === type ? config.color : TEXT_DIM,
                      border: `1px solid ${filterType === type ? `${config.color}30` : 'rgba(255,255,255,0.06)'}`,
                    }}
                  >
                    {config.label}
                  </button>
                )
              )}
            </div>

            {/* Timeline */}
            <div className="relative">
              <div className="absolute left-[19px] top-0 bottom-0 w-[2px]" style={{ backgroundColor: BORDER_STRONG }} />
              <div className="space-y-6">
                {filteredReleases.map((release, i) => (
                  <div key={release.version} className="relative flex items-start gap-6">
                    <div
                      className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 z-10"
                      style={{
                        backgroundColor: i === 0 ? `${GOLD}20` : BG_HEADER,
                        border: `2px solid ${i === 0 ? GOLD : BORDER_STRONG}`,
                      }}
                    >
                      <Zap size={14} style={{ color: i === 0 ? GOLD : TEXT_DIM }} />
                    </div>
                    <div className="flex-1 min-w-0 -mt-1">
                      <ReleaseCard release={release} isLatest={i === 0} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* ═══════════════════════════════════════════════════ */}
        {/* ─── Feature Requests Tab ─────────────────────────  */}
        {/* ═══════════════════════════════════════════════════ */}
        {activeTab === 'requests' && (
          <>
            {/* Controls */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
              <div className="flex flex-wrap gap-2">
                {/* Status filters */}
                <button
                  onClick={() => setStatusFilter('all')}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                  style={{
                    backgroundColor: statusFilter === 'all' ? GOLD_DIM : 'rgba(255,255,255,0.04)',
                    color: statusFilter === 'all' ? GOLD : TEXT_DIM,
                    border: `1px solid ${statusFilter === 'all' ? GOLD_BORDER : 'rgba(255,255,255,0.06)'}`,
                  }}
                >
                  All
                </button>
                {(Object.entries(STATUS_CONFIG) as [RequestStatus, typeof STATUS_CONFIG[RequestStatus]][]).map(
                  ([key, config]) => (
                    <button
                      key={key}
                      onClick={() => setStatusFilter(key)}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                      style={{
                        backgroundColor: statusFilter === key ? `${config.color}18` : 'rgba(255,255,255,0.04)',
                        color: statusFilter === key ? config.color : TEXT_DIM,
                        border: `1px solid ${statusFilter === key ? `${config.color}30` : 'rgba(255,255,255,0.06)'}`,
                      }}
                    >
                      {config.label}
                    </button>
                  )
                )}
              </div>

              <div className="flex items-center gap-2">
                {/* Sort */}
                <div className="flex rounded-lg overflow-hidden" style={{ border: `1px solid ${BORDER}` }}>
                  {(['votes', 'newest', 'status'] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() => setSortBy(s)}
                      className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors"
                      style={{
                        backgroundColor: sortBy === s ? GOLD_DIM : 'rgba(255,255,255,0.04)',
                        color: sortBy === s ? GOLD : TEXT_DIM,
                      }}
                    >
                      {s === 'votes' ? 'Top' : s === 'newest' ? 'New' : 'Status'}
                    </button>
                  ))}
                </div>

                {/* Submit button */}
                <button
                  onClick={() => setShowSubmitModal(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
                  style={{ backgroundColor: GOLD, color: '#0A0A0A' }}
                >
                  <Plus size={14} />
                  Request
                </button>
              </div>
            </div>

            {/* Request list */}
            {requestsLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader className="w-6 h-6 animate-spin" style={{ color: GOLD }} />
              </div>
            ) : filteredRequests.length > 0 ? (
              <div className="space-y-3">
                {filteredRequests.map((req) => (
                  <FeatureRequestCard
                    key={req.id}
                    request={req}
                    isAdmin={isAdmin}
                    onVote={handleVote}
                    onStatusChange={handleStatusChange}
                    voting={voting}
                  />
                ))}
              </div>
            ) : (
              <div
                className="rounded-xl py-16 text-center"
                style={{ backgroundColor: BG_CARD, border: `1px solid ${BORDER_STRONG}` }}
              >
                <Lightbulb size={32} style={{ color: TEXT_DIM }} className="mx-auto mb-3" />
                <p className="text-sm font-medium" style={{ color: TEXT_MUTED }}>
                  {requests.length === 0
                    ? 'No feature requests yet. Be the first!'
                    : 'No requests match this filter.'}
                </p>
                <button
                  onClick={() => setShowSubmitModal(true)}
                  className="mt-4 px-4 py-2 rounded-lg text-sm font-bold"
                  style={{ backgroundColor: GOLD, color: '#0A0A0A' }}
                >
                  Submit a Request
                </button>
              </div>
            )}
          </>
        )}

        {/* ─── Footer ──────────────────────────────────────── */}
        <div className="mt-12 text-center">
          <p className="text-xs" style={{ color: TEXT_DIM }}>
            melch.cloud is under active development. This log is updated with every release.
          </p>
        </div>
      </div>

      {/* ─── Modals ────────────────────────────────────────── */}
      <SubmitRequestModal
        open={showSubmitModal}
        onClose={() => setShowSubmitModal(false)}
        onSubmit={handleSubmit}
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
