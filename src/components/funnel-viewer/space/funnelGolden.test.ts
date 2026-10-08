/*
 * Golden placements for the ported funnel classifier and layout.
 * Lane expectations are calculated from the classifier in funnelPosition.ts
 * (share rules, saturation percentile ranks, engaged median). Layout
 * coordinates are frozen from layoutFunnel for this fixture.
 *
 * MIT License — Copyright (c) 2026 Odylic Media.
 * See src/components/funnel-viewer/LICENSE.
 */
import { describe, expect, it } from 'vitest';
import type { Ad } from '../lib/api';
import { classifyFunnelPositions } from './funnelPosition';
import { FIELD_FUNNEL, buildFieldCatalog, buildNamingIndex, groupByField, layoutFunnel, type SpaceNodeInput } from './spaceLayout';

function ad(over: Partial<Ad> & Pick<Ad, 'ad_id' | 'spend'>): Ad {
  return {
    ad_name: over.ad_id,
    adset_id: 's',
    adset_name: 'S',
    campaign_id: 'c',
    campaign_name: 'C',
    effective_status: 'ACTIVE',
    created_time: null,
    creative_id: over.ad_id,
    creative_hash: over.ad_id,
    image_hash: null,
    video_id: null,
    is_video: false,
    thumbnail_url: '',
    image_url: '',
    title: null,
    body: null,
    call_to_action_type: null,
    account_id: 'act_1',
    effective_object_story_id: null,
    instagram_permalink_url: null,
    ads_manager_url: null,
    impressions: 0,
    clicks: 0,
    ctr: null,
    cpm: null,
    cpc: null,
    reach: 0,
    frequency: null,
    purchases: 0,
    revenue: 0,
    roas: null,
    cost_per_purchase: null,
    link_clicks: 0,
    outbound_clicks: 0,
    landing_page_views: 0,
    add_to_cart: 0,
    initiate_checkout: 0,
    leads: 0,
    video_3s_views: 0,
    thruplays: 0,
    video_p25: 0,
    video_p50: 0,
    video_p75: 0,
    video_p100: 0,
    post_reactions: 0,
    post_comments: 0,
    post_shares: 0,
    segment_spend: null,
    ...over,
  };
}

const FIXTURE: Ad[] = [
  ad({
    ad_id: 'A', spend: 100, frequency: 1, reach: 1000, impressions: 1000,
    segment_spend: { prospecting: 100, engaged: 0, existing: 0, unknown: 0 },
  }),
  ad({
    ad_id: 'B', spend: 50, frequency: 2, reach: 500, impressions: 1000,
    segment_spend: { prospecting: 0, engaged: 50, existing: 0, unknown: 0 },
  }),
  ad({
    ad_id: 'C', spend: 50, frequency: 10, reach: 100, impressions: 1000,
    segment_spend: { prospecting: 0, engaged: 50, existing: 0, unknown: 0 },
  }),
  ad({
    ad_id: 'D', spend: 40, frequency: 3, reach: 400, impressions: 1200,
    segment_spend: { prospecting: 0, engaged: 0, existing: 40, unknown: 0 },
  }),
  ad({
    ad_id: 'E', spend: 20, frequency: 1.5, reach: 200, impressions: 300,
    segment_spend: null,
  }),
  ad({ ad_id: 'F', spend: 0, frequency: 4, reach: 10, impressions: 40 }),
];

describe('funnel golden fixture', () => {
  const placed = classifyFunnelPositions(FIXTURE);

  it('assigns lanes, estimated flags, and leaves zero-spend ads unplaced', () => {
    expect(placed.get('A')).toMatchObject({ lane: 'TOF', estimated: false });
    expect(placed.get('B')).toMatchObject({ lane: 'MOF', estimated: false });
    expect(placed.get('C')).toMatchObject({ lane: 'BOF', estimated: false });
    expect(placed.get('D')).toMatchObject({ lane: 'REACT', estimated: false });
    expect(placed.get('E')).toMatchObject({ lane: 'MOF', estimated: true });
    expect(placed.has('F')).toBe(false);
  });

  it('matches the hand-calculated saturation scores', () => {
    const sat = (id: string) => {
      const p = placed.get(id)!;
      return { freq: p.freq, cpmr: p.cpmr, fatigued: p.fatigued };
    };
    expect(sat('A')).toEqual({ freq: 1, cpmr: 100, fatigued: false });
    expect(sat('B')).toEqual({ freq: 2, cpmr: 100, fatigued: false });
    expect(sat('C')).toEqual({ freq: 10, cpmr: 500, fatigued: true });
    expect(sat('D')).toEqual({ freq: 3, cpmr: 100, fatigued: true });
    expect(sat('E')).toEqual({ freq: 1.5, cpmr: 100, fatigued: false });
  });

  it('lays the lanes out to 1e-6', () => {
    const nodes: SpaceNodeInput[] = FIXTURE.map((row) => ({
      id: row.ad_id,
      ad: row,
      size: 48,
    }));
    const field = buildFieldCatalog(buildNamingIndex(FIXTURE)).find((item) => item.key === FIELD_FUNNEL)!;
    const grouped = groupByField(nodes, field, { funnel: placed });
    const layout = layoutFunnel(nodes, grouped.clusters, grouped.hidden, placed);
    const point = (id: string) => layout.targets.get(id)!;
    const expectNear = (id: string, x: number, y: number, z: number) => {
      const p = point(id);
      expect(p.x).toBeCloseTo(x, 6);
      expect(p.y).toBeCloseTo(y, 6);
      expect(p.z).toBeCloseTo(z, 6);
    };
    expect(layout.dashed.has('E')).toBe(true);
    expect(layout.dashed.has('A')).toBe(false);
    expect(grouped.hidden.has('F')).toBe(true);
    expect(layout.targets.has('F')).toBe(false);
    expectNear('A', 318.394512, -266.589877, -1.614443);
    expectNear('B', 114.829343, -102.128875, -143.64647);
    expectNear('C', -80.585519, 57.616752, 32.358515);
    expectNear('D', 8.569992, 228.42312, -54.621785);
    expectNear('E', -142.45123, -104.751755, 116.308785);
  });
});
