import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getCampaignMetrics, getCampaigns } from '@/lib/pipeboard-google';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Normalized campaign type returned to the frontend
interface CampaignMetric {
  platform: 'meta' | 'google';
  campaignId: string;
  campaignName: string;
  campaignType: string;   // OUTCOME_SALES, OUTCOME_AWARENESS, SEARCH, SHOPPING, etc.
  status: string;         // ACTIVE, PAUSED, DELETED, etc.
  frequency: number;      // avg times a user sees the ad (Meta only, 0 for Google)
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

  // Non-admins can only fetch their own brand
  if (profile.role !== 'admin' && profile.brand_id !== brandId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

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
    'last_14d': 'LAST_14_DAYS',
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
      const metaTimeRange = encodeURIComponent(JSON.stringify(dateRangeToMeta(dateRange)));
      const metaFields = 'campaign_id,campaign_name,impressions,clicks,spend,cpc,cpm,ctr,reach,frequency,actions,action_values';
      const firstUrl = `https://graph.facebook.com/v21.0/${brand.meta_ad_account_id}/insights?` +
        `level=campaign&time_range=${metaTimeRange}` +
        `&time_increment=1` +
        `&fields=${metaFields}` +
        `&limit=500` +
        `&access_token=${metaToken}`;

      // Paginate through all results
      const allMetaRows: any[] = [];
      let nextUrl: string | null = firstUrl;
      while (nextUrl) {
        const metaRes = await fetch(nextUrl);
        const metaPage = await metaRes.json();
        if (metaPage.error) {
          errors.push(`Meta API error: ${metaPage.error.message || JSON.stringify(metaPage.error)} (code ${metaPage.error.code || 'unknown'})`);
          break;
        }
        if (metaPage.data) allMetaRows.push(...metaPage.data);
        nextUrl = metaPage.paging?.next || null;
      }

      if (allMetaRows.length > 0) {
        // Group by campaign
        const byCampaign = new Map<string, any[]>();
        for (const row of allMetaRows) {
          const id = row.campaign_id;
          if (!byCampaign.has(id)) byCampaign.set(id, []);
          byCampaign.get(id)!.push(row);
        }

        // Fetch campaign-level metadata (objective, status) in one batch
        const campaignIds = Array.from(byCampaign.keys());
        const campaignMeta: Record<string, { objective: string; status: string }> = {};
        try {
          const idsParam = campaignIds.join(',');
          const metaInfoRes = await fetch(
            `https://graph.facebook.com/v21.0/?ids=${idsParam}&fields=objective,effective_status&access_token=${metaToken}`
          );
          if (metaInfoRes.ok) {
            const metaInfo = await metaInfoRes.json();
            for (const [id, info] of Object.entries(metaInfo as Record<string, any>)) {
              campaignMeta[id] = {
                objective: info.objective || 'UNKNOWN',
                status: info.effective_status || 'UNKNOWN',
              };
            }
          }
        } catch { /* non-fatal — fall back to UNKNOWN */ }

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

          const meta = campaignMeta[campaignId] || { objective: 'UNKNOWN', status: 'UNKNOWN' };
          const objective = meta.objective;
          const effectiveStatus = meta.status;
          // Calculate blended frequency (weighted by impressions)
          let totalFreqWeighted = 0;
          for (const row of rows) {
            const imp = parseInt(row.impressions || '0');
            const freq = parseFloat(row.frequency || '0');
            totalFreqWeighted += freq * imp;
          }
          const blendedFrequency = totalImpressions > 0 ? totalFreqWeighted / totalImpressions : 0;

          campaigns.push({
            platform: 'meta',
            campaignId,
            campaignName: rows[0].campaign_name || campaignId,
            campaignType: objective,
            status: effectiveStatus,
            frequency: blendedFrequency,
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
      }
    } catch (e: any) {
      errors.push(`Meta: ${e.message}`);
    }
  }

  // ── Fetch Google Ads campaign metrics via Pipeboard Google MCP ──
  if (brand.google_ads_customer_id && brand.google_ads_customer_id.trim()) {
    try {
      // Get Pipeboard token from env or app_settings
      let pipeboardToken = process.env.PIPEBOARD_API_TOKEN || '';
      if (!pipeboardToken) {
        const { data: settings } = await supabase
          .from('app_settings')
          .select('value')
          .eq('key', 'pipeboard_api_token')
          .single();
        pipeboardToken = settings?.value || '';
      }

      if (pipeboardToken) {
        const custId = brand.google_ads_customer_id.replace(/\D/g, '');
        const rng = dateRangeToMeta(dateRange);
        const since = typeof rng === 'string' ? new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0] : rng.since;
        const until = typeof rng === 'string' ? new Date().toISOString().split('T')[0] : rng.until;
        const query = `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value, segments.date FROM campaign WHERE segments.date BETWEEN "${since}" AND "${until}" ORDER BY campaign.id, segments.date`;

        const res = await fetch(`https://google-ads.mcp.pipeboard.co/?token=${encodeURIComponent(pipeboardToken)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0', id: 1, method: 'tools/call',
            params: { name: 'execute_google_ads_gaql_query', arguments: { customer_id: custId, query } },
          }),
        });
        if (!res.ok) {
          errors.push(`Google: Pipeboard HTTP ${res.status}`);
        } else {
          const j = await res.json();
          const text = j?.result?.content?.[0]?.text;
          const parsed = text ? JSON.parse(text) : null;
          const rows = Array.isArray(parsed) ? parsed : parsed?.results || [];

          // Group per-day rows by campaign_id (same shape as the old Windsor path)
          const byCampaign = new Map<string, any[]>();
          rows.forEach((row: any) => {
            const id = row?.campaign?.resourceName?.split('/campaigns/')[1] || row?.campaign?.id;
            if (!id) return;
            if (!byCampaign.has(id)) byCampaign.set(id, []);
            byCampaign.get(id)!.push(row);
          });

          byCampaign.forEach((cRows: any[], campaignId: string) => {
            let totalSpend = 0, totalImpressions = 0, totalClicks = 0;
            let totalConversions = 0, totalConvValue = 0;
            const daily: CampaignMetric['daily'] = [];

            cRows.forEach((row: any) => {
              const spend = Number(row?.metrics?.costMicros || 0) / 1_000_000;
              const impressions = Number(row?.metrics?.impressions || 0);
              const clicks = Number(row?.metrics?.clicks || 0);
              const conversions = Number(row?.metrics?.conversions || 0);
              const convValue = Number(row?.metrics?.conversionsValue || 0);

              totalSpend += spend;
              totalImpressions += impressions;
              totalClicks += clicks;
              totalConversions += conversions;
              totalConvValue += convValue;

              const date = row?.segments?.date;
              if (date) {
                daily.push({ date, spend, impressions, clicks, purchases: conversions, purchaseValue: convValue });
              }
            });

            daily.sort((a, b) => a.date.localeCompare(b.date));
            if (totalSpend <= 0) return;

            campaigns.push({
              platform: 'google',
              campaignId,
              campaignName: cRows[0]?.campaign?.name || campaignId,
              campaignType: cRows[0]?.campaign?.advertisingChannelType || 'SEARCH',
              status: cRows[0]?.campaign?.status || 'ENABLED',
              frequency: 0, // Google Ads does not expose frequency
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
          });
        }
      } else {
        errors.push('Google: Pipeboard API token not configured');
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
    case 'last_180d': {
      const since = new Date(now);
      since.setDate(since.getDate() - 180);
      return { since: fmt(since), until: fmt(now) };
    }
    case 'last_365d': {
      const since = new Date(now);
      since.setDate(since.getDate() - 365);
      return { since: fmt(since), until: fmt(now) };
    }
    case 'this_month': {
      const since = new Date(now.getFullYear(), now.getMonth(), 1);
      return { since: fmt(since), until: fmt(now) };
    }
    case 'last_month': {
      const since = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const until = new Date(now.getFullYear(), now.getMonth(), 0);
      return { since: fmt(since), until: fmt(until) };
    }
    default: {
      const since = new Date(now);
      since.setDate(since.getDate() - 30);
      return { since: fmt(since), until: fmt(now) };
    }
  }
}
