/*
 * Funnel Viewer ad pull. Parsing (action precedence, segment buckets,
 * creative_hash) is ported from Odylic Constellation api/meta.py
 * commit 6ef04b6efc48ce3200bb317838f6ff6f796f4716.
 *
 * MIT License — Copyright (c) 2026 Odylic Media.
 * See src/components/funnel-viewer/LICENSE.
 *
 * Attribution default is 7-day click only. This file does not change
 * attribution on any other Melch.Cloud route.
 */
import { META_API_BASE } from '@/lib/meta-api';
import type { Ad, SegmentSpend } from '@/components/funnel-viewer/lib/api';

/** Nick, 2026-10-08: this route defaults to 7-day click, with no 1-day view.
 *  Set to 'account' for a strict viewer parity check, or '7d_click_1d_view'
 *  to match Top Creatives and Ad Perspective. */
export type FunnelAttribution = '7d_click' | '7d_click_1d_view' | 'account';
export const FUNNEL_ATTRIBUTION: FunnelAttribution = '7d_click';

export const FUNNEL_CACHE_TTL_SECONDS = 6 * 60 * 60;
export const FUNNEL_REFRESH_FLOOR_MS = 120_000;
export const FUNNEL_AD_CAP = 1000;
export const SEGMENT_UNAVAILABLE_NOTE =
  'Customer segment split unavailable for this account. Ads are placed from frequency and CPMr and drawn dashed.';
export const META_TOKEN_MESSAGE = 'Meta token expired — ask an admin to refresh';
const THROTTLE_LADDER_SECONDS = [300, 1800, 7200, 21600];
const STALE_TTL_SECONDS = 7 * 24 * 60 * 60;
const CALLS_PER_HOUR = 180;

export class MetaGraphError extends Error {
  code: number;
  constructor(message: string, code = 0) {
    super(message);
    this.name = 'MetaGraphError';
    this.code = code;
  }
}

export function isThrottleCode(code: number): boolean {
  return code === 4 || code === 17 || code === 32 || code === 613 || (code >= 80000 && code <= 80014);
}

export function isAuthCode(code: number): boolean {
  return code === 190 || code === 102;
}

export function attributionParam(mode: FunnelAttribution = FUNNEL_ATTRIBUTION): string {
  if (mode === 'account') return 'use_account_attribution_setting=true';
  if (mode === '7d_click_1d_view') return 'action_attribution_windows=["7d_click","1d_view"]';
  return 'action_attribution_windows=["7d_click"]';
}

export function funnelCacheKey(accountId: string, since: string, until: string, mode: FunnelAttribution = FUNNEL_ATTRIBUTION): string {
  return `fv:ads:${accountId}:${since}:${until}:${mode}`;
}

export interface FunnelCache {
  get(key: string): Promise<unknown | null>;
  set(key: string, value: unknown, ttlSeconds: number): Promise<void>;
  del?(key: string): Promise<void>;
}

const memory = new Map<string, { value: unknown; exp: number }>();

export function memoryFunnelCache(now = () => Date.now()): FunnelCache {
  return {
    async get(key) {
      const hit = memory.get(key);
      if (!hit) return null;
      if (hit.exp <= now()) {
        memory.delete(key);
        return null;
      }
      return hit.value;
    },
    async set(key, value, ttlSeconds) {
      memory.set(key, { value, exp: now() + ttlSeconds * 1000 });
    },
    async del(key) {
      memory.delete(key);
    },
  };
}

export function segmentBucket(raw: string | null | undefined): keyof SegmentSpend {
  const s = (raw || '').trim().toLowerCase();
  if (!s || s === 'unknown' || s === 'none' || s === 'n/a' || s === 'not_available') return 'unknown';
  if (s.startsWith('prospect') || s.startsWith('new') || s.includes('acquisition')) return 'prospecting';
  if (s.includes('engag') || s.includes('consider')) return 'engaged';
  if (
    s.includes('exist') || s.includes('repeat') || s.includes('purchas') || s.includes('customer')
    || s.includes('return') || s.includes('retention') || s.includes('loyal')
  ) return 'existing';
  return 'unknown';
}

export function emptySegmentSpend(): SegmentSpend {
  return { prospecting: 0, engaged: 0, existing: 0, unknown: 0 };
}

type ActionRow = { action_type?: string; value?: string | number };

export function pickAction(actions: unknown, chain: readonly string[]): { value: number; type: string | null } {
  const byType = new Map<string, number>();
  if (Array.isArray(actions)) {
    for (const row of actions) {
      if (!row || typeof row !== 'object') continue;
      const action = row as ActionRow;
      if (action.action_type == null || byType.has(action.action_type)) continue;
      byType.set(action.action_type, num(action.value));
    }
  }
  for (const type of chain) {
    if (byType.has(type)) return { value: byType.get(type) || 0, type };
  }
  return { value: 0, type: null };
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
}

function sumActionList(arr: unknown): number {
  if (typeof arr === 'number' || typeof arr === 'string') return num(arr);
  if (!Array.isArray(arr)) return 0;
  return arr.reduce((sum, row) => sum + (row && typeof row === 'object' ? num((row as ActionRow).value) : 0), 0);
}

function ratio(n: number, d: number, mult = 1, digits = 2): number | null {
  if (!d) return null;
  const factor = 10 ** digits;
  return Math.round((n / d) * mult * factor) / factor;
}

export const PURCHASE_TYPES = [
  'offsite_conversion.fb_pixel_purchase',
  'omni_purchase',
  'purchase',
  'onsite_web_purchase',
  'onsite_conversion.purchase',
] as const;
const ATC_TYPES = ['offsite_conversion.fb_pixel_add_to_cart', 'omni_add_to_cart', 'add_to_cart'] as const;
const IC_TYPES = ['offsite_conversion.fb_pixel_initiate_checkout', 'omni_initiated_checkout', 'initiate_checkout'] as const;
const LEAD_TYPES = ['lead', 'offsite_conversion.fb_pixel_lead', 'onsite_web_lead', 'leadgen_grouped', 'onsite_conversion.lead_grouped'] as const;
const LPV_TYPES = ['landing_page_view', 'omni_landing_page_view'] as const;

export type InsightMetrics = Pick<Ad,
  'spend' | 'impressions' | 'clicks' | 'ctr' | 'cpm' | 'cpc' | 'reach' | 'frequency' |
  'purchases' | 'revenue' | 'roas' | 'cost_per_purchase' | 'link_clicks' | 'outbound_clicks' |
  'landing_page_views' | 'add_to_cart' | 'initiate_checkout' | 'leads' |
  'video_3s_views' | 'thruplays' | 'video_p25' | 'video_p50' | 'video_p75' | 'video_p100' |
  'post_reactions' | 'post_comments' | 'post_shares'
>;

export function parseInsightsRow(row: Record<string, unknown>): InsightMetrics {
  const actions = row.actions;
  const values = row.action_values;
  const spend = num(row.spend);
  const impressions = Math.trunc(num(row.impressions));
  const clicks = Math.trunc(num(row.clicks));
  const reach = Math.trunc(num(row.reach));
  const purchase = pickAction(actions, PURCHASE_TYPES);
  let revenue = 0;
  if (purchase.type) {
    const revByType = new Map<string, number>();
    if (Array.isArray(values)) {
      for (const entry of values) {
        if (!entry || typeof entry !== 'object') continue;
        const action = entry as ActionRow;
        if (action.action_type != null && !revByType.has(action.action_type)) revByType.set(action.action_type, num(action.value));
      }
    }
    const matched = purchase.type ? revByType.get(purchase.type) : undefined;
    revenue = matched == null ? pickAction(values, PURCHASE_TYPES).value : matched;
  } else {
    revenue = pickAction(values, PURCHASE_TYPES).value;
  }
  const linkClicks = row.inline_link_clicks != null
    ? Math.trunc(num(row.inline_link_clicks))
    : Math.trunc(pickAction(actions, ['link_click']).value);
  const outboundClicks = row.outbound_clicks != null
    ? Math.trunc(sumActionList(row.outbound_clicks))
    : Math.trunc(pickAction(actions, ['outbound_click']).value);
  const purchases = Math.round(purchase.value);
  const videoFromActions = Math.trunc(pickAction(actions, ['video_view']).value);
  const videoFromPlay = Math.trunc(sumActionList(row.video_play_actions));
  return {
    spend: Math.round(spend * 100) / 100,
    impressions,
    clicks,
    ctr: ratio(clicks, impressions, 100, 4),
    cpm: ratio(spend, impressions, 1000),
    cpc: ratio(spend, clicks),
    reach,
    frequency: ratio(impressions, reach, 1, 4),
    purchases,
    revenue: Math.round(revenue * 100) / 100,
    roas: ratio(revenue, spend, 1, 4),
    cost_per_purchase: ratio(spend, purchases),
    link_clicks: linkClicks,
    outbound_clicks: outboundClicks,
    landing_page_views: Math.trunc(pickAction(actions, LPV_TYPES).value),
    add_to_cart: Math.trunc(pickAction(actions, ATC_TYPES).value),
    initiate_checkout: Math.trunc(pickAction(actions, IC_TYPES).value),
    leads: Math.trunc(pickAction(actions, LEAD_TYPES).value),
    video_3s_views: videoFromActions || videoFromPlay,
    thruplays: Math.trunc(sumActionList(row.video_thruplay_watched_actions)),
    video_p25: Math.trunc(sumActionList(row.video_p25_watched_actions)),
    video_p50: Math.trunc(sumActionList(row.video_p50_watched_actions)),
    video_p75: Math.trunc(sumActionList(row.video_p75_watched_actions)),
    video_p100: Math.trunc(sumActionList(row.video_p100_watched_actions)),
    post_reactions: Math.trunc(pickAction(actions, ['post_reaction', 'like']).value),
    post_comments: Math.trunc(pickAction(actions, ['comment']).value),
    post_shares: Math.trunc(pickAction(actions, ['post', 'share']).value),
  };
}

export function imageHashFromCreative(creative: Record<string, unknown> | null | undefined): string | null {
  if (!creative) return null;
  const top = typeof creative.image_hash === 'string' && creative.image_hash ? creative.image_hash : '';
  const story = creative.object_story_spec as { link_data?: { image_hash?: string } } | undefined;
  const link = story?.link_data?.image_hash || '';
  const feed = creative.asset_feed_spec as { images?: Array<{ hash?: string }> } | undefined;
  const hash = feed?.images?.[0]?.hash || '';
  return top || link || hash || null;
}

export function videoIdFromCreative(creative: Record<string, unknown> | null | undefined): string | null {
  if (!creative) return null;
  const story = creative.object_story_spec as { video_data?: { video_id?: string } } | undefined;
  const feed = creative.asset_feed_spec as { videos?: Array<{ video_id?: string }> } | undefined;
  const id = (typeof creative.video_id === 'string' && creative.video_id)
    || story?.video_data?.video_id
    || feed?.videos?.[0]?.video_id
    || '';
  return id ? String(id) : null;
}

export function creativeHashFrom(parts: {
  imageHash?: string | null;
  videoId?: string | null;
  creativeId?: string | null;
  adId: string;
}): string {
  return parts.imageHash || parts.videoId || parts.creativeId || parts.adId;
}

export function adsManagerUrl(accountId: string, adId: string): string {
  const digits = accountId.startsWith('act_') ? accountId.slice(4) : accountId;
  return `https://adsmanager.facebook.com/adsmanager/manage/ads?act=${digits}&selected_ad_ids=${adId}`;
}

export function buildSegmentSpend(rows: Array<Record<string, unknown>>): Map<string, SegmentSpend> {
  const out = new Map<string, SegmentSpend>();
  for (const row of rows) {
    const adId = String(row.ad_id || '');
    if (!adId) continue;
    const bucket = segmentBucket(typeof row.user_segment_key === 'string' ? row.user_segment_key : null);
    const entry = out.get(adId) || emptySegmentSpend();
    entry[bucket] += num(row.spend);
    out.set(adId, entry);
  }
  for (const entry of out.values()) {
    entry.prospecting = Math.round(entry.prospecting * 100) / 100;
    entry.engaged = Math.round(entry.engaged * 100) / 100;
    entry.existing = Math.round(entry.existing * 100) / 100;
    entry.unknown = Math.round(entry.unknown * 100) / 100;
  }
  return out;
}

function ymdInZone(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  } catch {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  }
}

function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, (d || 1) + days));
  return dt.toISOString().slice(0, 10);
}

export function defaultFunnelRange(timeZone: string, now = new Date()): { since: string; until: string } {
  const until = addDays(ymdInZone(now, timeZone), -1);
  return { since: addDays(until, -29), until };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function monthsApart(since: string, until: string): number {
  const [ys, ms, ds] = since.split('-').map(Number);
  const [yu, mu, du] = until.split('-').map(Number);
  return (yu - ys) * 12 + (mu - ms) + ((du - ds) / 31);
}

export function assertRange(since: string, until: string): string | null {
  if (!ISO_DATE.test(since) || !ISO_DATE.test(until)) return 'since and until must be YYYY-MM-DD';
  if (since > until) return 'since must be on or before until';
  if (monthsApart(since, until) > 37) return 'Date range is capped at 37 months';
  return null;
}

export type FunnelAccess =
  | { ok: true }
  | { ok: false; status: 401 | 403 | 404 | 422; error: string; code?: string };

export function gateFunnelRequest(input: {
  hasUser: boolean;
  role: string | null;
  profileBrandId: string | null;
  brandId: string | null;
  brandFound: boolean;
  metaAccountId: string | null;
}): FunnelAccess {
  if (!input.hasUser) return { ok: false, status: 401, error: 'Unauthorized' };
  if (!input.role || !['admin', 'strategist', 'founder'].includes(input.role)) {
    return { ok: false, status: 403, error: 'Forbidden' };
  }
  if (!input.brandId) return { ok: false, status: 422, error: 'brandId required', code: 'brand_required' };
  if (input.role !== 'admin' && input.profileBrandId !== input.brandId) {
    return { ok: false, status: 403, error: 'Forbidden' };
  }
  if (!input.brandFound) return { ok: false, status: 404, error: 'Brand not found' };
  const account = (input.metaAccountId || '').trim();
  if (!account) {
    return { ok: false, status: 422, error: 'No Meta ad account linked to this brand.', code: 'no_meta_account' };
  }
  return { ok: true };
}

export type FunnelAdsBody = {
  brand: { id: string; name: string };
  account: { id: string; name: string; currency: string; account_status: number | null; timezone_name: string | null };
  since: string;
  until: string;
  currency: string;
  fetched_at: string;
  cached: boolean;
  truncated: boolean;
  total_ads: number;
  note: string | null;
  ads: Ad[];
};

type StoredPull = { fetchedAt: number; body: FunnelAdsBody };

export type GraphJson = (url: string) => Promise<Record<string, unknown>>;

const INSIGHT_FIELDS = [
  'ad_id', 'ad_name', 'campaign_id', 'campaign_name', 'adset_id', 'adset_name',
  'spend', 'impressions', 'reach', 'frequency', 'clicks', 'ctr', 'cpm', 'cpc',
  'inline_link_clicks', 'outbound_clicks', 'actions', 'action_values',
  'video_thruplay_watched_actions', 'video_play_actions',
  'video_p25_watched_actions', 'video_p50_watched_actions', 'video_p75_watched_actions', 'video_p100_watched_actions',
].join(',');

const CREATIVE_FIELDS = [
  'thumbnail_url', 'image_url', 'image_hash', 'video_id', 'title', 'body',
  'call_to_action_type', 'instagram_permalink_url', 'effective_object_story_id',
  'object_type', 'object_story_spec', 'asset_feed_spec',
].join(',');

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function paged(
  firstUrl: string,
  graph: GraphJson,
  maxRows: number,
): Promise<{ rows: Array<Record<string, unknown>>; truncated: boolean }> {
  const rows: Array<Record<string, unknown>> = [];
  let next: string | null = firstUrl;
  let pages = 0;
  let truncated = false;
  while (next && pages < 40) {
    if (pages > 0) await sleep(300);
    pages += 1;
    const body = await graph(next);
    const data = Array.isArray(body.data) ? body.data as Array<Record<string, unknown>> : [];
    const room = maxRows - rows.length;
    const take = data.slice(0, Math.max(0, room));
    rows.push(...take);
    const paging = body.paging as { next?: string } | undefined;
    const more = Boolean(paging?.next);
    if (take.length < data.length || (rows.length >= maxRows && more)) {
      truncated = true;
      break;
    }
    next = more ? paging!.next! : null;
  }
  return { rows, truncated };
}

async function idMap(url: string, graph: GraphJson): Promise<Record<string, Record<string, unknown>>> {
  const body = await graph(url);
  const out: Record<string, Record<string, unknown>> = {};
  for (const [key, value] of Object.entries(body)) {
    if (key === 'paging' || key === 'error' || !value || typeof value !== 'object' || Array.isArray(value)) continue;
    out[key] = value as Record<string, unknown>;
  }
  return out;
}

function textField(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value;
  return null;
}

function creativeCopy(creative: Record<string, unknown> | undefined, key: 'title' | 'body'): string | null {
  const direct = textField(creative?.[key]);
  if (direct) return direct;
  const feed = creative?.asset_feed_spec as { titles?: Array<{ text?: string }>; bodies?: Array<{ text?: string }> } | undefined;
  const list = key === 'title' ? feed?.titles : feed?.bodies;
  return textField(list?.[0]?.text);
}

function thumbFromCreative(creative: Record<string, unknown> | undefined, videoId: string | null): string {
  if (!creative) return '';
  const story = creative.object_story_spec as {
    video_data?: { image_url?: string };
    link_data?: { image_url?: string; picture?: string };
    photo_data?: { image_url?: string };
  } | undefined;
  const feed = creative.asset_feed_spec as {
    images?: Array<{ url?: string }>;
    videos?: Array<{ thumbnail_url?: string }>;
  } | undefined;
  const imageUrl = textField(creative.image_url)
    || textField(story?.link_data?.image_url)
    || textField(story?.link_data?.picture)
    || textField(story?.photo_data?.image_url)
    || textField(story?.video_data?.image_url)
    || textField(feed?.images?.[0]?.url)
    || '';
  const thumb = textField(creative.thumbnail_url) || textField(feed?.videos?.[0]?.thumbnail_url) || '';
  if (videoId) return thumb || imageUrl;
  return imageUrl || thumb;
}

function buildAd(
  accountId: string,
  row: Record<string, unknown>,
  node: Record<string, unknown> | undefined,
  creative: Record<string, unknown> | undefined,
  segments: Map<string, SegmentSpend> | null,
  blobUrl: string | null,
): Ad {
  const adId = String(row.ad_id || node?.id || '');
  const creativeNode = (node?.creative && typeof node.creative === 'object') ? node.creative as { id?: string } : undefined;
  const creativeId = textField(creative?.id) || textField(creativeNode?.id);
  const imageHash = imageHashFromCreative(creative);
  const videoId = videoIdFromCreative(creative);
  const objectType = String(creative?.object_type || '');
  const thumb = blobUrl || thumbFromCreative(creative, videoId);
  const metrics = parseInsightsRow(row);
  return {
    ad_id: adId,
    ad_name: textField(node?.name) || textField(row.ad_name) || adId,
    adset_id: String(row.adset_id || ''),
    adset_name: textField(row.adset_name) || '',
    campaign_id: String(row.campaign_id || ''),
    campaign_name: textField(row.campaign_name) || '',
    effective_status: textField(node?.effective_status) || '',
    created_time: textField(node?.created_time),
    creative_id: creativeId,
    creative_hash: creativeHashFrom({ imageHash, videoId, creativeId, adId }),
    image_hash: imageHash,
    video_id: videoId,
    is_video: Boolean(videoId) || objectType.toUpperCase().includes('VIDEO'),
    thumbnail_url: thumb,
    image_url: thumb,
    title: creativeCopy(creative, 'title'),
    body: creativeCopy(creative, 'body'),
    call_to_action_type: textField(creative?.call_to_action_type),
    account_id: accountId,
    effective_object_story_id: textField(creative?.effective_object_story_id),
    instagram_permalink_url: textField(creative?.instagram_permalink_url),
    ads_manager_url: adsManagerUrl(accountId, adId),
    ...metrics,
    segment_spend: segments ? segments.get(adId) || null : null,
  };
}

async function allowCall(cache: FunnelCache, accountId: string, now: number): Promise<boolean> {
  const hour = new Date(now).toISOString().slice(0, 13);
  const key = `fv:calls:${accountId}:${hour}`;
  const used = Number(await cache.get(key) || 0) + 1;
  await cache.set(key, used, 3600);
  return used <= CALLS_PER_HOUR;
}

async function rememberThrottle(cache: FunnelCache, accountId: string): Promise<number> {
  const key = `fv:throttle:${accountId}`;
  const prev = await cache.get(key) as { strike?: number } | null;
  const strike = Number(prev?.strike) || 0;
  const wait = THROTTLE_LADDER_SECONDS[Math.min(strike, THROTTLE_LADDER_SECONDS.length - 1)];
  await cache.set(key, { strike: strike + 1 }, wait);
  return wait;
}

export function httpForGraphError(err: unknown): { status: number; body: Record<string, unknown>; retryAfter?: number } | null {
  if (!(err instanceof MetaGraphError)) return null;
  if (isAuthCode(err.code)) {
    return { status: 401, body: { error: META_TOKEN_MESSAGE, code: 'meta_token_invalid' } };
  }
  if (err.code === 10 || err.code === 200 || /permission/i.test(err.message)) {
    return {
      status: 403,
      body: {
        error: `This Meta ad account is not reachable with the current token. ${err.message}`.trim(),
        code: 'meta_permission',
      },
    };
  }
  return null;
}

export async function loadFunnelAds(input: {
  accountId: string;
  since: string;
  until: string;
  token: string;
  refresh: boolean;
  brand: { id: string; name: string };
  currency: string;
  timezone: string | null;
  now?: number;
  cache?: FunnelCache | null;
  graph?: GraphJson;
  blobThumbs?: (creativeIds: string[]) => Promise<Record<string, string>>;
  attribution?: FunnelAttribution;
}): Promise<{ status: number; body: FunnelAdsBody | Record<string, unknown>; retryAfter?: number }> {
  const now = input.now ?? Date.now();
  const mode = input.attribution ?? FUNNEL_ATTRIBUTION;
  const accountId = input.accountId.startsWith('act_') ? input.accountId : `act_${input.accountId}`;
  const cache = input.cache === undefined ? memoryFunnelCache() : input.cache;
  const key = funnelCacheKey(accountId, input.since, input.until, mode);
  const staleKey = `fv:ads:stale:${accountId}:${input.since}:${input.until}:${mode}`;

  const readStored = async (storeKey: string): Promise<StoredPull | null> => {
    if (!cache) return null;
    const raw = await cache.get(storeKey);
    if (!raw || typeof raw !== 'object') return null;
    const stored = raw as StoredPull;
    if (!stored.body || typeof stored.fetchedAt !== 'number') return null;
    return stored;
  };

  if (cache) {
    const hit = await readStored(key);
    if (hit) {
      const age = now - hit.fetchedAt;
      const fresh = age < FUNNEL_CACHE_TTL_SECONDS * 1000;
      const withinFloor = input.refresh && age < FUNNEL_REFRESH_FLOOR_MS;
      if ((fresh && !input.refresh) || withinFloor) {
        return { status: 200, body: { ...hit.body, cached: true } };
      }
    }
  }

  const graph = input.graph ?? (async (url: string) => {
    const res = await fetch(url);
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      const code = Number(payload?.error?.code) || 0;
      throw new MetaGraphError(payload?.error?.message || `Meta request failed (${res.status})`, code);
    }
    return payload as Record<string, unknown>;
  });

  const counted = async (url: string) => {
    if (cache && !(await allowCall(cache, accountId, now))) {
      throw new MetaGraphError('Meta call budget for this hour is used up', 17);
    }
    return graph(url);
  };

  const tokenQ = `access_token=${encodeURIComponent(input.token)}`;
  const timeRange = encodeURIComponent(JSON.stringify({ since: input.since, until: input.until }));
  const attr = attributionParam(mode);
  const insightsUrl =
    `${META_API_BASE}/${accountId}/insights?fields=${INSIGHT_FIELDS}` +
    `&time_range=${timeRange}&level=ad&sort=spend_descending&limit=500&${attr}&${tokenQ}`;
  const segmentUrl =
    `${META_API_BASE}/${accountId}/insights?fields=ad_id,spend&breakdowns=user_segment_key` +
    `&time_range=${timeRange}&level=ad&limit=500&${attr}&${tokenQ}`;

  try {
    const [insightPage, segmentResult] = await Promise.all([
      paged(insightsUrl, counted, FUNNEL_AD_CAP),
      paged(segmentUrl, counted, 20000).then(
        (page) => ({ ok: true as const, rows: page.rows }),
        () => ({ ok: false as const, rows: [] as Array<Record<string, unknown>> }),
      ),
    ]);
    const notes: string[] = [];
    let segments: Map<string, SegmentSpend> | null = null;
    if (segmentResult.ok) segments = buildSegmentSpend(segmentResult.rows);
    else notes.push(SEGMENT_UNAVAILABLE_NOTE);
    if (insightPage.truncated) notes.push('Showing the top 1,000 ads by spend.');

    const adIds = insightPage.rows.map((row) => String(row.ad_id || '')).filter(Boolean);
    const nodes: Record<string, Record<string, unknown>> = {};
    for (let i = 0; i < adIds.length; i += 50) {
      const chunk = adIds.slice(i, i + 50);
      const url = `${META_API_BASE}/?ids=${chunk.join(',')}&fields=name,effective_status,created_time,creative{id}&${tokenQ}`;
      try {
        Object.assign(nodes, await idMap(url, counted));
      } catch (err) {
        if (err instanceof MetaGraphError && (isAuthCode(err.code) || isThrottleCode(err.code))) throw err;
      }
    }
    const creativeIds = [...new Set(Object.values(nodes).map((node) => {
      const creative = node.creative as { id?: string } | undefined;
      return creative?.id || '';
    }).filter(Boolean))];
    const creatives: Record<string, Record<string, unknown>> = {};
    for (let i = 0; i < creativeIds.length; i += 50) {
      const chunk = creativeIds.slice(i, i + 50);
      const url =
        `${META_API_BASE}/?ids=${chunk.join(',')}&fields=${CREATIVE_FIELDS}` +
        `&thumbnail_width=640&thumbnail_height=800&${tokenQ}`;
      try {
        Object.assign(creatives, await idMap(url, counted));
      } catch (err) {
        if (err instanceof MetaGraphError && /reduce the amount of data/i.test(err.message) && chunk.length > 25) {
          for (let j = 0; j < chunk.length; j += 25) {
            const small = chunk.slice(j, j + 25);
            const retry =
              `${META_API_BASE}/?ids=${small.join(',')}&fields=${CREATIVE_FIELDS}&${tokenQ}`;
            Object.assign(creatives, await idMap(retry, counted));
          }
          continue;
        }
        if (err instanceof MetaGraphError && (isAuthCode(err.code) || isThrottleCode(err.code))) throw err;
      }
    }
    const blobs = input.blobThumbs ? await input.blobThumbs(creativeIds) : await defaultBlobThumbs(creativeIds);
    const ads = insightPage.rows
      .filter((row) => row.ad_id)
      .map((row) => {
        const adId = String(row.ad_id);
        const node = nodes[adId];
        const creativeId = (node?.creative as { id?: string } | undefined)?.id;
        const creative = creativeId ? creatives[creativeId] : undefined;
        return buildAd(accountId, row, node, creative, segments, creativeId ? blobs[creativeId] || null : null);
      })
      .sort((a, b) => b.spend - a.spend);

    const body: FunnelAdsBody = {
      brand: input.brand,
      account: {
        id: accountId,
        name: input.brand.name,
        currency: input.currency || 'USD',
        account_status: null,
        timezone_name: input.timezone,
      },
      since: input.since,
      until: input.until,
      currency: input.currency || 'USD',
      fetched_at: new Date(now).toISOString(),
      cached: false,
      truncated: insightPage.truncated,
      total_ads: ads.length,
      note: notes.length ? notes.join(' ') : null,
      ads,
    };
    if (cache) {
      const stored: StoredPull = { fetchedAt: now, body };
      await cache.set(key, stored, FUNNEL_CACHE_TTL_SECONDS);
      await cache.set(staleKey, stored, STALE_TTL_SECONDS);
      await cache.del?.(`fv:throttle:${accountId}`);
    }
    return { status: 200, body };
  } catch (err) {
    const mapped = httpForGraphError(err);
    if (mapped) return mapped;
    if (err instanceof MetaGraphError && isThrottleCode(err.code)) {
      const stale = cache ? await readStored(staleKey) : null;
      const retryAfter = cache ? await rememberThrottle(cache, accountId) : THROTTLE_LADDER_SECONDS[0];
      if (stale) {
        return {
          status: 200,
          body: {
            ...stale.body,
            cached: true,
            note: [stale.body.note, 'Meta is rate limiting this account. Showing the last saved pull.'].filter(Boolean).join(' '),
          },
        };
      }
      return {
        status: 429,
        retryAfter,
        body: { error: err.message || 'Meta is rate limiting this account.', code: 'throttled', retry_after: retryAfter },
      };
    }
    const message = err instanceof Error ? err.message : 'Meta request failed';
    return { status: 502, body: { error: message } };
  }
}

async function defaultBlobThumbs(creativeIds: string[]): Promise<Record<string, string>> {
  if (!creativeIds.length || !process.env.BLOB_READ_WRITE_TOKEN) return {};
  try {
    const { list } = await import('@vercel/blob');
    const existing = await list({ prefix: 'creatives/', limit: 1000 });
    const wanted = new Set(creativeIds);
    const found: Record<string, string> = {};
    for (const blob of existing.blobs) {
      const match = blob.pathname.match(/creatives\/([^./]+)/);
      if (match && wanted.has(match[1])) found[match[1]] = blob.url;
    }
    return found;
  } catch {
    return {};
  }
}
