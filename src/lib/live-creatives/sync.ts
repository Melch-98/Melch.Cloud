// Hourly pull of active Meta ads into live_creatives.
// Token goes out as Authorization: Bearer. It is not written to logs.

import { draftsFromAd, storyIdForPostFetch, type StoryPost } from '@/lib/live-creatives/assets';
import { brandBudgetOpen, graphBase, metaGraphGet, scrubSecret, tokenDead } from '@/lib/live-creatives/graph';
import { hostsFromBrandConfig } from '@/lib/live-creatives/landing';
import { mergeCronRow, omitCronProtected, type ExistingLiveCreative } from '@/lib/live-creatives/merge';

export interface SyncBrandResult {
  brandId: string;
  brandName: string;
  ok: boolean;
  ads: number;
  rows: number;
  duplicates: number;
  truncated: boolean;
  /** Rows whose product_kind is still none after destination fallbacks. */
  none: number;
  /** Up to five ad ids among those rows. */
  noneAdIds: string[];
  error?: string;
}

type Graph = (url: string, token: string) => Promise<any>;

/**
 * AdCreative fields for Graph v21.0.
 * Documented on the Ad Creative node: effective_object_story_id, object_story_id,
 * link_url, object_url, template_url, call_to_action_type, call_to_action
 * (type and value.link are default subfields), effective_instagram_media_id,
 * source_instagram_media_id, instagram_permalink_url, creative_sourcing_spec, url_tags.
 * destination_spec is not an AdCreative field in that reference. It is requested
 * and dropped, with any other name Graph rejects as a nonexisting field.
 */
export const CREATIVE_FIELD_LIST = [
  'id', 'name', 'object_type', 'thumbnail_url', 'image_url', 'image_hash', 'video_id',
  'product_set_id', 'object_story_spec', 'asset_feed_spec', 'title',
  'effective_object_story_id', 'object_story_id', 'link_url', 'object_url', 'template_url',
  'call_to_action_type', 'call_to_action', 'effective_instagram_media_id', 'source_instagram_media_id',
  'instagram_permalink_url', 'destination_spec', 'creative_sourcing_spec', 'url_tags',
];

export const POST_FIELDS = 'call_to_action,attachments{unshimmed_url,url,target,type,subattachments{unshimmed_url,url,target}}';

const FIELD_CHUNK = 25;

export function rejectedCreativeField(message: string): string | null {
  const match = /nonexisting field \(([a-z0-9_.{}]+)\)/i.exec(message)
    || /unknown field[:\s]+['"]?([a-z0-9_.{}]+)/i.exec(message);
  return match?.[1] || null;
}

export function dropCreativeField(fields: string[], rejected: string): string[] {
  const bare = rejected.split('{')[0].split('.')[0];
  if (!bare) return fields;
  return fields.filter((field) => field.split('{')[0].split('.')[0] !== bare);
}

export async function readMetaToken(supabase: { from: (table: string) => any }): Promise<string> {
  const fromEnv = process.env.META_ACCESS_TOKEN || '';
  if (fromEnv) return fromEnv;
  const { data } = await supabase.from('app_settings').select('value').eq('key', 'meta_access_token').maybeSingle();
  return typeof data?.value === 'string' ? data.value : '';
}

function accountId(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed.startsWith('act_') ? trimmed : `act_${trimmed}`;
}

function emptyFailure(brand: { id: string; name?: string | null }, message: string): SyncBrandResult {
  return {
    brandId: brand.id,
    brandName: brand.name || brand.id,
    ok: false,
    ads: 0,
    rows: 0,
    duplicates: 0,
    truncated: false,
    none: 0,
    noneAdIds: [],
    error: message,
  };
}

async function paged(
  firstUrl: string,
  token: string,
  graph: Graph,
  deadline: number,
): Promise<{ rows: any[]; truncated: boolean }> {
  const rows: any[] = [];
  let next: string | null = firstUrl;
  let pages = 0;
  let truncated = false;
  while (next && pages < 30) {
    if (Date.now() > deadline) {
      truncated = true;
      break;
    }
    pages += 1;
    const body = await graph(next, token);
    if (Array.isArray(body?.data)) rows.push(...body.data);
    const paging = body?.paging?.next;
    next = typeof paging === 'string' ? paging : null;
  }
  if (next) truncated = true;
  return { rows, truncated };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asPost(value: unknown): StoryPost | null {
  const record = asRecord(value);
  return record ? record as StoryPost : null;
}

function absorbNodes(out: Record<string, unknown>, body: unknown) {
  if (!body || typeof body !== 'object') return;
  for (const [key, value] of Object.entries(body)) {
    if (key === 'paging' || key === 'error' || !value || typeof value !== 'object' || Array.isArray(value)) continue;
    if ('error' in value) continue;
    out[key] = value;
  }
}

async function fetchByIds(input: {
  ids: string[];
  fields: { list: string[] };
  token: string;
  graph: Graph;
  deadline: number;
  allowFieldDrop: boolean;
}): Promise<{ map: Record<string, unknown>; truncated: boolean }> {
  const map: Record<string, unknown> = {};
  let truncated = false;
  let index = 0;
  let drops = 0;
  while (index < input.ids.length) {
    if (Date.now() > input.deadline) {
      truncated = true;
      break;
    }
    const chunk = input.ids.slice(index, index + FIELD_CHUNK);
    const url = `${graphBase()}/?ids=${chunk.map((id) => encodeURIComponent(id)).join(',')}&fields=${input.fields.list.join(',')}`;
    try {
      const body = await input.graph(url, input.token);
      absorbNodes(map, body);
      index += chunk.length;
      drops = 0;
    } catch (err) {
      const message = scrubSecret(err instanceof Error ? err.message : 'Meta request failed', input.token);
      const rejected = input.allowFieldDrop ? rejectedCreativeField(message) : null;
      const next = rejected ? dropCreativeField(input.fields.list, rejected) : input.fields.list;
      if (!rejected || next.length === 0 || next.length === input.fields.list.length || drops >= 12) {
        throw new Error(message);
      }
      input.fields.list = next;
      drops += 1;
    }
  }
  return { map, truncated };
}

async function hostsForBrand(supabase: any, brand: {
  website_url?: string | null;
  shopify_store_domain?: string | null;
}): Promise<string[]> {
  const hosts = new Set(hostsFromBrandConfig({
    websiteUrl: brand.website_url,
    shopifyStoreDomain: brand.shopify_store_domain,
  }));
  const { data } = await supabase
    .from('shopify_stores')
    .select('shop_domain, shop_info')
    .eq('brand_id', (brand as { id?: string }).id);
  for (const store of data || []) {
    for (const host of hostsFromBrandConfig({
      shopDomains: [store.shop_domain],
      shopInfo: store.shop_info,
    })) {
      hosts.add(host);
    }
  }
  return Array.from(hosts);
}

async function productsForBrand(supabase: any, brandId: string): Promise<Array<{ handle: string; title: string }>> {
  const { data, error } = await supabase.from('shopify_products').select('handle, title').eq('brand_id', brandId);
  if (error) return [];
  return (data || [])
    .filter((row: { handle?: string | null }) => !!row.handle)
    .map((row: { handle: string; title?: string | null }) => ({
      handle: row.handle,
      title: row.title || '',
    }));
}

async function existingByKey(
  supabase: any,
  brandId: string,
  adIds: string[],
): Promise<Map<string, ExistingLiveCreative>> {
  const map = new Map<string, ExistingLiveCreative>();
  for (let i = 0; i < adIds.length; i += 100) {
    const chunk = adIds.slice(i, i + 100);
    const { data, error } = await supabase
      .from('live_creatives')
      .select('ad_id, asset_key, first_seen')
      .eq('brand_id', brandId)
      .eq('platform', 'meta')
      .in('ad_id', chunk);
    if (error) throw new Error(error.message);
    for (const row of data || []) {
      map.set(`${row.ad_id}::${row.asset_key}`, {
        first_seen: row.first_seen ?? null,
      });
    }
  }
  return map;
}

function noneSummary(rows: Array<Record<string, unknown>>): { none: number; noneAdIds: string[] } {
  const noneAdIds: string[] = [];
  let none = 0;
  for (const row of rows) {
    if (row.product_kind !== 'none') continue;
    none += 1;
    const adId = typeof row.ad_id === 'string' ? row.ad_id : '';
    if (adId && noneAdIds.length < 5 && !noneAdIds.includes(adId)) noneAdIds.push(adId);
  }
  return { none, noneAdIds };
}

export async function syncLiveCreatives(input: {
  supabase: any;
  token: string;
  now?: Date;
  budgetMs?: number;
  brandId?: string | null;
  graph?: Graph;
}): Promise<{ results: SyncBrandResult[]; deferred: string[] }> {
  const now = input.now ?? new Date();
  const started = now.getTime();
  const budgetMs = input.budgetMs ?? 240_000;
  const deadline = started + budgetMs;
  const graph = input.graph ?? ((url: string, token: string) => metaGraphGet(url, token));
  const results: SyncBrandResult[] = [];
  const deferred: string[] = [];
  const creativeFields = { list: [...CREATIVE_FIELD_LIST] };

  let brandQuery = input.supabase
    .from('brands')
    .select('id, name, website_url, shopify_store_domain, meta_ad_account_id')
    .is('archived_at', null)
    .not('meta_ad_account_id', 'is', null)
    .order('name');
  if (input.brandId) brandQuery = brandQuery.eq('id', input.brandId);
  const { data: brands, error: brandError } = await brandQuery;
  if (brandError) {
    throw new Error(scrubSecret(brandError.message || 'Could not list brands', input.token));
  }

  let stopForToken = false;
  for (const brand of brands || []) {
    const metaId = accountId(brand.meta_ad_account_id || '');
    if (!metaId) continue;
    if (stopForToken || !brandBudgetOpen(started, Date.now(), budgetMs)) {
      deferred.push(brand.id);
      continue;
    }
    try {
      const result = await syncBrand({
        supabase: input.supabase,
        brand: { ...brand, id: brand.id },
        account: metaId,
        token: input.token,
        graph,
        now,
        deadline,
        creativeFields,
      });
      results.push(result);
      if (result.error && tokenDead(result.error)) stopForToken = true;
    } catch (err) {
      const message = scrubSecret(err instanceof Error ? err.message : 'Live creative sync failed', input.token);
      results.push(emptyFailure(brand, message));
      if (tokenDead(message)) stopForToken = true;
    }
  }

  return { results, deferred };
}

async function syncBrand(input: {
  supabase: any;
  brand: {
    id: string;
    name?: string | null;
    website_url?: string | null;
    shopify_store_domain?: string | null;
  };
  account: string;
  token: string;
  graph: Graph;
  now: Date;
  deadline: number;
  creativeFields: { list: string[] };
}): Promise<SyncBrandResult> {
  const base: SyncBrandResult = {
    brandId: input.brand.id,
    brandName: input.brand.name || input.brand.id,
    ok: true,
    ads: 0,
    rows: 0,
    duplicates: 0,
    truncated: false,
    none: 0,
    noneAdIds: [],
  };
  const params = new URLSearchParams({
    fields: 'id,name,effective_status,creative{id},adset{id,is_dynamic_creative,promoted_object}',
    filtering: JSON.stringify([{ field: 'effective_status', operator: 'IN', value: ['ACTIVE'] }]),
    limit: '100',
  });
  const { rows: ads, truncated: adsTruncated } = await paged(
    `${graphBase()}/${input.account}/ads?${params.toString()}`,
    input.token,
    input.graph,
    input.deadline,
  );
  base.ads = ads.length;
  base.truncated = adsTruncated;

  const creativeIds = Array.from(new Set(ads.map((ad) => ad?.creative?.id).filter((id: unknown): id is string => typeof id === 'string' && !!id)));
  const creatives = await fetchByIds({
    ids: creativeIds,
    fields: input.creativeFields,
    token: input.token,
    graph: input.graph,
    deadline: input.deadline,
    allowFieldDrop: true,
  });
  if (creatives.truncated) base.truncated = true;

  const postIds = Array.from(new Set(
    Object.values(creatives.map)
      .map((creative) => storyIdForPostFetch(creative))
      .filter((id): id is string => !!id),
  ));
  const posts = await fetchByIds({
    ids: postIds,
    fields: { list: [POST_FIELDS] },
    token: input.token,
    graph: input.graph,
    deadline: input.deadline,
    allowFieldDrop: false,
  });
  if (posts.truncated) base.truncated = true;

  const hosts = await hostsForBrand(input.supabase, input.brand);
  const products = await productsForBrand(input.supabase, input.brand.id);
  const nowIso = input.now.toISOString();
  const drafts = ads.flatMap((ad) => {
    const adId = String(ad?.id || '');
    if (!adId) return [];
    const creativeId = typeof ad?.creative?.id === 'string' ? ad.creative.id : null;
    const creative = creativeId ? asRecord(creatives.map[creativeId]) : null;
    const storyField = creative?.effective_object_story_id;
    const storyFallback = creative?.object_story_id;
    const storyId = typeof storyField === 'string' ? storyField : (typeof storyFallback === 'string' ? storyFallback : '');
    const post = storyId ? asPost(posts.map[storyId]) : null;
    const promoted = ad?.adset?.promoted_object?.product_set_id;
    return draftsFromAd({
      brandId: input.brand.id,
      adId,
      adName: typeof ad?.name === 'string' ? ad.name : null,
      creativeId,
      creative,
      post,
      adset: {
        dynamic: ad?.adset?.is_dynamic_creative === true,
        productSetId: typeof promoted === 'string' ? promoted : '',
      },
      hosts,
      products,
    });
  });

  const existing = await existingByKey(input.supabase, input.brand.id, drafts.map((row) => row.ad_id));
  const merged = drafts.map((row) => omitCronProtected(
    mergeCronRow(existing.get(`${row.ad_id}::${row.asset_key}`) || null, row, nowIso) as unknown as Record<string, unknown>,
  ));
  const seen = new Set<string>();
  const unique: Array<Record<string, unknown>> = [];
  for (const row of merged) {
    const key = `${row.ad_id}::${row.asset_key}`;
    if (seen.has(key)) {
      base.duplicates += 1;
      continue;
    }
    seen.add(key);
    unique.push(row);
  }

  for (let i = 0; i < unique.length; i += 200) {
    const chunk = unique.slice(i, i + 200);
    const { error } = await input.supabase
      .from('live_creatives')
      .upsert(chunk, { onConflict: 'brand_id,platform,ad_id,asset_key' });
    if (error) throw new Error(error.message);
  }
  base.rows = unique.length;
  const summary = noneSummary(unique);
  base.none = summary.none;
  base.noneAdIds = summary.noneAdIds;
  return base;
}
