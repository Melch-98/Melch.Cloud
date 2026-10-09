type SupabaseLike = { from: (table: string) => any };

export type DailyAdSpend = {
  google: Map<string, number>;
  meta: Map<string, number>;
  /** True only when Google returned a complete result set, including an empty one. */
  googleOk: boolean;
  /** True only when Meta returned a complete data array, including an empty one. */
  metaOk: boolean;
  errors: string[];
};

type SpendRead = {
  ok: boolean;
  byDay: Map<string, number>;
  error?: string;
};

/**
 * Meta and Google daily spend for a calendar range. Same queries the Shopify
 * Daily P&L sync uses. Dates are shop-local YYYY-MM-DD; the ad platforms bucket
 * by their own account calendars inside that range.
 *
 * googleOk / metaOk are false when that account is not configured or the fetch
 * fails. An empty successful result is ok, so the caller can write explicit 0.
 * A failed fetch must not be treated as zero spend.
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
  return {
    google: google.byDay,
    meta: meta.byDay,
    googleOk: google.ok,
    metaOk: meta.ok,
    errors,
  };
}

/** Trust the payload only when it is a results array. Zero-cost rows are omitted. */
export function readGoogleSpend(parsed: unknown): SpendRead {
  const record = parsed as { results?: unknown } | null;
  const results = Array.isArray(parsed) ? parsed : record?.results;
  if (!Array.isArray(results)) {
    return { ok: false, byDay: new Map(), error: 'Google: response had no results' };
  }
  const byDay = new Map<string, number>();
  for (const row of results) {
    const date = row?.segments?.date;
    const costMicros = Number(row?.metrics?.costMicros || 0);
    if (date && costMicros > 0) {
      const spend = costMicros / 1_000_000;
      byDay.set(date, (byDay.get(date) || 0) + spend);
    }
  }
  return { ok: true, byDay };
}

/**
 * Trust the payload only when HTTP succeeded and data is an array.
 * An error object or a following page is not a complete zero-spend result.
 */
export function readMetaSpend(httpOk: boolean, body: unknown): SpendRead {
  if (!httpOk) return { ok: false, byDay: new Map(), error: 'Meta: request failed' };
  const data = body as {
    error?: { message?: string };
    data?: unknown;
    paging?: { next?: string };
  } | null;
  if (data?.error) {
    return { ok: false, byDay: new Map(), error: `Meta: ${data.error.message || 'request failed'}` };
  }
  if (data?.paging?.next) {
    return { ok: false, byDay: new Map(), error: 'Meta: response was incomplete' };
  }
  if (!Array.isArray(data?.data)) {
    return { ok: false, byDay: new Map(), error: 'Meta: response had no data' };
  }
  const byDay = new Map<string, number>();
  for (const row of data.data) {
    if (row?.date_start) byDay.set(row.date_start, parseFloat(row.spend || '0'));
  }
  return { ok: true, byDay };
}

async function fetchGoogle(
  supabase: SupabaseLike,
  customerId: string | null | undefined,
  from: string,
  to: string,
  errors: string[]
): Promise<SpendRead> {
  const empty = (): SpendRead => ({ ok: false, byDay: new Map() });
  if (!customerId || !customerId.trim()) return empty();
  let pipeboardToken = process.env.PIPEBOARD_API_TOKEN || '';
  if (!pipeboardToken) {
    const { data: settings } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'pipeboard_api_token')
      .single();
    pipeboardToken = settings?.value || '';
  }
  if (!pipeboardToken) {
    errors.push('Google: PIPEBOARD_API_TOKEN not configured');
    return empty();
  }
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
    if (!res.ok) {
      errors.push(`Google: HTTP ${res.status}`);
      return empty();
    }
    const j = await res.json();
    const text = j?.result?.content?.[0]?.text;
    if (!text) {
      errors.push('Google: empty response');
      return empty();
    }
    const read = readGoogleSpend(JSON.parse(text));
    if (!read.ok && read.error) errors.push(read.error);
    return read;
  } catch (e: any) {
    errors.push(`Google: ${e.message}`);
    return empty();
  }
}

async function fetchMeta(
  adAccountId: string | null | undefined,
  from: string,
  to: string,
  errors: string[]
): Promise<SpendRead> {
  const empty = (): SpendRead => ({ ok: false, byDay: new Map() });
  if (!adAccountId || !adAccountId.trim()) return empty();
  const metaToken = process.env.META_ACCESS_TOKEN || '';
  if (!metaToken) {
    errors.push('Meta: META_ACCESS_TOKEN not configured');
    return empty();
  }
  try {
    const metaUrl =
      `https://graph.facebook.com/v21.0/${adAccountId}/insights?` +
      `time_range=${encodeURIComponent(JSON.stringify({ since: from, until: to }))}` +
      `&time_increment=1&fields=spend&limit=500&access_token=${metaToken}`;
    const mRes = await fetch(metaUrl);
    const mData = await mRes.json();
    const read = readMetaSpend(mRes.ok, mData);
    if (!read.ok && read.error) errors.push(read.error);
    return read;
  } catch (e: any) {
    errors.push(`Meta: ${e.message}`);
    return empty();
  }
}
