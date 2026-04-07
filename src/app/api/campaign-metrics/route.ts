import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Normalized campaign type returned to the frontend
interface CampaignMetric {
  platform: 'meta' | 'google';
  campaignId: string;
  campaignName: string;
  campaignType: string;   // SALES, SEARCH, SHOPPING, etc.
  status: string;
  // Aggregate metrics
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  cpm: number;
  purchases: number;
  purchaseValue: number;
  roas: number;
  cpa: number;
  reach: number;
  // Daily breakdown
  daily: { date: string; spend: number; impressions: number; clicks: number; purchases: number; purchaseValue: number }[];
}

export async function GET(request: NextRequest) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Verify auth
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('users_profile')
    .select('role, brand_id')
    .eq('id', user.id)
    .single();

  if (!profile || !['admin', 'strategist', 'founder'].includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const brandId = searchParams.get('brandId');
  const dateRange = searchParams.get('dateRange') || 'last_30d';

  if (!brandId) return NextResponse.json({ error: 'brandId required' }, { status: 400 });

  // Get brand config (ad account IDs) — select ALL columns to avoid missing-column bugs
  const { data: brand, error: brandError } = await supabase
    .from('brands')
    .select('*')
    .eq('id', brandId)
    .single();

  if (brandError || !brand) {
    return NextResponse.json({ error: 'Brand not found' }, { status: 404 });
  }

  // Get Meta token
  let metaToken = process.env.META_ACCESS_TOKEN || '';
  if (!metaToken) {
    const { data: settings } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'meta_access_token')
      .single();
    metaToken = settings?.value || '';
  }

  // Map date range to Meta and Google formats
  const metaRange = dateRange; // already in meta format
  const googleRangeMap: Record<string, string> = {
    'last_7d': 'LAST_7_DAYS',
    'last_14d': 'LAST_7_DAYS', // fallback
    'last_30d': 'LAST_30_DAYS',
    'last_90d': 'LAST_90_DAYS',
    'this_month': 'THIS_MONTH',
    'last_month': 'LAST_MONTH',
  };
  const googleRange = googleRangeMap[dateRange] || 'LAST_30_DAYS';

  const campaigns: CampaignMetric[] = [];
  const errors: string[] = [];

  // Surface missing config so the UI can tell the admin what's wrong
  if (!brand.meta_ad_account_id || !brand.meta_ad_account_id.trim()) {
    errors.push('Meta: No ad account ID configured for this brand. Set it in Team settings.');
  } else if (!metaToken) {
    errors.push('Meta: No access token configured. Add it in Admin settings.');
  }

  if (!brand.google_ads_customer_id || !brand.google_ads_customer_id.trim()) {
    errors.push('Google: No customer ID configured for this brand. Set it in Team settings.');
  }

  // ── Fetch Meta campaign insights ──
  if (brand.meta_ad_account_id && brand.meta_ad_account_id.trim() && metaToken) {
    try {
      const metaUrl = `https://graph.facebook.com/v21.0/${brand.meta_ad_account_id}/insights?` +
        `level=campaign&time_range=${encodeURIComponent(JSON.stringify(dateRangeToMeta(dateRange)))}` +
        `&time_increment=1` +
        `&fields=campaign_id,campaign_name,impressions,clicks,spend,cpc,cpm,ctr,reach,frequency,actions,action_values` +
        `&limit=500` +
        `&access_token=${metaToken}`;

      const metaRes = await fetch(metaUrl);
      const metaData = await metaRes.json();

      if (metaData.error) {
        errors.push(`Meta API error: ${metaData.error.message || JSON.stringify(metaData.error)} (code ${metaData.error.code || 'unknown'})`);
      } else if (metaData.data) {
        // Group by campaign
        const byCampaign = new Map<string, typeof metaData.data>();
        for (const row of metaData.data) {
          const id = row.campaign_id;
          if (!byCampaign.has(id)) byCampaign.set(id, []);
          byCampaign.get(id)!.push(row);
        }

        for (const [campaignId, rows] of byCampaign) {
          let totalSpend = 0, totalImpressions = 0, totalClicks = 0;
          let totalPurchases = 0, totalPurchaseValue = 0, totalReach = 0;
          const daily: CampaignMetric['daily'] = [];

          for (const row of rows) {
            const spend = parseFloat(row.spend || '0');
            const impressions = parseInt(row.impressions || '0');
            const clicks = parseInt(row.clicks || '0');
            const reach = parseInt(row.reach || '0');
            const purchases = extractMetaAction(row.actions, 'purchase');
            const purchaseValue = extractMetaAction(row.action_values, 'purchase');

            totalSpend += spend;
            totalImpressions += impressions;
            totalClicks += clicks;
            totalPurchases += purchases;
            totalPurchaseValue += purchaseValue;
            totalReach += reach;

            daily.push({
              date: row.date_start,
              spend, impressions, clicks, purchases, purchaseValue,
            });
          }

          // Sort daily by date
          daily.sort((a, b) => a.date.localeCompare(b.date));

          // Skip campaigns with no spend
          if (totalSpend <= 0) continue;

          campaigns.push({
            platform: 'meta',
            campaignId,
            campaignName: rows[0].campaign_name || campaignId,
            campaignType: 'SALES', // Meta campaigns for this account are all OUTCOME_SALES
            status: 'ACTIVE',
            spend: totalSpend,
            impressions: totalImpressions,
            clicks: totalClicks,
            ctr: totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0,
            cpc: totalClicks > 0 ? totalSpend / totalClicks : 0,
            cpm: totalImpressions > 0 ? (totalSpend / totalImpressions) * 1000 : 0,
            purchases: totalPurchases,
            purchaseValue: totalPurchaseValue,
            roas: totalSpend > 0 ? totalPurchaseValue / totalSpend : 0,
            cpa: totalPurchases > 0 ? totalSpend / totalPurchases : 0,
            reach: totalReach,
            daily,
          });
        }
      } else {
        errors.push(`Meta: Unexpected response — no data or error returned. Account: ${brand.meta_ad_account_id}`);
      }
    } catch (e: any) {
      errors.push(`Meta: ${e.message}`);
    }
  }

  // ── Fetch Google Ads campaign metrics via Windsor.ai ──
  if (brand.google_ads_customer_id && brand.google_ads_customer_id.trim()) {
    try {
      // Get Windsor API key from env or app_settings
      let windsorKey = process.env.WINDSOR_API_KEY || '';
      if (!windsorKey) {
        const { data: settings } = await supabase
          .from('app_settings')
          .select('value')
          .eq('key', 'windsor_api_key')
          .single();
        windsorKey = settings?.value || '';
      }

      if (windsorKey) {
        // Format the Google Ads customer ID for Windsor (dashes: 699-695-6911)
        const custId = brand.google_ads_customer_id.replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3');

        // Windsor date range mapping
        const windsorRange = dateRange; // Windsor uses same format: last_7d, last_30d, etc.

        const windsorUrl = new URL('https://connectors.windsor.ai/google_ads');
        windsorUrl.searchParams.set('api_key', windsorKey);
        windsorUrl.searchParams.set('date_preset', windsorRange);
        windsorUrl.searchParams.set('accounts', custId);
        windsorUrl.searchParams.set('fields', [
          'campaign', 'campaign_id', 'campaign_status', 'campaign_type',
          'account_id', 'date', 'spend', 'impressions', 'clicks', 'ctr', 'cpc',
          'conversions', 'conversions_value',
        ].join(','));
        windsorUrl.searchParams.set('_renderer', 'json');

        const windsorRes = await fetch(windsorUrl.toString());
        const windsorData = await windsorRes.json();

        // Windsor returns { data: [...] } or flat array
        const allRows = Array.isArray(windsorData) ? windsorData
          : windsorData?.data ? windsorData.data
          : windsorData?.result ? windsorData.result
          : [];

        // Windsor ignores the accounts param — filter client-side by account_id
        const rows = allRows.filter((row: any) => row.account_id === custId);

        if (rows.length > 0) {
          // Group by campaign_id
          const byCampaign = new Map<string, typeof rows>();
          for (const row of rows) {
            if ((row.spend || 0) <= 0) continue; // skip zero-spend days
            const id = row.campaign_id;
            if (!byCampaign.has(id)) byCampaign.set(id, []);
            byCampaign.get(id)!.push(row);
          }

          for (const [campaignId, cRows] of byCampaign) {
            let totalSpend = 0, totalImpressions = 0, totalClicks = 0;
            let totalConversions = 0, totalConvValue = 0;
            const daily: CampaignMetric['daily'] = [];

            for (const row of cRows) {
              const spend = row.spend || 0;
              const impressions = row.impressions || 0;
              const clicks = row.clicks || 0;
              const conversions = row.conversions || 0;
              const convValue = row.conversions_value || 0;

              totalSpend += spend;
              totalImpressions += impressions;
              totalClicks += clicks;
              totalConversions += conversions;
              totalConvValue += convValue;

              daily.push({
                date: row.date,
                spend, impressions, clicks,
                purchases: conversions,
                purchaseValue: convValue,
              });
            }

            daily.sort((a, b) => a.date.localeCompare(b.date));

            // Skip campaigns with no spend
            if (totalSpend <= 0) continue;

            campaigns.push({
              platform: 'google',
              campaignId,
              campaignName: cRows[0].campaign || campaignId,
              campaignType: cRows[0].campaign_type || 'SEARCH',
              status: cRows[0].campaign_status || 'ENABLED',
              spend: totalSpend,
              impressions: totalImpressions,
              clicks: totalClicks,
              ctr: totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0,
              cpc: totalClicks > 0 ? totalSpend / totalClicks : 0,
              cpm: totalImpressions > 0 ? (totalSpend / totalImpressions) * 1000 : 0,
              purchases: totalConversions,
              purchaseValue: totalConvValue,
              roas: totalSpend > 0 ? totalConvValue / totalSpend : 0,
              cpa: totalConversions > 0 ? totalSpend / totalConversions : 0,
              reach: 0, // Google Ads doesn't have reach
              daily,
            });
          }
        }
      } else {
        errors.push('Google: Windsor API key not configured');
      }
    } catch (e: any) {
      errors.push(`Google: ${e.message}`);
    }
  }

  return NextResponse.json({
    campaigns,
    errors: errors.length > 0 ? errors : undefined,
    meta: {
      metaAccountId: brand.meta_ad_account_id,
      googleCustomerId: brand.google_ads_customer_id,
      dateRange,
    },
  });
}

// Helper: extract a specific action type value from Meta actions array
function extractMetaAction(actions: any[] | undefined, actionType: string): number {
  if (!actions) return 0;
  const found = actions.find((a: any) => a.action_type === actionType);
  return found ? parseFloat(found.value) : 0;
}

// Helper: convert date range string to Meta API format
function dateRangeToMeta(range: string): { since: string; until: string } | string {
  const now = new Date();
  const fmt = (d: Date) => d.toISOString().split('T')[0];

  switch (range) {
    case 'last_7d': {
      const since = new Date(now);
      since.setDate(since.getDate() - 7);
      return { since: fmt(since), until: fmt(now) };
    }
    case 'last_14d': {
      const since = new Date(now);
      since.setDate(since.getDate() - 14);
      return { since: fmt(since), until: fmt(now) };
    }
    case 'last_30d': {
      const since = new Date(now);
      since.setDate(since.getDate() - 30);
      return { since: fmt(since), until: fmt(now) };
    }
    case 'last_90d': {
      const since = new Date(now);
      since.setDate(since.getDate() - 90);
      return { since: fmt(since), until: fmt(now) };
    }
    case 'this_month': {
      const since = new Date(now.getFullYear(), now.getMonth(), 1);
      return { since: fmt(since), until: fmt(now) };
    }
    default: {
      const since = new Date(now);
      since.setDate(since.getDate() - 30);
      return { since: fmt(since), until: fmt(now) };
    }
  }
}
