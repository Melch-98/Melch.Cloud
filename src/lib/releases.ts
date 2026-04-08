// ─── Release data ──────────────────────────────────────────────
// Single source of truth for the release history shown on /releases.
// Edit this file when shipping a new release — no DB required.

import {
  BarChart3,
  CalendarDays,
  ClipboardList,
  Lightbulb,
  Mail,
  Rocket,
  Shield,
  Users,
  Zap,
  type LucideIcon,
} from 'lucide-react';

export type ChangeType = 'feature' | 'improvement' | 'fix' | 'security' | 'integration';

export interface Change {
  text: string;
  type: ChangeType;
}

export interface Release {
  version: string;
  date: string;
  title: string;
  description: string;
  icon: LucideIcon;
  iconColor: string;
  changes: Change[];
  tags: string[];
}

export const CHANGE_TYPE_CONFIG: Record<ChangeType, { label: string; color: string }> = {
  feature: { label: 'Feature', color: '#2ECC71' },
  improvement: { label: 'Improvement', color: '#5DADE2' },
  fix: { label: 'Fix', color: '#E8A838' },
  security: { label: 'Security', color: '#E05ABC' },
  integration: { label: 'Integration', color: '#AF7AC5' },
};

export const RELEASES: Release[] = [
  {
    version: '1.4.0',
    date: 'April 8, 2026',
    title: 'Dropbox Creative Pipeline',
    description:
      'Killed the Google Drive service-account-zero-quota trap. Creative batches now sync straight from client uploads into a user-owned Dropbox (google@melch.media, 2TB) via OAuth refresh token, sandboxed to /Apps/Melch.Cloud/{Brand}/{Batch}. Blip pulls from there. No more daily sign-ins, no more shared drive dead ends.',
    icon: Rocket,
    iconColor: '#C8B89A',
    tags: ['Infrastructure', 'Dropbox', 'Creative Pipeline'],
    changes: [
      { text: 'Replaced Google Drive sync with Dropbox as single creative destination — OAuth2 refresh token stored in integrations table, no service account', type: 'integration' },
      { text: 'Fetch-based Dropbox client (src/lib/dropbox.ts) with access-token caching, 2-min refresh buffer, and chunked upload for files >150MB', type: 'feature' },
      { text: '/api/auth/dropbox/start + /callback OAuth consent flow with offline access — connect once, never sign in again', type: 'feature' },
      { text: '/api/submissions/sync-drive rewritten as synchronous Supabase Storage → Dropbox push, eliminating Inngest drive-functions backlog', type: 'improvement' },
      { text: '/api/submissions/mark-launched admin endpoint + launched_at column for manual Submitted → Launched status flip (no approve/reject gate)', type: 'feature' },
      { text: '/admin/dropbox status page with Connect button, token status, and setup checklist', type: 'feature' },
      { text: 'brands.dropbox_folder_path per-brand mapping — FOND Regenerative, Organic Jaguar, Seven Weeks Coffee Co, Tallow Twins all wired', type: 'feature' },
      { text: 'integrations table with service-scoped refresh/access tokens + RLS enabled for any future OAuth integration', type: 'feature' },
      { text: 'Callback route hardened — structured logging on every step, graceful handling of missing refresh_token on re-consent, explicit upsert error surfacing', type: 'fix' },
      { text: 'Removed src/lib/google-drive.ts, src/lib/inngest/drive-functions.ts, and /api/admin/test-drive-sync — Drive era fully retired', type: 'improvement' },
    ],
  },
  {
    version: '1.3.0',
    date: 'April 7, 2026',
    title: 'Inngest Background Jobs & Real-Time Shopify Pipeline',
    description:
      'Polling is dead. Melch Cloud now runs an Inngest-powered background job runner and a custom Shopify app that streams order, refund, and uninstall events into Supabase the instant they happen. Replaces the per-brand polling cron with a single real-time pipeline that scales across every client store.',
    icon: Zap,
    iconColor: '#C8B89A',
    tags: ['Infrastructure', 'Shopify', 'Inngest', 'Real-Time'],
    changes: [
      { text: 'Inngest background job runner deployed with /api/inngest serve handler — production-ready event bus for all async work', type: 'feature' },
      { text: 'Typed Inngest event registry with discriminated unions for compile-time safety on every event payload', type: 'feature' },
      { text: 'Custom Shopify app (Melch Cloud) created in Partners with OAuth install + callback flow', type: 'feature' },
      { text: 'Shopify HMAC verification on both OAuth callback (query string) and webhook payloads (raw body) using timing-safe comparison', type: 'security' },
      { text: 'Webhook auto-registration on install — 8 topics including orders/create, orders/updated, orders/cancelled, refunds/create, app/uninstalled, plus 3 GDPR webhooks', type: 'feature' },
      { text: 'Inngest functions for handleOrderCreated, handleOrderUpdated, handleOrderCancelled, handleRefundCreated, and handleAppUninstalled with retries built in', type: 'feature' },
      { text: 'shopify_stores table tracks per-brand installs, scopes, registered webhooks, and uninstall timestamps', type: 'feature' },
      { text: 'shopify_orders table normalized for cross-brand reporting with unique constraint on (shop_domain, shopify_order_id)', type: 'feature' },
      { text: 'Service-role Supabase client used in webhook handlers to bypass RLS for system writes', type: 'security' },
      { text: '/shopify/installed success page replaces the old per-brand confirmation flow', type: 'improvement' },
      { text: 'Tallow Twins migrated off legacy per-brand Shopify creds onto the unified custom app', type: 'integration' },
      { text: 'Collaborator-based store onboarding flow — agency Partner account requests access, store owner approves, one-click install from Dev Dashboard picker', type: 'improvement' },
    ],
  },
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
      { text: 'Status tracking: Triage → Spec Ready → Building → Shipped / Declined', type: 'feature' },
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
