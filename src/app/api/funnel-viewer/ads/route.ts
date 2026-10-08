import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { fetchAccountCurrency, fetchAccountTimezone } from '@/lib/meta-api';
import { getRedis } from '@/lib/redis';
import {
  FUNNEL_ATTRIBUTION,
  assertRange,
  defaultFunnelRange,
  gateFunnelRequest,
  loadFunnelAds,
  type FunnelCache,
} from '@/lib/meta-funnel';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function redisCache(): FunnelCache | null {
  const redis = getRedis();
  if (!redis) return null;
  return {
    async get(key) {
      try { return await redis.get(key); } catch { return null; }
    },
    async set(key, value, ttlSeconds) {
      try { await redis.set(key, value, { ex: ttlSeconds }); } catch { /* cache is optional */ }
    },
    async del(key) {
      try { await redis.del(key); } catch { /* ignore */ }
    },
  };
}

export async function GET(request: NextRequest) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const authHeader = request.headers.get('authorization');
  if (!authHeader) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('users_profile')
    .select('role, brand_id')
    .eq('id', user.id)
    .single();

  const { searchParams } = new URL(request.url);
  const brandId = searchParams.get('brandId');
  const early = gateFunnelRequest({
    hasUser: true,
    role: profile?.role ?? null,
    profileBrandId: profile?.brand_id ?? null,
    brandId,
    brandFound: true,
    metaAccountId: 'pending',
  });
  if (!early.ok && early.status !== 422) {
    return NextResponse.json({ error: early.error, code: early.code }, { status: early.status });
  }
  if (!brandId) return NextResponse.json({ error: 'brandId required', code: 'brand_required' }, { status: 422 });

  const { data: brand, error: brandErr } = await supabase
    .from('brands')
    .select('id, name, meta_ad_account_id, archived_at')
    .eq('id', brandId)
    .single();

  const gate = gateFunnelRequest({
    hasUser: true,
    role: profile?.role ?? null,
    profileBrandId: profile?.brand_id ?? null,
    brandId,
    brandFound: !brandErr && !!brand && !brand.archived_at,
    metaAccountId: brand?.meta_ad_account_id ?? null,
  });
  if (!gate.ok || !brand) return NextResponse.json({ error: gate.ok ? 'Brand not found' : gate.error, code: gate.ok ? undefined : gate.code }, { status: gate.ok ? 404 : gate.status });

  let metaToken = process.env.META_ACCESS_TOKEN || '';
  if (!metaToken) {
    const { data: settings } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'meta_access_token')
      .single();
    metaToken = settings?.value || '';
  }
  if (!metaToken) {
    return NextResponse.json(
      { error: 'Meta access token not configured. Admin must add it in settings.' },
      { status: 400 },
    );
  }

  const accountId = brand!.meta_ad_account_id as string;
  const [currency, timezone] = await Promise.all([
    fetchAccountCurrency(metaToken, accountId),
    fetchAccountTimezone(metaToken, accountId),
  ]);
  const fallback = defaultFunnelRange(timezone || 'UTC');
  const since = searchParams.get('since') || fallback.since;
  const until = searchParams.get('until') || fallback.until;
  const rangeError = assertRange(since, until);
  if (rangeError) return NextResponse.json({ error: rangeError }, { status: 400 });

  const result = await loadFunnelAds({
    accountId,
    since,
    until,
    token: metaToken,
    refresh: searchParams.get('refresh') === '1',
    brand: { id: brand!.id, name: brand!.name },
    currency,
    timezone: timezone || null,
    cache: redisCache(),
    attribution: FUNNEL_ATTRIBUTION,
  });
  const headers = new Headers();
  if (result.retryAfter) headers.set('Retry-After', String(result.retryAfter));
  return NextResponse.json(result.body, { status: result.status, headers });
}
