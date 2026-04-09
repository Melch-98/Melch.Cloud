import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { fetchCreativeInsights, fetchAdAccounts } from '@/lib/meta-api';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// GET: Fetch ad accounts or insights
export async function GET(request: NextRequest) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Verify auth
  const authHeader = request.headers.get('authorization');
  if (!authHeader) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Get user profile for role check
  const { data: profile } = await supabase
    .from('users_profile')
    .select('role, brand_id')
    .eq('id', user.id)
    .single();

  if (!profile || !['admin', 'strategist', 'founder'].includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Get Meta access token: env var first, then DB fallback
  let metaToken = process.env.META_ACCESS_TOKEN || '';

  if (!metaToken) {
    const { data: settings } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'meta_access_token')
      .single();

    if (!settings?.value) {
      return NextResponse.json(
        { error: 'Meta access token not configured. Admin must add it in settings.' },
        { status: 400 }
      );
    }
    metaToken = settings.value;
  }
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  try {
    if (action === 'accounts') {
      // Pull configured brands from DB instead of raw Meta API
      let brandsQuery = supabase
        .from('brands')
        .select('id, name, meta_ad_account_id')
        .not('meta_ad_account_id', 'is', null)
        .neq('meta_ad_account_id', '')
        .order('name');

      // Strategists only see their assigned brand
      if (profile.role !== 'admin' && profile.brand_id) {
        brandsQuery = brandsQuery.eq('id', profile.brand_id);
      }

      const { data: brands, error: brandsError } = await brandsQuery;
      if (brandsError) {
        return NextResponse.json({ error: brandsError.message }, { status: 500 });
      }

      const accounts = (brands || []).map((b) => ({
        id: b.meta_ad_account_id.startsWith('act_') ? b.meta_ad_account_id : `act_${b.meta_ad_account_id}`,
        name: b.name,
        brand_id: b.id,
        currency: '',
        account_status: 1,
      }));

      return NextResponse.json({ accounts });
    }

    // Default: fetch insights
    const adAccountId = searchParams.get('account_id');
    const dateFrom = searchParams.get('date_from');
    const dateTo = searchParams.get('date_to');
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const skipMedia = searchParams.get('skip_media') === 'true';

    if (!adAccountId || !dateFrom || !dateTo) {
      return NextResponse.json(
        { error: 'Missing required params: account_id, date_from, date_to' },
        { status: 400 }
      );
    }

    // Strategists can only access their assigned brand's ad account
    if (profile.role !== 'admin' && profile.brand_id) {
      const { data: brand } = await supabase
        .from('brands')
        .select('meta_ad_account_id')
        .eq('id', profile.brand_id)
        .single();

      if (brand?.meta_ad_account_id) {
        const normalizedRequested = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
        const normalizedAllowed = brand.meta_ad_account_id.startsWith('act_')
          ? brand.meta_ad_account_id
          : `act_${brand.meta_ad_account_id}`;

        if (normalizedRequested !== normalizedAllowed) {
          return NextResponse.json(
            { error: 'You can only view analytics for your assigned brand.' },
            { status: 403 }
          );
        }
      }
    }

    const insights = await fetchCreativeInsights(metaToken, adAccountId, dateFrom, dateTo, limit, skipMedia);

    return NextResponse.json({ insights });
  } catch (err: unknown) {
    console.error('Meta API error:', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST: Save Meta access token (admin only)
export async function POST(request: NextRequest) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const authHeader = request.headers.get('authorization');
  if (!authHeader) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from('users_profile')
    .select('role')
    .eq('id', user.id)
    .single();

  if (!profile || profile.role !== 'admin') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  }

  const body = await request.json();
  const { meta_access_token } = body;

  if (!meta_access_token) {
    return NextResponse.json({ error: 'Missing meta_access_token' }, { status: 400 });
  }

  // Upsert setting
  const { error } = await supabase
    .from('app_settings')
    .upsert(
      { key: 'meta_access_token', value: meta_access_token, updated_at: new Date().toISOString() },
      { onConflict: 'key' }
    );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
