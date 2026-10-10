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
  /** Page posts that stayed unread after a one-id retry. Creative links are still kept. */
  postFetchFailed: number;
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
/** Fields that synced before the destination expansion. A (#100) on a newer field drops that field. */
export const BASELINE_CREATIVE_FIELDS = [
  'id', 'name', 'object_type', 'thumbnail_url', 'image_url', 'image_hash', 'video_id',
  'product_set_id', 'object_story_spec', 'asset_feed_spec', 'title',
];

export const CREATIVE_FIELD_LIST = [
  ...BASELINE_CREATIVE_FIELDS,
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
    postFetchFailed: 0,
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

function bareField(field: string): string {
  return field.split('{')[0].split('.')[0];
}

function isBaselineCreativeField(field: string): boolean {
  return BASELINE_CREATIVE_FIELDS.includes(bareField(field));
}

/** (#100) that does not name a field. Missing permissions is the page-post and field case. */
function unnamedGraph100(message: string): boolean {
  if (rejectedCreativeField(message)) return false;
  return /\(#100\)/.test(message) || /missing permissions/i.test(message);
}

function idUrl(ids: string[], fields: string[]): string {
  return `${graphBase()}/?ids=${ids.map((id) => encodeURIComponent(id)).join(',')}&fields=${fields.join(',')}`;
}

async function readIdBatch(
  ids: string[],
  fields: string[],
  token: string,
  graph: Graph,
): Promise<{ ok: true; body: unknown } | { ok: false; message: string }> {
  try {
    const body = await graph(idUrl(ids, fields), token);
    return { ok: true, body };
  } catch (err) {
    const message = scrubSecret(err instanceof Error ? err.message : 'Meta request failed', token);
    return { ok: false, message };
  }
}

function splitNodes(body: unknown, ids: string[]): { good: Record<string, unknown>; bad: string[] } {
  const record = asRecord(body) || {};
  const good: Record<string, unknown> = {};
  const bad: string[] = [];
  for (const id of ids) {
    const node = record[id];
    if (node && typeof node === 'object' && !Array.isArray(node) && !('error' in node)) {
      good[id] = node;
    } else {
      bad.push(id);
    }
  }
  return { good, bad };
}

/**
 * A new creative field can (#100) for one ad account. Keep every field the
 * account accepts, including the pre-merge set, and remember the drop for the
 * rest of the run.
 */
async function isolateCreativeFields(input: {
  ids: string[];
  fields: { list: string[] };
  token: string;
  graph: Graph;
  deadline: number;
}): Promise<{ body: unknown } | { retry: true } | null> {
  const baseline = input.fields.list.filter(isBaselineCreativeField);
  const extras = input.fields.list.filter((field) => !isBaselineCreativeField(field));
  if (baseline.length === 0 || extras.length === 0) return null;

  const baselineTry = await readIdBatch(input.ids, baseline, input.token, input.graph);
  if (!baselineTry.ok) {
    const rejected = rejectedCreativeField(baselineTry.message);
    const next = rejected ? dropCreativeField(input.fields.list, rejected) : input.fields.list;
    if (!rejected || next.length === 0 || next.length === input.fields.list.length) return null;
    input.fields.list = next;
    return { retry: true };
  }

  let kept = baseline;
  let body = baselineTry.body;
  for (const extra of extras) {
    if (Date.now() > input.deadline) break;
    const attempt = await readIdBatch(input.ids, [...kept, extra], input.token, input.graph);
    if (attempt.ok) {
      kept = [...kept, extra];
      body = attempt.body;
      continue;
    }
    const rejected = rejectedCreativeField(attempt.message);
    if (rejected && bareField(rejected) !== bareField(extra)) {
      kept = kept.filter((field) => bareField(field) !== bareField(rejected));
      if (Date.now() > input.deadline) break;
      const retry = await readIdBatch(input.ids, [...kept, extra], input.token, input.graph);
      if (retry.ok) {
        kept = [...kept, extra];
        body = retry.body;
      }
    }
  }
  input.fields.list = kept;
  return { body };
}

async function fetchCreatives(input: {
  ids: string[];
  fields: { list: string[] };
  token: string;
  graph: Graph;
  deadline: number;
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
    const batch = await readIdBatch(chunk, input.fields.list, input.token, input.graph);
    if (batch.ok) {
      absorbNodes(map, batch.body);
      index += chunk.length;
      drops = 0;
      continue;
    }
    const rejected = rejectedCreativeField(batch.message);
    const next = rejected ? dropCreativeField(input.fields.list, rejected) : input.fields.list;
    if (rejected && next.length > 0 && next.length < input.fields.list.length && drops < 12) {
      input.fields.list = next;
      drops += 1;
      continue;
    }
    if (unnamedGraph100(batch.message)) {
      const isolated = await isolateCreativeFields({
        ids: chunk,
        fields: input.fields,
        token: input.token,
        graph: input.graph,
        deadline: input.deadline,
      });
      if (isolated && 'body' in isolated) {
        absorbNodes(map, isolated.body);
        index += chunk.length;
        drops = 0;
        continue;
      }
      if (isolated?.retry && drops < 12) {
        drops += 1;
        continue;
      }
    }
    throw new Error(batch.message);
  }
  return { map, truncated };
}

async function fetchPosts(input: {
  ids: string[];
  token: string;
  graph: Graph;
  deadline: number;
}): Promise<{ map: Record<string, unknown>; truncated: boolean; failed: number }> {
  const map: Record<string, unknown> = {};
  let truncated = false;
  let failed = 0;
  const fields = [POST_FIELDS];

  const readOne = async (id: string): Promise<boolean> => {
    if (Date.now() > input.deadline) {
      truncated = true;
      return false;
    }
    const single = await readIdBatch([id], fields, input.token, input.graph);
    if (!single.ok) {
      failed += 1;
      return true;
    }
    const split = splitNodes(single.body, [id]);
    if (split.bad.length) {
      failed += 1;
      return true;
    }
    Object.assign(map, split.good);
    return true;
  };

  let index = 0;
  while (index < input.ids.length) {
    if (Date.now() > input.deadline) {
      truncated = true;
      break;
    }
    const chunk = input.ids.slice(index, index + FIELD_CHUNK);
    const batch = await readIdBatch(chunk, fields, input.token, input.graph);
    if (!batch.ok) {
      if (chunk.length === 1) {
        failed += 1;
      } else {
        for (const id of chunk) {
          const finished = await readOne(id);
          if (!finished) break;
        }
      }
      index += chunk.length;
      continue;
    }
    const split = splitNodes(batch.body, chunk);
    Object.assign(map, split.good);
    if (split.bad.length === 1 && chunk.length === 1) {
      failed += 1;
    } else {
      for (const id of split.bad) {
        const finished = await readOne(id);
        if (!finished) break;
      }
    }
    index += chunk.length;
  }
  return { map, truncated, failed };
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
    postFetchFailed: 0,
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
  const creatives = await fetchCreatives({
    ids: creativeIds,
    fields: input.creativeFields,
    token: input.token,
    graph: input.graph,
    deadline: input.deadline,
  });
  if (creatives.truncated) base.truncated = true;

  const postIds = Array.from(new Set(
    Object.values(creatives.map)
      .map((creative) => storyIdForPostFetch(creative))
      .filter((id): id is string => !!id),
  ));
  const posts = await fetchPosts({
    ids: postIds,
    token: input.token,
    graph: input.graph,
    deadline: input.deadline,
  });
  if (posts.truncated) base.truncated = true;
  base.postFetchFailed = posts.failed;

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
