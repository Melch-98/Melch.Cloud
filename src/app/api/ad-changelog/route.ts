import { NextRequest, NextResponse } from 'next/server';
import {
  manualRefreshAllowed,
  resolveGoogleToken,
  resolveMetaToken,
  stampManualRefresh,
  syncBrandActivity,
  type ActivityBrand,
} from '@/lib/ad-activity/ingest';
import { metaAccountId } from '@/lib/ad-activity/normalize';
import { chicagoDayBounds } from '@/lib/ad-activity/windows';
import { normalizeCustomerId } from '@/lib/pipeboard-google';
import { createServiceClient } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const CHANGE_TYPES = new Set([
  'budget',
  'bid_or_target',
  'status',
  'created',
  'removed',
  'creative',
  'targeting',
  'name',
  'other',
]);

function migrationMissing(message: string): boolean {
  return /ad_activity/i.test(message) && /schema cache|does not exist|could not find|relation/i.test(message);
}

async function authorize(request: NextRequest) {
  const sb = createServiceClient();
  if (!sb) return { error: NextResponse.json({ error: 'Server config error' }, { status: 500 }) };

  const authHeader = request.headers.get('authorization');
  if (!authHeader) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authError } = await sb.auth.getUser(token);
  if (authError || !user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };

  const { data: profile } = await sb
    .from('users_profile')
    .select('role, brand_id')
    .eq('id', user.id)
    .single();

  if (!profile || !['admin', 'founder'].includes(profile.role)) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }

  return { sb, profile };
}

function assertBrand(profile: { role: string; brand_id: string | null }, brandId: string) {
  if (profile.role === 'founder' && profile.brand_id !== brandId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return null;
}

interface SyncRow {
  platform: 'meta' | 'google';
  last_success_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
}

function platformState(connected: boolean, row: SyncRow | undefined) {
  return {
    connected,
    last_success_at: row?.last_success_at ?? null,
    last_error: row?.last_error ?? null,
    last_error_at: row?.last_error_at ?? null,
  };
}

export async function GET(request: NextRequest) {
  const auth = await authorize(request);
  if (auth.error) return auth.error;
  const { sb, profile } = auth;

  const { searchParams } = new URL(request.url);
  const brandId = searchParams.get('brand_id');
  if (!brandId) return NextResponse.json({ error: 'brand_id required' }, { status: 400 });

  const denied = assertBrand(profile, brandId);
  if (denied) return denied;

  const platform = searchParams.get('platform');
  if (platform && platform !== 'meta' && platform !== 'google') {
    return NextResponse.json({ error: 'platform must be meta or google' }, { status: 400 });
  }
  const changeType = searchParams.get('change_type');
  if (changeType && !CHANGE_TYPES.has(changeType)) {
    return NextResponse.json({ error: 'Unknown change type' }, { status: 400 });
  }
  const actor = searchParams.get('actor');
  const includeSystem = searchParams.get('include_system') === '1';
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '500', 10) || 500, 1), 1000);

  let fromIso: string;
  let toIso: string;
  try {
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    if (from && to) {
      ({ fromIso, toIso } = chicagoDayBounds(from, to));
    } else {
      const today = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Chicago',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
      const [year, month, day] = today.split('-').map(Number);
      const start = new Date(Date.UTC(year, month - 1, day - 6));
      const fromYmd = start.toISOString().slice(0, 10);
      ({ fromIso, toIso } = chicagoDayBounds(fromYmd, today));
    }
  } catch {
    return NextResponse.json({ error: 'Date range must be YYYY-MM-DD' }, { status: 400 });
  }

  const { data: brand, error: brandError } = await sb
    .from('brands')
    .select('id, meta_ad_account_id, google_ads_customer_id')
    .eq('id', brandId)
    .maybeSingle();
  if (brandError) return NextResponse.json({ error: brandError.message }, { status: 500 });
  if (!brand) return NextResponse.json({ error: 'Brand not found' }, { status: 404 });

  const metaConnected = !!metaAccountId(brand.meta_ad_account_id);
  const googleConnected = !!normalizeCustomerId(brand.google_ads_customer_id);

  const { data: syncRows, error: syncError } = await sb
    .from('ad_activity_sync')
    .select('platform, last_success_at, last_error, last_error_at')
    .eq('brand_id', brandId);
  if (syncError) {
    const status = migrationMissing(syncError.message) ? 503 : 500;
    const message = migrationMissing(syncError.message)
      ? 'ad_activity is not available yet. Apply supabase/migrations/add_ad_activity.sql.'
      : syncError.message;
    return NextResponse.json({ error: message }, { status });
  }

  let query = sb
    .from('ad_activity')
    .select('id, brand_id, platform, occurred_at, actor, tool, object_type, object_id, object_name, campaign_name, change_type, old_value, new_value, summary, is_system')
    .eq('brand_id', brandId)
    .gte('occurred_at', fromIso)
    .lte('occurred_at', toIso)
    .order('occurred_at', { ascending: false })
    .limit(limit);

  if (platform) query = query.eq('platform', platform);
  if (changeType) query = query.eq('change_type', changeType);
  if (actor) query = query.eq('actor', actor);
  if (!includeSystem) query = query.eq('is_system', false);

  const { data: entries, error: entryError } = await query;
  if (entryError) {
    const status = migrationMissing(entryError.message) ? 503 : 500;
    const message = migrationMissing(entryError.message)
      ? 'ad_activity is not available yet. Apply supabase/migrations/add_ad_activity.sql.'
      : entryError.message;
    return NextResponse.json({ error: message }, { status });
  }

  let actorQuery = sb
    .from('ad_activity')
    .select('actor')
    .eq('brand_id', brandId)
    .gte('occurred_at', fromIso)
    .lte('occurred_at', toIso)
    .limit(1000);
  if (platform) actorQuery = actorQuery.eq('platform', platform);
  if (!includeSystem) actorQuery = actorQuery.eq('is_system', false);
  const { data: actorRows } = await actorQuery;
  const actorSet: Record<string, true> = {};
  for (const row of actorRows || []) {
    const name = (row as { actor?: string | null }).actor;
    if (name) actorSet[name] = true;
  }
  const actors = Object.keys(actorSet).sort((a, b) => a.localeCompare(b));

  const syncByPlatform = new Map<string, SyncRow>();
  for (const row of (syncRows || []) as SyncRow[]) {
    syncByPlatform.set(row.platform, row);
  }
  const sync = {
    meta: platformState(metaConnected, syncByPlatform.get('meta')),
    google: platformState(googleConnected, syncByPlatform.get('google')),
  };

  const wanted: Array<'meta' | 'google'> = [];
  if (!platform || platform === 'meta') wanted.push('meta');
  if (!platform || platform === 'google') wanted.push('google');
  const relevant = wanted.filter((name) => sync[name].connected);
  let emptyReason: 'not_connected' | 'error' | 'no_changes' | null = null;
  if ((entries || []).length === 0) {
    if (relevant.length === 0) emptyReason = 'not_connected';
    else if (relevant.every((name) => sync[name].last_error && !sync[name].last_success_at)) emptyReason = 'error';
    else emptyReason = 'no_changes';
  }

  return NextResponse.json({
    entries: entries || [],
    actors,
    sync,
    empty_reason: emptyReason,
  });
}

export async function POST(request: NextRequest) {
  const auth = await authorize(request);
  if (auth.error) return auth.error;
  const { sb, profile } = auth;

  let body: { brand_id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'brand_id required' }, { status: 400 });
  }
  const brandId = body.brand_id;
  if (!brandId) return NextResponse.json({ error: 'brand_id required' }, { status: 400 });

  const denied = assertBrand(profile, brandId);
  if (denied) return denied;

  const { data: brand, error: brandError } = await sb
    .from('brands')
    .select('id, name, meta_ad_account_id, google_ads_customer_id, archived_at')
    .eq('id', brandId)
    .maybeSingle();
  if (brandError) return NextResponse.json({ error: brandError.message }, { status: 500 });
  if (!brand || brand.archived_at) return NextResponse.json({ error: 'Brand not found' }, { status: 404 });

  const activityBrand: ActivityBrand = {
    id: brand.id,
    name: brand.name,
    meta_ad_account_id: brand.meta_ad_account_id,
    google_ads_customer_id: brand.google_ads_customer_id,
  };
  const connected = !!metaAccountId(activityBrand.meta_ad_account_id) || !!normalizeCustomerId(activityBrand.google_ads_customer_id);
  if (!connected) {
    return NextResponse.json({ success: true, connected: false, results: [] });
  }

  const gate = await manualRefreshAllowed(sb, brandId);
  if (!gate.allowed) {
    return NextResponse.json(
      { error: 'Refresh is limited to once a minute.', retry_after_seconds: gate.retryAfterSeconds },
      { status: 429 }
    );
  }

  try {
    await stampManualRefresh(sb, activityBrand);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Refresh failed';
    if (migrationMissing(message)) {
      return NextResponse.json(
        { error: 'ad_activity is not available yet. Apply supabase/migrations/add_ad_activity.sql.' },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const tokens = {
    meta: await resolveMetaToken(sb),
    pipeboard: await resolveGoogleToken(sb),
  };
  const results = await syncBrandActivity(sb, activityBrand, tokens);
  const failures = results.filter((result) => !result.ok && !result.skipped);
  return NextResponse.json({
    success: failures.length === 0,
    connected: true,
    results,
    errors: failures.map((result) => `${result.platform}: ${result.error}`),
  });
}
