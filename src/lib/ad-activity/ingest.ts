import type { SupabaseClient } from '@supabase/supabase-js';
import { gaqlQuery, normalizeCustomerId, resolvePipeboardToken } from '@/lib/pipeboard-google';
import {
  googleChangeEventQuery,
  googleQueryBounds,
  metaAccountId,
  metaActivityFields,
  normalizeGoogleChange,
  normalizeMetaActivity,
  safeErrorMessage,
  type MetaActivity,
  type NormalizedActivity,
} from '@/lib/ad-activity/normalize';
import {
  ingestionWindow,
  META_SLICE_MS,
  sliceWindow,
} from '@/lib/ad-activity/windows';

export interface ActivityBrand {
  id: string;
  name: string;
  meta_ad_account_id: string | null;
  google_ads_customer_id: string | null;
}

export interface PlatformSyncResult {
  brand_id: string;
  platform: 'meta' | 'google';
  ok: boolean;
  skipped?: boolean;
  upserted: number;
  error?: string;
}

const META_GRAPH = 'https://graph.facebook.com/v21.0';
const PAGE_CAP = 80;

async function readSetting(sb: SupabaseClient, key: string): Promise<string | null> {
  const { data } = await sb.from('app_settings').select('value').eq('key', key).maybeSingle();
  return data?.value || null;
}

export async function resolveMetaToken(sb: SupabaseClient): Promise<string> {
  if (process.env.META_ACCESS_TOKEN) return process.env.META_ACCESS_TOKEN;
  return (await readSetting(sb, 'meta_access_token')) || '';
}

export async function resolveGoogleToken(sb: SupabaseClient): Promise<string> {
  return resolvePipeboardToken(process.env.PIPEBOARD_API_TOKEN, (key) => readSetting(sb, key));
}

async function markSync(
  sb: SupabaseClient,
  brandId: string,
  platform: 'meta' | 'google',
  patch: {
    account_id?: string | null;
    last_success_at?: string | null;
    last_error?: string | null;
    last_error_at?: string | null;
    last_manual_refresh_at?: string | null;
  }
): Promise<void> {
  const row: Record<string, unknown> = {
    brand_id: brandId,
    platform,
    updated_at: new Date().toISOString(),
  };
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) row[key] = value;
  }
  const { error } = await sb.from('ad_activity_sync').upsert(row, { onConflict: 'brand_id,platform' });
  if (error) throw new Error(error.message);
}

async function upsertActivities(
  sb: SupabaseClient,
  brandId: string,
  events: NormalizedActivity[]
): Promise<number> {
  if (events.length === 0) return 0;
  const rows = events.map((event) => ({
    brand_id: brandId,
    platform: event.platform,
    event_key: event.event_key,
    occurred_at: event.occurred_at,
    actor: event.actor,
    tool: event.tool,
    object_type: event.object_type,
    object_id: event.object_id,
    object_name: event.object_name,
    campaign_name: event.campaign_name,
    change_type: event.change_type,
    old_value: event.old_value,
    new_value: event.new_value,
    summary: event.summary,
    is_system: event.is_system,
    raw: event.raw,
  }));
  let written = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    const { error } = await sb.from('ad_activity').upsert(chunk, { onConflict: 'event_key' });
    if (error) throw new Error(error.message);
    written += chunk.length;
  }
  return written;
}

async function metaGet(token: string, path: string, params: Record<string, string>): Promise<unknown> {
  const url = new URL(`${META_GRAPH}/${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set('access_token', token);
  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new Error(safeErrorMessage(error, token));
  }
  const body = (await response.json().catch(() => ({}))) as {
    error?: { message?: string };
    data?: MetaActivity[];
    paging?: { next?: string; cursors?: { after?: string } };
    currency?: string;
  };
  if (!response.ok || body.error) {
    const message = body.error?.message || `Meta activities HTTP ${response.status}`;
    throw new Error(safeErrorMessage(new Error(message), token));
  }
  return body;
}

async function fetchMetaActivities(
  token: string,
  accountId: string,
  sinceMs: number,
  untilMs: number
): Promise<{ events: MetaActivity[]; truncated: boolean }> {
  const slices = sliceWindow(sinceMs, untilMs, META_SLICE_MS);
  const events: MetaActivity[] = [];
  let truncated = false;
  for (const slice of slices) {
    let after: string | undefined;
    let previousAfter = '';
    for (let page = 0; page < PAGE_CAP; page++) {
      const params: Record<string, string> = {
        fields: metaActivityFields(),
        limit: '25',
        since: String(Math.floor(slice.since / 1000)),
        until: String(Math.floor(slice.until / 1000)),
      };
      if (after) params.after = after;
      const body = (await metaGet(token, `${accountId}/activities`, params)) as {
        data?: MetaActivity[];
        paging?: { next?: string; cursors?: { after?: string } };
      };
      events.push(...(body.data || []));
      const nextAfter = body.paging?.cursors?.after;
      if (!body.paging?.next || !nextAfter || nextAfter === previousAfter) break;
      if (page === PAGE_CAP - 1) {
        truncated = true;
        break;
      }
      previousAfter = nextAfter;
      after = nextAfter;
    }
  }
  return { events, truncated };
}

async function fetchMetaCurrency(token: string, accountId: string): Promise<string | null> {
  const body = (await metaGet(token, accountId, { fields: 'currency' })) as { currency?: string };
  return body.currency ? body.currency.toUpperCase() : null;
}

async function syncMeta(
  sb: SupabaseClient,
  brand: ActivityBrand,
  token: string,
  now: number
): Promise<PlatformSyncResult> {
  const accountId = metaAccountId(brand.meta_ad_account_id);
  if (!accountId) return { brand_id: brand.id, platform: 'meta', ok: true, skipped: true, upserted: 0 };
  if (!token) {
    const error = 'Meta: META_ACCESS_TOKEN not configured';
    await markSync(sb, brand.id, 'meta', {
      account_id: accountId,
      last_error: error,
      last_error_at: new Date(now).toISOString(),
    });
    return { brand_id: brand.id, platform: 'meta', ok: false, upserted: 0, error };
  }

  const { data: syncRow } = await sb
    .from('ad_activity_sync')
    .select('last_success_at')
    .eq('brand_id', brand.id)
    .eq('platform', 'meta')
    .maybeSingle();

  const window = ingestionWindow({
    platform: 'meta',
    lastSuccessAt: syncRow?.last_success_at ?? null,
    now,
  });

  try {
    let currency: string | null = null;
    try {
      currency = await fetchMetaCurrency(token, accountId);
    } catch {
      currency = null;
    }
    const fetched = await fetchMetaActivities(token, accountId, window.since, window.until);
    const normalized = fetched.events
      .map((event) => normalizeMetaActivity(event, { accountId, currency }))
      .filter((event): event is NormalizedActivity => !!event);
    const deduped = dedupe(normalized);
    const upserted = await upsertActivities(sb, brand.id, deduped);
    const truncated = fetched.truncated
      ? 'Meta activity page cap reached; some older events in this window were not saved'
      : null;
    await markSync(sb, brand.id, 'meta', {
      account_id: accountId,
      last_success_at: new Date(window.until).toISOString(),
      last_error: truncated,
      last_error_at: truncated ? new Date(now).toISOString() : null,
    });
    return {
      brand_id: brand.id,
      platform: 'meta',
      ok: !truncated,
      upserted,
      error: truncated || undefined,
    };
  } catch (error) {
    const message = safeErrorMessage(error, token);
    await markSync(sb, brand.id, 'meta', {
      account_id: accountId,
      last_error: message,
      last_error_at: new Date(now).toISOString(),
    }).catch(() => undefined);
    return { brand_id: brand.id, platform: 'meta', ok: false, upserted: 0, error: message };
  }
}

function customerField(row: unknown, camel: string, snake: string): string | null {
  if (!row || typeof row !== 'object') return null;
  const customer = (row as { customer?: Record<string, unknown> }).customer;
  if (!customer) return null;
  const value = customer[camel] ?? customer[snake];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

async function syncGoogle(
  sb: SupabaseClient,
  brand: ActivityBrand,
  token: string,
  now: number
): Promise<PlatformSyncResult> {
  const customerId = normalizeCustomerId(brand.google_ads_customer_id);
  if (!customerId) return { brand_id: brand.id, platform: 'google', ok: true, skipped: true, upserted: 0 };
  if (!token) {
    const error = 'Google: PIPEBOARD_API_TOKEN not configured';
    await markSync(sb, brand.id, 'google', {
      account_id: customerId,
      last_error: error,
      last_error_at: new Date(now).toISOString(),
    });
    return { brand_id: brand.id, platform: 'google', ok: false, upserted: 0, error };
  }

  const { data: syncRow } = await sb
    .from('ad_activity_sync')
    .select('last_success_at')
    .eq('brand_id', brand.id)
    .eq('platform', 'google')
    .maybeSingle();

  const window = ingestionWindow({
    platform: 'google',
    lastSuccessAt: syncRow?.last_success_at ?? null,
    now,
  });

  try {
    const customerRows = await gaqlQuery(
      token,
      customerId,
      'SELECT customer.time_zone, customer.currency_code FROM customer LIMIT 1'
    );
    const timeZone = customerField(customerRows?.[0], 'timeZone', 'time_zone');
    const currency = customerField(customerRows?.[0], 'currencyCode', 'currency_code');
    if (!timeZone) throw new Error('Google customer time_zone was not returned');

    const collected: NormalizedActivity[] = [];
    let cursor = window.since;
    for (let pass = 0; pass < 5 && cursor < window.until; pass++) {
      const bounds = googleQueryBounds(cursor, window.until, timeZone);
      const query = googleChangeEventQuery(bounds.startLocal, bounds.endLocal);
      const rows = await gaqlQuery(token, customerId, query);
      const batch = (rows || [])
        .map((row) => normalizeGoogleChange(row, { customerId, currency, timeZone }))
        .filter((event): event is NormalizedActivity => !!event);
      collected.push(...batch);
      if (!rows || rows.length < 1000) break;
      const last = batch[batch.length - 1];
      const next = last ? new Date(last.occurred_at).getTime() + 1000 : cursor;
      if (next <= cursor) break;
      cursor = next;
    }

    const upserted = await upsertActivities(sb, brand.id, dedupe(collected));
    await markSync(sb, brand.id, 'google', {
      account_id: customerId,
      last_success_at: new Date(window.until).toISOString(),
      last_error: null,
      last_error_at: null,
    });
    return { brand_id: brand.id, platform: 'google', ok: true, upserted };
  } catch (error) {
    const message = safeErrorMessage(error, token);
    await markSync(sb, brand.id, 'google', {
      account_id: customerId,
      last_error: message,
      last_error_at: new Date(now).toISOString(),
    }).catch(() => undefined);
    return { brand_id: brand.id, platform: 'google', ok: false, upserted: 0, error: message };
  }
}

function dedupe(events: NormalizedActivity[]): NormalizedActivity[] {
  const byKey: Record<string, NormalizedActivity> = {};
  for (const event of events) byKey[event.event_key] = event;
  return Object.values(byKey);
}

export async function syncBrandActivity(
  sb: SupabaseClient,
  brand: ActivityBrand,
  tokens: { meta: string; pipeboard: string },
  now = Date.now()
): Promise<PlatformSyncResult[]> {
  const results: PlatformSyncResult[] = [];
  try {
    results.push(await syncMeta(sb, brand, tokens.meta, now));
  } catch (error) {
    results.push({
      brand_id: brand.id,
      platform: 'meta',
      ok: false,
      upserted: 0,
      error: safeErrorMessage(error, tokens.meta),
    });
  }
  try {
    results.push(await syncGoogle(sb, brand, tokens.pipeboard, now));
  } catch (error) {
    results.push({
      brand_id: brand.id,
      platform: 'google',
      ok: false,
      upserted: 0,
      error: safeErrorMessage(error, tokens.pipeboard),
    });
  }
  return results;
}

export async function listActivityBrands(sb: SupabaseClient): Promise<ActivityBrand[]> {
  const { data, error } = await sb
    .from('brands')
    .select('id, name, meta_ad_account_id, google_ads_customer_id, archived_at')
    .is('archived_at', null)
    .order('name');
  if (error) throw new Error(error.message);
  return (data || []).filter(
    (brand) =>
      (brand.meta_ad_account_id && brand.meta_ad_account_id.trim()) ||
      (brand.google_ads_customer_id && brand.google_ads_customer_id.trim())
  ) as ActivityBrand[];
}

const CRON_BUDGET_MS = 240_000;

export async function syncAllActivity(sb: SupabaseClient, started = Date.now()): Promise<{
  results: PlatformSyncResult[];
  deferred: string[];
}> {
  const brands = await listActivityBrands(sb);
  const tokens = {
    meta: await resolveMetaToken(sb),
    pipeboard: await resolveGoogleToken(sb),
  };
  const results: PlatformSyncResult[] = [];
  const deferred: string[] = [];
  for (const brand of brands) {
    if (Date.now() - started > CRON_BUDGET_MS) {
      deferred.push(brand.id);
      continue;
    }
    const brandResults = await syncBrandActivity(sb, brand, tokens);
    results.push(...brandResults);
  }
  return { results, deferred };
}

export async function manualRefreshAllowed(
  sb: SupabaseClient,
  brandId: string,
  now = Date.now()
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const { data } = await sb
    .from('ad_activity_sync')
    .select('last_manual_refresh_at')
    .eq('brand_id', brandId);
  let latest = 0;
  for (const row of data || []) {
    if (!row.last_manual_refresh_at) continue;
    const stamp = new Date(row.last_manual_refresh_at).getTime();
    if (stamp > latest) latest = stamp;
  }
  const elapsed = now - latest;
  if (latest && elapsed < 60_000) {
    return { allowed: false, retryAfterSeconds: Math.ceil((60_000 - elapsed) / 1000) };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

export async function stampManualRefresh(sb: SupabaseClient, brand: ActivityBrand): Promise<void> {
  const now = new Date().toISOString();
  const platforms: Array<'meta' | 'google'> = [];
  if (metaAccountId(brand.meta_ad_account_id)) platforms.push('meta');
  if (normalizeCustomerId(brand.google_ads_customer_id)) platforms.push('google');
  for (const platform of platforms) {
    await markSync(sb, brand.id, platform, { last_manual_refresh_at: now });
  }
}
