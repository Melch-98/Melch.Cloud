import { describe, expect, it } from 'vitest';
import {
  FUNNEL_ATTRIBUTION,
  FUNNEL_REFRESH_FLOOR_MS,
  META_TOKEN_MESSAGE,
  MetaGraphError,
  PURCHASE_TYPES,
  SEGMENT_UNAVAILABLE_NOTE,
  attributionParam,
  creativeHashFrom,
  gateFunnelRequest,
  imageHashFromCreative,
  loadFunnelAds,
  parseInsightsRow,
  pickAction,
  segmentBucket,
  type FunnelCache,
} from './meta-funnel';

function isolatedCache(now = () => Date.now()): FunnelCache {
  const memory = new Map<string, { value: unknown; exp: number }>();
  return {
    async get(key) {
      const hit = memory.get(key);
      if (!hit || hit.exp <= now()) return null;
      return hit.value;
    },
    async set(key, value, ttlSeconds) {
      memory.set(key, { value, exp: now() + ttlSeconds * 1000 });
    },
    async del(key) {
      memory.delete(key);
    },
  };
}

const base = {
  accountId: 'act_1',
  since: '2026-09-01',
  until: '2026-09-14',
  token: 'test-token',
  brand: { id: 'brand-1', name: 'Mintier' },
  currency: 'USD',
  timezone: 'America/New_York',
};

function insightRow(over: Record<string, unknown> = {}) {
  return {
    ad_id: 'ad-1',
    ad_name: 'Prospecting static',
    campaign_id: 'c',
    campaign_name: 'C',
    adset_id: 's',
    adset_name: 'S',
    spend: '10.00',
    impressions: '1000',
    clicks: '20',
    reach: '800',
    ...over,
  };
}

describe('funnel attribution', () => {
  it('defaults to 7-day click and does not include 1-day view', () => {
    expect(FUNNEL_ATTRIBUTION).toBe('7d_click');
    const param = attributionParam();
    expect(param).toBe('action_attribution_windows=["7d_click"]');
    expect(param).not.toContain('1d_view');
  });

  it('still switches to account or 7d_click plus 1d_view', () => {
    expect(attributionParam('account')).toBe('use_account_attribution_setting=true');
    expect(attributionParam('7d_click_1d_view')).toBe('action_attribution_windows=["7d_click","1d_view"]');
  });
});

describe('segmentBucket', () => {
  const cases: Array<[string, string]> = [
    ['', 'unknown'],
    ['unknown', 'unknown'],
    ['none', 'unknown'],
    ['n/a', 'unknown'],
    ['not_available', 'unknown'],
    ['prospecting', 'prospecting'],
    ['Prospect - Broad', 'prospecting'],
    ['new_customer', 'prospecting'],
    ['acquisition', 'prospecting'],
    ['engaged', 'engaged'],
    ['consideration', 'engaged'],
    ['existing', 'existing'],
    ['repeat', 'existing'],
    ['purchasers', 'existing'],
    ['customers', 'existing'],
    ['returning', 'existing'],
    ['retention', 'existing'],
    ['loyal', 'existing'],
    ['lookalike', 'unknown'],
  ];
  it.each(cases)('%j → %s', (raw, bucket) => {
    expect(segmentBucket(raw)).toBe(bucket);
  });
});

describe('purchase action precedence', () => {
  it('prefers pixel over omni over purchase and never sums them', () => {
    const actions = [
      { action_type: 'purchase', value: '9' },
      { action_type: 'omni_purchase', value: '4' },
      { action_type: 'offsite_conversion.fb_pixel_purchase', value: '1' },
      { action_type: 'onsite_web_purchase', value: '7' },
    ];
    expect(PURCHASE_TYPES[0]).toBe('offsite_conversion.fb_pixel_purchase');
    expect(pickAction(actions, PURCHASE_TYPES)).toEqual({ value: 1, type: 'offsite_conversion.fb_pixel_purchase' });
    const parsed = parseInsightsRow({
      spend: '10',
      impressions: '100',
      clicks: '5',
      reach: '80',
      actions,
      action_values: [
        { action_type: 'purchase', value: '90' },
        { action_type: 'omni_purchase', value: '40' },
        { action_type: 'offsite_conversion.fb_pixel_purchase', value: '12.5' },
      ],
    });
    expect(parsed.purchases).toBe(1);
    expect(parsed.revenue).toBe(12.5);
  });

  it('falls through when the earlier type is absent', () => {
    const actions = [{ action_type: 'purchase', value: '3' }];
    expect(pickAction(actions, PURCHASE_TYPES)).toEqual({ value: 3, type: 'purchase' });
  });
});

describe('creative hash', () => {
  it('uses image_hash, then link_data, then asset feed, then video, then creative, then ad', () => {
    expect(imageHashFromCreative({ image_hash: 'top', object_story_spec: { link_data: { image_hash: 'link' } } })).toBe('top');
    expect(imageHashFromCreative({ object_story_spec: { link_data: { image_hash: 'link' } }, asset_feed_spec: { images: [{ hash: 'feed' }] } })).toBe('link');
    expect(imageHashFromCreative({ asset_feed_spec: { images: [{ hash: 'feed' }] } })).toBe('feed');
    expect(creativeHashFrom({ imageHash: 'img', videoId: 'vid', creativeId: 'cr', adId: 'ad' })).toBe('img');
    expect(creativeHashFrom({ imageHash: null, videoId: 'vid', creativeId: 'cr', adId: 'ad' })).toBe('vid');
    expect(creativeHashFrom({ imageHash: null, videoId: null, creativeId: 'cr', adId: 'ad' })).toBe('cr');
    expect(creativeHashFrom({ imageHash: null, videoId: null, creativeId: null, adId: 'ad' })).toBe('ad');
  });
});

describe('null ratios', () => {
  it('returns null when the denominator is zero', () => {
    const parsed = parseInsightsRow({ spend: '0', impressions: '0', clicks: '0', reach: '0' });
    expect(parsed.ctr).toBeNull();
    expect(parsed.cpm).toBeNull();
    expect(parsed.cpc).toBeNull();
    expect(parsed.frequency).toBeNull();
    expect(parsed.roas).toBeNull();
    expect(parsed.cost_per_purchase).toBeNull();
  });
});

describe('gateFunnelRequest', () => {
  const ok = {
    hasUser: true,
    role: 'admin',
    profileBrandId: null,
    brandId: 'b1',
    brandFound: true,
    metaAccountId: 'act_1',
  };
  it('rejects a missing user, a locked founder, and a brand with no Meta account', () => {
    const missing = gateFunnelRequest({ ...ok, hasUser: false });
    const outsider = gateFunnelRequest({ ...ok, role: 'user' });
    const locked = gateFunnelRequest({ ...ok, role: 'founder', profileBrandId: 'other' });
    const strategist = gateFunnelRequest({ ...ok, role: 'strategist', profileBrandId: 'b1' });
    const empty = gateFunnelRequest({ ...ok, metaAccountId: '' });
    expect(missing.ok).toBe(false);
    expect(outsider.ok).toBe(false);
    expect(locked.ok).toBe(false);
    expect(strategist.ok).toBe(true);
    expect(empty.ok).toBe(false);
    if (!missing.ok) expect(missing.status).toBe(401);
    if (!outsider.ok) expect(outsider.status).toBe(403);
    if (!locked.ok) expect(locked.status).toBe(403);
    if (!empty.ok) {
      expect(empty.status).toBe(422);
      expect(empty.code).toBe('no_meta_account');
    }
  });
});

describe('loadFunnelAds', () => {
  function graphOk(segment: 'ok' | 'fail' = 'ok') {
    const urls: string[] = [];
    const graph = async (url: string) => {
      urls.push(url);
      if (url.includes('breakdowns=user_segment_key')) {
        if (segment === 'fail') throw new Error('segment breakdown unsupported');
        return { data: [{ ad_id: 'ad-1', spend: '10', user_segment_key: 'new' }] };
      }
      if (url.includes('/insights?')) return { data: [insightRow()] };
      if (url.includes('creative{id}')) {
        return { 'ad-1': { id: 'ad-1', name: 'Prospecting static', effective_status: 'ACTIVE', creative: { id: 'cr-1' } } };
      }
      return {
        'cr-1': {
          id: 'cr-1',
          image_hash: 'hash-1',
          thumbnail_url: 'https://cdn.example/t.jpg',
          object_story_spec: { link_data: { image_hash: 'other' } },
        },
      };
    };
    return { urls, graph };
  }

  it('requests 7-day click only on the ads route', async () => {
    const { urls, graph } = graphOk();
    const result = await loadFunnelAds({ ...base, refresh: false, now: 1_000, cache: isolatedCache(), graph, blobThumbs: async () => ({}) });
    expect(result.status).toBe(200);
    const insight = urls.find((url) => url.includes('/insights?') && !url.includes('breakdowns='));
    expect(insight).toContain('action_attribution_windows=["7d_click"]');
    expect(insight).not.toContain('1d_view');
    expect(urls.every((url) => !url.includes('1d_view'))).toBe(true);
  });

  it('can still request account attribution or 7d_click,1d_view', async () => {
    const account = graphOk();
    await loadFunnelAds({ ...base, refresh: false, now: 1_000, cache: isolatedCache(), graph: account.graph, blobThumbs: async () => ({}), attribution: 'account' });
    expect(account.urls[0]).toContain('use_account_attribution_setting=true');
    expect(account.urls[0]).not.toContain('action_attribution_windows');
    const both = graphOk();
    await loadFunnelAds({ ...base, refresh: false, now: 1_000, cache: isolatedCache(), graph: both.graph, blobThumbs: async () => ({}), attribution: '7d_click_1d_view' });
    expect(both.urls[0]).toContain('action_attribution_windows=["7d_click","1d_view"]');
  });

  it('sets segment_spend to null and a note when the segment call fails', async () => {
    const { graph } = graphOk('fail');
    const result = await loadFunnelAds({ ...base, refresh: false, now: 1_000, cache: isolatedCache(), graph, blobThumbs: async () => ({}) });
    expect(result.status).toBe(200);
    const body = result.body as { note: string; ads: Array<{ segment_spend: unknown; creative_hash: string }> };
    expect(body.note).toContain(SEGMENT_UNAVAILABLE_NOTE);
    expect(body.ads[0].segment_spend).toBeNull();
    expect(body.ads[0].creative_hash).toBe('hash-1');
  });

  it('serves a fresh cache, ignores refresh inside 120s, and re-pulls after the floor', async () => {
    let pulls = 0;
    const { graph: inner } = graphOk();
    const graph = async (url: string) => {
      if (url.includes('/insights?') && !url.includes('breakdowns=')) pulls += 1;
      return inner(url);
    };
    const cache = isolatedCache(() => Number.MAX_SAFE_INTEGER);
    const first = await loadFunnelAds({ ...base, refresh: false, now: 10_000, cache, graph, blobThumbs: async () => ({}) });
    expect(first.status).toBe(200);
    expect((first.body as { cached: boolean }).cached).toBe(false);
    expect(pulls).toBe(1);

    const second = await loadFunnelAds({ ...base, refresh: false, now: 20_000, cache, graph, blobThumbs: async () => ({}) });
    expect((second.body as { cached: boolean }).cached).toBe(true);
    expect(pulls).toBe(1);

    const early = await loadFunnelAds({ ...base, refresh: true, now: 10_000 + FUNNEL_REFRESH_FLOOR_MS - 1, cache, graph, blobThumbs: async () => ({}) });
    expect((early.body as { cached: boolean }).cached).toBe(true);
    expect(pulls).toBe(1);

    const later = await loadFunnelAds({ ...base, refresh: true, now: 10_000 + FUNNEL_REFRESH_FLOOR_MS, cache, graph, blobThumbs: async () => ({}) });
    expect((later.body as { cached: boolean }).cached).toBe(false);
    expect(pulls).toBe(2);
  });

  it('serves the last saved pull when Meta returns code 17', async () => {
    const { graph: inner } = graphOk();
    let throttle = false;
    const graph = async (url: string) => {
      if (throttle && url.includes('/insights?')) throw new MetaGraphError('User request limit reached', 17);
      return inner(url);
    };
    const cache = isolatedCache(() => Number.MAX_SAFE_INTEGER);
    await loadFunnelAds({ ...base, refresh: false, now: 10_000, cache, graph, blobThumbs: async () => ({}) });
    throttle = true;
    const result = await loadFunnelAds({ ...base, refresh: true, now: 10_000 + FUNNEL_REFRESH_FLOOR_MS, cache, graph, blobThumbs: async () => ({}) });
    expect(result.status).toBe(200);
    const body = result.body as { cached: boolean; note: string };
    expect(body.cached).toBe(true);
    expect(body.note).toContain('rate limiting');
  });

  it('returns meta_token_invalid on Meta code 190', async () => {
    const graph = async () => {
      throw new MetaGraphError('Invalid OAuth access token', 190);
    };
    const result = await loadFunnelAds({ ...base, refresh: false, now: 1_000, cache: isolatedCache(), graph, blobThumbs: async () => ({}) });
    expect(result.status).toBe(401);
    expect(result.body).toMatchObject({ code: 'meta_token_invalid', error: META_TOKEN_MESSAGE });
  });
});
