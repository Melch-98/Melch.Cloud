type SupabaseLike = { from: (table: string) => any };

export type DailyAdSpend = {
  google: Map<string, number>;
  meta: Map<string, number>;
  errors: string[];
};

/**
 * Meta and Google daily spend for a calendar range. Same queries the Shopify
 * Daily P&L sync uses. Dates are shop-local YYYY-MM-DD; the ad platforms bucket
 * by their own account calendars inside that range.
 */
export async function fetchDailyAdSpend(
  supabase: SupabaseLike,
  brand: { google_ads_customer_id?: string | null; meta_ad_account_id?: string | null },
  from: string,
  to: string
): Promise<DailyAdSpend> {
  const errors: string[] = [];
  const [google, meta] = await Promise.all([
    fetchGoogle(supabase, brand.google_ads_customer_id, from, to, errors),
    fetchMeta(brand.meta_ad_account_id, from, to, errors),
  ]);
  return { google, meta, errors };
}

async function fetchGoogle(
  supabase: SupabaseLike,
  customerId: string | null | undefined,
  from: string,
  to: string,
  errors: string[]
): Promise<Map<string, number>> {
  const dailyGoogle = new Map<string, number>();
  if (!customerId || !customerId.trim()) return dailyGoogle;
  let pipeboardToken = process.env.PIPEBOARD_API_TOKEN || '';
  if (!pipeboardToken) {
    const { data: settings } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'pipeboard_api_token')
      .single();
    pipeboardToken = settings?.value || '';
  }
  if (!pipeboardToken) return dailyGoogle;
  try {
    const custId = customerId.replace(/\D/g, '');
    const query = `SELECT segments.date, metrics.cost_micros FROM campaign WHERE segments.date BETWEEN "${from}" AND "${to}" ORDER BY segments.date`;
    const res = await fetch(`https://google-ads.mcp.pipeboard.co/?token=${encodeURIComponent(pipeboardToken)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'execute_google_ads_gaql_query', arguments: { customer_id: custId, query } },
      }),
    });
    if (!res.ok) return dailyGoogle;
    const j = await res.json();
    const text = j?.result?.content?.[0]?.text;
    if (!text) return dailyGoogle;
    const parsed = JSON.parse(text);
    const results = Array.isArray(parsed) ? parsed : parsed?.results || [];
    for (const r of results) {
      const date = r?.segments?.date;
      const costMicros = Number(r?.metrics?.costMicros || 0);
      if (date && costMicros > 0) {
        const spend = costMicros / 1_000_000;
        dailyGoogle.set(date, (dailyGoogle.get(date) || 0) + spend);
      }
    }
  } catch (e: any) {
    errors.push(`Google: ${e.message}`);
  }
  return dailyGoogle;
}

async function fetchMeta(
  adAccountId: string | null | undefined,
  from: string,
  to: string,
  errors: string[]
): Promise<Map<string, number>> {
  const dailyMeta = new Map<string, number>();
  if (!adAccountId || !adAccountId.trim()) return dailyMeta;
  const metaToken = process.env.META_ACCESS_TOKEN || '';
  if (!metaToken) return dailyMeta;
  try {
    const metaUrl =
      `https://graph.facebook.com/v21.0/${adAccountId}/insights?` +
      `time_range=${encodeURIComponent(JSON.stringify({ since: from, until: to }))}` +
      `&time_increment=1&fields=spend&limit=500&access_token=${metaToken}`;
    const mRes = await fetch(metaUrl);
    const mData = await mRes.json();
    if (mData.data && mData.data.length > 0) {
      for (const r of mData.data) {
        dailyMeta.set(r.date_start, parseFloat(r.spend || '0'));
      }
    }
  } catch (e: any) {
    errors.push(`Meta: ${e.message}`);
  }
  return dailyMeta;
}
