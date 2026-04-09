import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { fetchCopyAnalysis } from '@/lib/meta-api';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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

  // Get Meta access token
  let metaToken = process.env.META_ACCESS_TOKEN || '';
  if (!metaToken) {
    const { data: settings } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'meta_access_token')
      .single();
    if (!settings?.value) {
      return NextResponse.json(
        { error: 'Meta access token not configured.' },
        { status: 400 }
      );
    }
    metaToken = settings.value;
  }

  const { searchParams } = new URL(request.url);
  const adAccountId = searchParams.get('account_id');
  const dateFrom = searchParams.get('date_from');
  const dateTo = searchParams.get('date_to');
  const limit = parseInt(searchParams.get('limit') || '100', 10);

  if (!adAccountId || !dateFrom || !dateTo) {
    return NextResponse.json(
      { error: 'Missing required params: account_id, date_from, date_to' },
      { status: 400 }
    );
  }

  // Non-admins can only access their assigned brand
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

  try {
    const copyInputs = await fetchCopyAnalysis(metaToken, adAccountId, dateFrom, dateTo, limit);
    return NextResponse.json({ inputs: copyInputs });
  } catch (err: unknown) {
    console.error('Copy analysis error:', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
