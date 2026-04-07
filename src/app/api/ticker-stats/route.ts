import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Returns today's spend + ROAS per brand for Meta and Google.
// Used by the founder dashboard ticker.

interface TickerRow {
  brand_id: string;
  brand_name: string;
  channel: 'meta' | 'google';
  spend: number;
  revenue: number;
  roas: number;
}

export async function GET(request: NextRequest) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Auth
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
    .select('role, brand_id')
    .eq('id', user.id)
    .single();

  if (!profile || !['admin', 'founder', 'strategist'].includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Fetch brands (founders see only their brand)
  let brandsQuery = supabase
    .from('brands')
    .select('id, name, meta_ad_account_id, google_ads_customer_id')
    .order('name');

  if (profile.role !== 'admin' && profile.brand_id) {
    brandsQuery = brandsQuery.eq('id', profile.brand_id);
  }

  const { data: brands, error: brandsError } = await brandsQuery;
  if (brandsError) {
    return NextResponse.json({ error: brandsError.message }, { status: 500 });
  }

  // Meta token
  let metaToken = process.env.META_ACCESS_TOKEN || '';
  if (!metaToken) {
    const { data: settings } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'meta_access_token')
      .single();
    if (settings?.value) metaToken = settings.value;
  }

  const windsorKey = process.env.WINDSOR_API_KEY || '';
  const today = new Date().toISOString().split('T')[0];

  const fetchMeta = async (brand: { id: string; name: string; meta_ad_account_id: string | null }): Promise<TickerRow | null> => {
    if (!brand.meta_ad_account_id || !metaToken) return null;
    const acctId = brand.meta_ad_account_id.startsWith('act_')
      ? brand.meta_ad_account_id
      : `act_${brand.meta_ad_account_id}`;
    try {
      const url = `https://graph.facebook.com/v19.0/${acctId}/insights?fields=spend,action_values&date_preset=today&access_token=${encodeURIComponent(metaToken)}`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const j = (await res.json()) as { data?: Array<{ spend?: string; action_values?: Array<{ action_type: string; value: string }> }> };
      const row = j.data?.[0];
      if (!row) return { brand_id: brand.id, brand_name: brand.name, channel: 'meta', spend: 0, revenue: 0, roas: 0 };
      const spend = parseFloat(row.spend || '0');
      const purchase = row.action_values?.find((a) => a.action_type === 'purchase' || a.action_type === 'omni_purchase');
      const revenue = purchase ? parseFloat(purchase.value) : 0;
      return {
        brand_id: brand.id,
        brand_name: brand.name,
        channel: 'meta',
        spend,
        revenue,
        roas: spend > 0 ? revenue / spend : 0,
      };
    } catch {
      return null;
    }
  };

  const fetchGoogle = async (brand: { id: string; name: string; google_ads_customer_id: string | null }): Promise<TickerRow | null> => {
    if (!brand.google_ads_customer_id || !windsorKey) return null;
    try {
      const custId = brand.google_ads_customer_id.replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3');
      const url = new URL('https://connectors.windsor.ai/google_ads');
      url.searchParams.set('api_key', windsorKey);
      url.searchParams.set('date_from', today);
      url.searchParams.set('date_to', today);
      url.searchParams.set('fields', 'account_id,date,spend,conversion_value');
      url.searchParams.set('_renderer', 'json');
      const res = await fetch(url.toString());
      if (!res.ok) return null;
      const data = await res.json();
      const rows = Array.isArray(data) ? data : data?.data || data?.result || [];
      let spend = 0;
      let revenue = 0;
      for (const r of rows) {
        if (r.account_id !== custId) continue;
        spend += r.spend || 0;
        revenue += r.conversion_value || 0;
      }
      return {
        brand_id: brand.id,
        brand_name: brand.name,
        channel: 'google',
        spend,
        revenue,
        roas: spend > 0 ? revenue / spend : 0,
      };
    } catch {
      return null;
    }
  };

  // Fan out all calls in parallel
  const tasks: Promise<TickerRow | null>[] = [];
  for (const b of brands || []) {
    tasks.push(fetchMeta(b));
    tasks.push(fetchGoogle(b));
  }
  const results = (await Promise.all(tasks)).filter((r): r is TickerRow => r !== null);

  return NextResponse.json({
    rows: results,
    as_of: new Date().toISOString(),
  });
}
