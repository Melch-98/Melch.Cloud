import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getCampaignMetrics, resolvePipeboardToken } from '@/lib/pipeboard-google';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Returns today's spend + ROAS per brand for Meta and Google.
// Falls back to Triple Whale data when direct API calls fail (e.g. token permissions).
// Used by the founder dashboard ticker.

interface TickerRow {
  brand_id: string;
  brand_name: string;
  channel: 'meta' | 'google';
  spend: number;
  revenue: number;
  roas: number;
}

interface BrandRow {
  id: string;
  name: string;
  meta_ad_account_id: string | null;
  google_ads_customer_id: string | null;
  shopify_store_domain: string | null;
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
    .select('id, name, meta_ad_account_id, google_ads_customer_id, shopify_store_domain')
    .is('archived_at', null)
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

  const twApiKey = process.env.TRIPLEWHALE_API_KEY || '';
  const pipeboardToken = await resolvePipeboardToken(process.env.PIPEBOARD_API_TOKEN, async (key) => {
    const { data: settings } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', key)
      .single();
    return settings?.value || null;
  });
  const today = new Date().toISOString().split('T')[0];

  const fetchMeta = async (brand: BrandRow): Promise<TickerRow | null> => {
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

  // Google spend via Pipeboard Google MCP (direct Google Ads API by customer_id).
  // Windsor was cancelled; Pipeboard is the correct replacement and covers every
  // brand including Mintier (which has no shopify_store_domain).
  const fetchGoogle = async (brand: BrandRow): Promise<TickerRow | null> => {
    if (!brand.google_ads_customer_id || !pipeboardToken) return null;
    try {
      const m = await getCampaignMetrics(pipeboardToken, brand.google_ads_customer_id, 'TODAY');
      const campaigns = m?.campaigns || [];
      let spend = 0;
      let revenue = 0;
      for (const c of campaigns) {
        spend += Number(c.cost || 0);
        revenue += Number(c.conversions_value || 0);
      }
      if (spend === 0) return null;
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

  // Triple Whale fallback — used when direct Meta/Google API calls fail
  // (e.g. token doesn't have permission for a specific ad account)
  const fetchTwFallback = async (brand: BrandRow): Promise<TickerRow | null> => {
    if (!brand.shopify_store_domain || !twApiKey) return null;
    try {
      const res = await fetch('https://api.triplewhale.com/api/v2/orcabase/api/sql', {
        method: 'POST',
        headers: { 'x-api-key': twApiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopId: brand.shopify_store_domain,
          query: 'SELECT SUM(spend) AS spend, SUM(order_revenue) AS revenue FROM blended_stats_tvf WHERE event_date = @startDate',
          currency: 'USD',
          period: { startDate: today, endDate: today },
        }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      const rows = Array.isArray(data) ? data : data.data || [];
      const row = rows[0];
      if (!row) return null;
      const spend = parseFloat(row.spend || '0');
      const revenue = parseFloat(row.revenue || '0');
      if (spend === 0 && revenue === 0) return null;
      return {
        brand_id: brand.id,
        brand_name: brand.name,
        channel: 'meta', // TW fallback — attribute to primary paid channel
        spend,
        revenue,
        roas: spend > 0 ? revenue / spend : 0,
      };
    } catch {
      return null;
    }
  };

  // Phase 1: Fan out direct Meta + Google API calls in parallel
  const directTasks: Promise<TickerRow | null>[] = [];
  for (const b of brands || []) {
    directTasks.push(fetchMeta(b));
    directTasks.push(fetchGoogle(b));
  }
  const directResults = await Promise.all(directTasks);

  // Phase 2: Run TW fallback for brands that got NO direct API results
  const brandsWithResults = new Set<string>();
  for (const r of directResults) {
    if (r) brandsWithResults.add(r.brand_id);
  }

  const fallbackTasks: Promise<TickerRow | null>[] = [];
  for (const b of brands || []) {
    if (!brandsWithResults.has(b.id)) {
      fallbackTasks.push(fetchTwFallback(b));
    }
  }
  const fallbackResults = fallbackTasks.length > 0 ? await Promise.all(fallbackTasks) : [];

  const results = [...directResults, ...fallbackResults].filter((r): r is TickerRow => r !== null);

  return NextResponse.json({
    rows: results,
    as_of: new Date().toISOString(),
  });
}
