import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { fetchAdMedia } from '@/lib/meta-api';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
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

  // Brand scoping: non-admins can only view ads that belong to their brand
  const { data: profile } = await supabase
    .from('users_profile')
    .select('role, brand_id')
    .eq('id', user.id)
    .single();
  if (!profile) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let metaToken = process.env.META_ACCESS_TOKEN || '';
  if (!metaToken) {
    const { data: settings } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'meta_access_token')
      .single();
    if (!settings?.value) {
      return NextResponse.json({ error: 'Meta token not configured' }, { status: 400 });
    }
    metaToken = settings.value;
  }

  const { searchParams } = new URL(request.url);
  const adId = searchParams.get('ad_id');

  if (!adId) {
    return NextResponse.json({ error: 'Missing ad_id' }, { status: 400 });
  }

  // Enforce brand scoping: non-admins must own this ad via ad_snapshots
  if (profile.role !== 'admin') {
    const { data: snap } = await supabase
      .from('ad_snapshots')
      .select('brand_id')
      .eq('ad_id', adId)
      .limit(1)
      .maybeSingle();
    if (!snap || snap.brand_id !== profile.brand_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  try {
    const media = await fetchAdMedia(metaToken, adId);
    return NextResponse.json(media);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
