import { describe, expect, it } from 'vitest';
import { shopTodayAndL7 } from '@/lib/bfcm/calendar';
import { clampMetaRange } from '@/lib/bfcm/meta-insights';
import {
  attributedMetric,
  campaignEmptyMessage,
  campaignInsightsUrl,
  campaignsFromInsightRows,
  metaBudgetMajor,
  readCampaignMeta,
} from '@/lib/bfcm/campaigns';

describe('campaign command rows', () => {
  it('drops a spend row that has no campaign id, which is what an insights fields list without campaign_id returns', () => {
    const rows = campaignsFromInsightRows(
      [
        { spend: '313.54', campaign_name: 'CA Prospecting', impressions: '100', clicks: '4' },
        {
          campaign_id: '120249413469200762',
          campaign_name: 'CA_AOFU_CONVERSION_CBO_RG_NC_HA LAUNCH - INCREMENTAL ATTRIBUTION',
          spend: '313.54',
          impressions: '1000',
          clicks: '20',
          actions: [{ action_type: 'purchase', value: '0', '7d_click': '1' }],
          action_values: [{ action_type: 'omni_purchase', value: '0', '7d_click': '48.5' }],
        },
      ],
      {}
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].campaignId).toBe('120249413469200762');
    expect(rows[0].spend).toBe(313.54);
    expect(rows[0].purchases).toBe(1);
    expect(rows[0].purchaseValue).toBe(48.5);
    expect(rows[0].roas).toBeCloseTo(48.5 / 313.54, 5);
  });

  it('reads 7-day click purchases when the default value is zero', () => {
    expect(attributedMetric([{ action_type: 'purchase', value: '0', '7d_click': '2' }])).toBe(2);
    expect(attributedMetric([{ action_type: 'purchase', value: '4' }])).toBe(4);
    expect(attributedMetric([])).toBe(0);
  });

  it('turns Meta minor-unit budgets into major units', () => {
    expect(metaBudgetMajor('25000')).toBe(250);
    expect(metaBudgetMajor(0)).toBeNull();
    const meta = readCampaignMeta({
      '99': { objective: 'OUTCOME_SALES', effective_status: 'ACTIVE', daily_budget: '15000' },
    });
    const rows = campaignsFromInsightRows(
      [{ campaign_id: '99', campaign_name: 'Always on', spend: '12' }],
      {},
      meta
    );
    expect(rows[0].status).toBe('ACTIVE');
    expect(rows[0].budget).toBe(150);
    expect(rows[0].budgetKind).toBe('daily');
  });
});

describe('campaign insights use the ad account day', () => {
  it('asks for Los Angeles today at 1:30am Toronto, not the shop date that is still tomorrow there', () => {
    const now = new Date('2026-10-10T05:30:00Z');
    const shopToday = shopTodayAndL7(now, 'America/Toronto').today;
    const accountToday = shopTodayAndL7(now, 'America/Los_Angeles').today;
    expect(shopToday).toBe('2026-10-10');
    expect(accountToday).toBe('2026-10-09');
    expect(clampMetaRange(shopToday, shopToday, accountToday)).toBeNull();

    const url = new URL(campaignInsightsUrl('act_123', accountToday, accountToday));
    expect(url.searchParams.get('level')).toBe('campaign');
    expect(url.searchParams.get('fields')).toContain('campaign_id');
    expect(url.searchParams.get('fields')).toContain('campaign_name');
    expect(url.searchParams.get('action_attribution_windows')).toBe('["7d_click","1d_view"]');
    expect(JSON.parse(url.searchParams.get('time_range') || '{}')).toEqual({
      since: '2026-10-09',
      until: '2026-10-09',
    });
    expect(url.toString()).not.toContain('2026-10-10');
    expect(url.toString()).not.toContain('access_token');
  });
});

describe('campaign empty state', () => {
  it('surfaces a Graph error and a spend mismatch instead of a quiet morning', () => {
    expect(campaignEmptyMessage({ campaignCount: 2, accountSpend: 10, error: 'boom' })).toBeNull();
    expect(campaignEmptyMessage({ campaignCount: 0, accountSpend: 0, error: null })).toBeNull();
    expect(campaignEmptyMessage({ campaignCount: 0, accountSpend: 4, error: null })).toMatch(/no campaigns/);
    expect(campaignEmptyMessage({ campaignCount: 0, accountSpend: 4, error: '(#100) bad fields' })).toBe(
      '(#100) bad fields'
    );
  });
});
