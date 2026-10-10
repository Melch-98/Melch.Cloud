import { insightUrl, stripAccessToken } from '@/lib/bfcm/meta-insights';

const PURCHASE_TYPES = ['purchase', 'omni_purchase', 'offsite_conversion.fb_pixel_purchase'];

export interface CampaignInsightRow {
  campaign_id?: string | number | null;
  campaign_name?: string | null;
  spend?: string | number | null;
  impressions?: string | number | null;
  clicks?: string | number | null;
  actions?: unknown;
  action_values?: unknown;
}

export interface CampaignMetaInfo {
  objective: string;
  status: string;
  dailyBudget: number | null;
  lifetimeBudget: number | null;
}

export interface CampaignCommandRow {
  campaignId: string;
  campaignName: string;
  objective: string;
  status: string;
  spend: number;
  budget: number | null;
  budgetKind: 'daily' | 'lifetime' | null;
  impressions: number;
  clicks: number;
  ctr: number;
  cpm: number;
  cpc: number;
  purchases: number;
  purchaseValue: number;
  roas: number;
  cpa: number;
  l7DailySpend: number;
  l7Roas: number;
  spendPaceVsL7: number;
  roasDeltaVsL7: number;
}

/**
 * Campaign insights for one account-local day.
 * `fields` replaces Meta's defaults, so campaign_id has to be named or every
 * row is dropped and the table looks empty while account hourly spend is not.
 */
export function campaignInsightsQuery(since: string, until: string): string {
  const timeRange = encodeURIComponent(JSON.stringify({ since, until }));
  const attribution = encodeURIComponent('["7d_click","1d_view"]');
  return [
    'level=campaign',
    `time_range=${timeRange}`,
    'fields=campaign_id,campaign_name,spend,impressions,clicks,actions,action_values',
    `action_attribution_windows=${attribution}`,
    'limit=500',
  ].join('&');
}

export function campaignInsightsUrl(adAccountId: string, since: string, until: string): string {
  return stripAccessToken(insightUrl(adAccountId, campaignInsightsQuery(since, until)));
}

/** Prefer the 7-day click window we requested. `value` is 0 on incremental-attribution accounts. */
export function attributedMetric(actions: unknown, windows: string[] = ['7d_click']): number {
  if (!Array.isArray(actions)) return 0;
  for (const type of PURCHASE_TYPES) {
    const found = actions.find((action) => {
      return action && typeof action === 'object' && (action as { action_type?: string }).action_type === type;
    }) as Record<string, unknown> | undefined;
    if (!found) continue;
    for (const window of windows) {
      if (found[window] != null && found[window] !== '') {
        const parsed = Number(found[window]);
        if (Number.isFinite(parsed)) return parsed;
      }
    }
    const value = Number(found.value);
    if (Number.isFinite(value)) return value;
  }
  return 0;
}

/** Meta campaign budgets are minor units (cents for CAD and USD). */
export function metaBudgetMajor(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed) / 100;
}

export function readCampaignMeta(json: unknown): Record<string, CampaignMetaInfo> {
  const meta: Record<string, CampaignMetaInfo> = {};
  if (!json || typeof json !== 'object') return meta;
  for (const [id, info] of Object.entries(json as Record<string, unknown>)) {
    if (!info || typeof info !== 'object') continue;
    const record = info as {
      objective?: string;
      effective_status?: string;
      daily_budget?: unknown;
      lifetime_budget?: unknown;
    };
    meta[id] = {
      objective: record.objective || 'UNKNOWN',
      status: record.effective_status || 'UNKNOWN',
      dailyBudget: metaBudgetMajor(record.daily_budget),
      lifetimeBudget: metaBudgetMajor(record.lifetime_budget),
    };
  }
  return meta;
}

function ratio(spend: number, value: number): number {
  return spend > 0 ? value / spend : 0;
}

/**
 * Keep every campaign row that has an id and spend.
 * Rows that omit campaign_id are not campaigns — listing them would invent names,
 * and dropping them without an error used to show "No campaign spend today yet."
 */
export function campaignsFromInsightRows(
  rows: CampaignInsightRow[],
  l7: Record<string, { spend: number; purchaseValue: number }>,
  meta: Record<string, CampaignMetaInfo> = {}
): CampaignCommandRow[] {
  const campaigns: CampaignCommandRow[] = [];
  for (const row of rows) {
    if (row.campaign_id == null || row.campaign_id === '') continue;
    const spend = Number(row.spend || 0);
    if (!Number.isFinite(spend) || spend <= 0) continue;
    const id = String(row.campaign_id);
    const purchases = attributedMetric(row.actions);
    const purchaseValue = attributedMetric(row.action_values);
    const impressions = Number.parseInt(String(row.impressions || '0'), 10) || 0;
    const clicks = Number.parseInt(String(row.clicks || '0'), 10) || 0;
    const prior = l7[id] || { spend: 0, purchaseValue: 0 };
    const l7DailySpend = prior.spend / 7;
    const l7Roas = ratio(prior.spend, prior.purchaseValue);
    const info = meta[id] || {
      objective: 'UNKNOWN',
      status: 'UNKNOWN',
      dailyBudget: null,
      lifetimeBudget: null,
    };
    const roas = ratio(spend, purchaseValue);
    let budgetKind: 'daily' | 'lifetime' | null = null;
    if (info.dailyBudget != null) budgetKind = 'daily';
    else if (info.lifetimeBudget != null) budgetKind = 'lifetime';
    campaigns.push({
      campaignId: id,
      campaignName: row.campaign_name || id,
      objective: info.objective,
      status: info.status,
      spend,
      budget: info.dailyBudget ?? info.lifetimeBudget,
      budgetKind,
      impressions,
      clicks,
      ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
      cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
      cpc: clicks > 0 ? spend / clicks : 0,
      purchases,
      purchaseValue,
      roas,
      cpa: purchases > 0 ? spend / purchases : 0,
      l7DailySpend,
      l7Roas,
      spendPaceVsL7: l7DailySpend > 0 ? spend / l7DailySpend : 0,
      roasDeltaVsL7: prior.spend > 0 ? roas - l7Roas : 0,
    });
  }
  campaigns.sort((a, b) => b.spend - a.spend);
  return campaigns;
}

/** Empty table copy. A Graph error or a spend mismatch must not look like a quiet morning. */
export function campaignEmptyMessage(input: {
  campaignCount: number;
  accountSpend: number;
  error: string | null;
}): string | null {
  if (input.campaignCount > 0) return null;
  if (input.error) return input.error;
  if (input.accountSpend > 0) {
    return 'Meta spend is above zero for this account day, but campaign insights returned no campaigns.';
  }
  return null;
}
