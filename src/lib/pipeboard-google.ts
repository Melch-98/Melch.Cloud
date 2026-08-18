// ─── Pipeboard Google MCP — direct Google Ads reporting (post-Windsor) ───
// Windsor.ai was cancelled Aug 2026. This is the replacement: a plain HTTP
// JSON-RPC endpoint that hits the Google Ads API directly by customer_id.
// It covers every brand (including Mintier, which has no shopify_store_domain),
// unlike Triple Whale's ads_table which is keyed off the Shopify domain.
//
// Endpoint + token: https://google-ads.mcp.pipeboard.co/?token=<PIPEBOARD_API_TOKEN>
// Tool list: 62 tools incl. get_google_ads_campaign_metrics, get_google_ads_campaigns,
//   execute_google_ads_gaql_query, list_google_ads_customers.

const PIPEBOARD_ENDPOINT = 'https://google-ads.mcp.pipeboard.co/';

// Google Ads customer IDs are digits-only. The brands table stores some with
// dashes (e.g. Mintier `507-622-0091`), which Pipeboard rejects. Normalize to
// digits-only so every brand resolves correctly.
export function normalizeCustomerId(id: string | null | undefined): string {
  if (!id) return '';
  return id.replace(/\D/g, '');
}

// Raw JSON-RPC call. Result text is a JSON string nested at result.content[0].text.
async function rpc(token: string, tool: string, args: Record<string, unknown>): Promise<any> {
  const url = `${PIPEBOARD_ENDPOINT}?token=${encodeURIComponent(token)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } }),
  });
  if (!res.ok) throw new Error(`Pipeboard ${tool}: HTTP ${res.status}`);
  const j = (await res.json()) as any;
  const text = j?.result?.content?.[0]?.text;
  if (!text) throw new Error(`Pipeboard ${tool}: no result`);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export interface GoogleCampaignMetrics {
  campaign_id: string;
  campaign_name: string;
  campaign_status: string;
  campaign_type: string;
  cost: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversions_value: number;
  ctr: number;
  average_cpc: number;
  cost_micros?: string;
}

export interface GoogleCampaignMetricsResponse {
  customer_id: string;
  date_range: string;
  total_campaigns: number;
  aggregate_metrics?: {
    impressions: number;
    clicks: number;
    cost: number;
    conversions: number;
    conversions_value: number;
    average_ctr: number;
    average_cpc: number;
  };
  campaigns: GoogleCampaignMetrics[];
}

// Campaign-level metrics over a preset date range (TODAY, YESTERDAY, LAST_7_DAYS, etc.)
export async function getCampaignMetrics(
  token: string,
  customerId: string,
  dateRange: string = 'LAST_7_DAYS'
): Promise<GoogleCampaignMetricsResponse> {
  return rpc(token, 'get_google_ads_campaign_metrics', {
    customer_id: normalizeCustomerId(customerId),
    date_range: dateRange,
    status_filter: 'ALL',
  });
}

export interface GoogleCampaign {
  campaign_id: string;
  campaign_name: string;
  campaign_status: string;
  campaign_type: string;
  [key: string]: any;
}

// Campaign list + status (for changelog diffing).
export async function getCampaigns(token: string, customerId: string): Promise<GoogleCampaign[]> {
  const data = await rpc(token, 'get_google_ads_campaigns', {
    customer_id: normalizeCustomerId(customerId),
  });
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.campaigns)) return data.campaigns;
  return [];
}

// Arbitrary GAQL query (daily spend per date, etc.).
export async function gaqlQuery(token: string, customerId: string, query: string): Promise<any[]> {
  const data = await rpc(token, 'execute_google_ads_gaql_query', {
    customer_id: normalizeCustomerId(customerId),
    query,
  });
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.results)) return data.results;
  return [];
}

// Resolve the Pipeboard token from env, falling back to app_settings (same
// pattern as the old Windsor/meta token lookups).
export async function resolvePipeboardToken(
  envToken: string | undefined,
  readSetting: (key: string) => Promise<string | null>
): Promise<string> {
  if (envToken) return envToken;
  return (await readSetting('pipeboard_api_token')) || '';
}
