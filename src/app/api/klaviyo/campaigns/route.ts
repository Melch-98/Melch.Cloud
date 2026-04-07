// ─── /api/klaviyo/campaigns ─────────────────────────────────────
// Returns Klaviyo email (and optionally SMS) campaigns for the
// calendar page.  Requires auth.  Admin sees all brands; strategists
// see only their own brand.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authenticateRequest } from '@/lib/auth';
import { fetchKlaviyoCampaigns, KlaviyoCampaign } from '@/lib/klaviyo-api';

export async function GET(request: NextRequest) {
  // Auth
  const { auth, error, status } = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error }, { status: status || 401 });

  // Query params
  const { searchParams } = new URL(request.url);
  const year = parseInt(searchParams.get('year') || `${new Date().getFullYear()}`, 10);
  const brandFilter = searchParams.get('brand_id'); // optional
  const channelParam = searchParams.get('channel') || 'email';

  // Supabase service client for reading integrations
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const supabase = createClient(supabaseUrl, serviceKey);

  // Determine which brands to fetch
  let brandQuery = supabase
    .from('brand_integrations')
    .select('brand_id, api_key, brands:brand_id(name)')
    .eq('provider', 'klaviyo');

  // Strategists can only see their own brand
  if (auth.role === 'strategist' && auth.brand_id) {
    brandQuery = brandQuery.eq('brand_id', auth.brand_id);
  } else if (brandFilter && brandFilter !== 'all') {
    brandQuery = brandQuery.eq('brand_id', brandFilter);
  }

  const { data: integrations, error: intErr } = await brandQuery;

  if (intErr) {
    // Table might not exist yet
    if (intErr.message.includes('brand_integrations')) {
      return NextResponse.json({ campaigns: [], warning: 'brand_integrations table not found — run the migration' });
    }
    return NextResponse.json({ error: intErr.message }, { status: 500 });
  }

  if (!integrations || integrations.length === 0) {
    return NextResponse.json({ campaigns: [] });
  }

  // Fetch campaigns from each brand's Klaviyo account in parallel
  // If channel is 'all', fetch both email and SMS
  const channels: ('email' | 'sms')[] = channelParam === 'all' ? ['email', 'sms'] : [channelParam as 'email' | 'sms'];

  const results = await Promise.allSettled(
    integrations.flatMap((row: any) =>
      channels.map(async (ch) => {
        const campaigns = await fetchKlaviyoCampaigns(row.api_key, year, ch);
        const brandName = row.brands?.name || 'Unknown';
        return campaigns.map((c) => ({
          ...c,
          brand_id: row.brand_id,
          brand_name: brandName,
        }));
      })
    )
  );

  const allCampaigns: KlaviyoCampaign[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      allCampaigns.push(...result.value);
    }
  }

  // Sort by send_time ascending
  allCampaigns.sort((a, b) => (a.send_time || '').localeCompare(b.send_time || ''));

  return NextResponse.json({ campaigns: allCampaigns });
}
