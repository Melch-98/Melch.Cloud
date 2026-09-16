// ─── /api/trybe ─────────────────────────────────────────────────
// Read-only Trybe Program Overview data for a Melch brand.
// Query: brand_id (required), tab=overview|leaderboard|top-ads|all
// Optional: days (default 30, max 90), program_id

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authenticateRequest } from '@/lib/auth';
import {
  centsToDollars,
  listCreatorPerformance,
  listSubmissions,
  trybeWindowStart,
  trybeYesterdayUtc,
  type TrybeSubmission,
  type TrybeCreatorPerformanceRow,
} from '@/lib/trybe-api';
import { fetchCreativeInsights, type MetaAdInsight } from '@/lib/meta-api';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const FOND_SLUGS = new Set(['fond', 'fond-regenerative', 'fond-bone-broth']);

/** Meta ad names often embed Trybe short ids as `trybe=abcdef12`. */
const TRYBE_IN_AD_NAME = /trybe[=_\-:]([a-f0-9]{8})\b/i;

function isFondBrand(b: { slug?: string | null; name?: string | null }) {
  const slug = (b.slug || '').toLowerCase();
  const name = (b.name || '').toLowerCase();
  if (FOND_SLUGS.has(slug)) return true;
  if (name === 'fond' || name.startsWith('fond ')) return true;
  return false;
}

function eachDateInclusive(start: string, end: string): string[] {
  const out: string[] = [];
  const cur = new Date(`${start}T00:00:00.000Z`);
  const last = new Date(`${end}T00:00:00.000Z`);
  if (Number.isNaN(cur.getTime()) || Number.isNaN(last.getTime())) return out;
  while (cur <= last) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

function aggregateOverview(
  submissions: TrybeSubmission[],
  windowStart: string,
  windowEnd: string,
) {
  const byStatus: Record<string, number> = {};
  const byMedia: Record<string, number> = {};
  const byDay: Record<
    string,
    { total: number; by_status: Record<string, number>; by_media: Record<string, number> }
  > = {};
  let withAds = 0;
  let totalAds = 0;

  for (const s of submissions) {
    const status = String(s.status || 'unknown');
    const media = String(s.media_type || 'unknown');
    byStatus[status] = (byStatus[status] || 0) + 1;
    byMedia[media] = (byMedia[media] || 0) + 1;

    const day = (s.created_at || '').slice(0, 10) || 'unknown';
    if (!byDay[day]) byDay[day] = { total: 0, by_status: {}, by_media: {} };
    byDay[day].total += 1;
    byDay[day].by_status[status] = (byDay[day].by_status[status] || 0) + 1;
    byDay[day].by_media[media] = (byDay[day].by_media[media] || 0) + 1;

    const adsCount = s.ads?.count || 0;
    if (adsCount > 0) {
      withAds += 1;
      totalAds += adsCount;
    }
  }

  // Prefer continuous window labels (Alysha-style 8/25…9/15). Fall back to
  // observed submission span when window is empty.
  const observed = Object.keys(byDay).filter((d) => d !== 'unknown').sort();
  const fillStart = windowStart || observed[0];
  const fillEnd = windowEnd || observed[observed.length - 1];
  const days =
    fillStart && fillEnd
      ? eachDateInclusive(fillStart, fillEnd)
      : observed;

  const timeline = days.map((date) => {
    const v = byDay[date] || { total: 0, by_status: {}, by_media: {} };
    return { date, total: v.total, by_status: v.by_status, by_media: v.by_media };
  });

  return {
    total: submissions.length,
    by_status: byStatus,
    by_media: byMedia,
    submissions_with_ads: withAds,
    total_ad_placements: totalAds,
    timeline,
  };
}

function mapLeaderboard(rows: TrybeCreatorPerformanceRow[]) {
  return rows.map((r) => {
    const p = r.performance || ({} as TrybeCreatorPerformanceRow['performance']);
    return {
      creator_id: r.creator?.id,
      creator_name: r.creator?.name,
      avatar_url: r.creator?.avatar_url || null,
      joined_at: r.creator?.joined_at || null,
      programs: r.programs || [],
      last_submission_at: r.activity?.last_submission_at || null,
      last_ad_day: r.activity?.last_ad_day || null,
      currency: p.currency || 'USD',
      earnings: centsToDollars(p.earnings_cents),
      earnings_cents: p.earnings_cents ?? 0,
      trybe_gmv: centsToDollars(p.trybe_gmv_cents),
      trybe_gmv_cents: p.trybe_gmv_cents ?? 0,
      trybe_conversions: p.trybe_conversions ?? 0,
      new_submissions: p.new_submissions ?? 0,
      active_submissions: p.active_submissions ?? 0,
      ads: p.ads ?? 0,
      spend: centsToDollars(p.spend_cents),
      spend_cents: p.spend_cents ?? 0,
      purchases: p.purchases ?? 0,
      purchase_value: centsToDollars(p.purchase_value_cents),
      purchase_value_cents: p.purchase_value_cents ?? 0,
      roas: p.roas ?? null,
    };
  });
}

function creativeDedupKey(s: TrybeSubmission): string {
  if (s.trybe_id) return `trybe:${String(s.trybe_id).toLowerCase()}`;
  // Stable path without signed query — same asset/thumb → same card
  const thumb = (s.thumbnail_url || '').split('?')[0];
  if (thumb) return `thumb:${thumb}`;
  const asset = (s.asset?.url || '').split('?')[0];
  if (asset) return `asset:${asset}`;
  return `sub:${s.id}`;
}

function formatBucket(mediaType: string | undefined | null): 'images' | 'creator_videos' | 'other_videos' {
  const m = String(mediaType || '').toLowerCase();
  if (m === 'image' || m === 'static') return 'images';
  if (m === 'video') return 'creator_videos';
  return 'other_videos';
}

function extractTrybeIdFromAdName(adName: string): string | null {
  const m = TRYBE_IN_AD_NAME.exec(adName || '');
  return m ? m[1].toLowerCase() : null;
}

function isLiveNow(lastDay: string | null | undefined, endDate: string): boolean {
  if (!lastDay) return false;
  // Live if last delivery day is within 2 days of the Trybe complete-day window end
  const last = new Date(`${lastDay}T00:00:00.000Z`).getTime();
  const end = new Date(`${endDate}T00:00:00.000Z`).getTime();
  if (Number.isNaN(last) || Number.isNaN(end)) return false;
  const diffDays = (end - last) / (24 * 60 * 60 * 1000);
  return diffDays >= 0 && diffDays <= 2;
}

type MetaAgg = {
  spend: number;
  purchases: number;
  purchase_value: number;
  impressions: number;
  clicks: number;
  video_3s_views: number;
  thruplays: number;
  video_play_25: number;
  landing_page_views: number | null;
  ad_ids: string[];
  ad_names: string[];
  campaign_count: number;
  campaigns: Set<string>;
};

function emptyMetaAgg(): MetaAgg {
  return {
    spend: 0,
    purchases: 0,
    purchase_value: 0,
    impressions: 0,
    clicks: 0,
    video_3s_views: 0,
    thruplays: 0,
    video_play_25: 0,
    landing_page_views: null,
    ad_ids: [],
    ad_names: [],
    campaign_count: 0,
    campaigns: new Set(),
  };
}

function accumulateMeta(agg: MetaAgg, row: MetaAdInsight) {
  agg.spend += row.spend || 0;
  agg.purchases += row.purchases || 0;
  agg.purchase_value += row.purchase_value || 0;
  agg.impressions += row.impressions || 0;
  agg.clicks += row.clicks || 0;
  agg.video_3s_views += row.video_3s_views || 0;
  agg.thruplays += row.thruplays || 0;
  agg.video_play_25 += row.video_play_25 || 0;
  if (row.ad_id) agg.ad_ids.push(row.ad_id);
  if (row.ad_name) agg.ad_names.push(row.ad_name);
  if (row.campaign_id) agg.campaigns.add(row.campaign_id);
}

function finalizeMetaMetrics(agg: MetaAgg | null) {
  if (!agg || (agg.ad_ids.length === 0 && agg.spend === 0 && agg.impressions === 0)) {
    return {
      meta_joined: false as const,
      spend: null as number | null,
      purchases: null as number | null,
      cost_per_purchase: null as number | null,
      impressions: null as number | null,
      cpm: null as number | null,
      first_frame_retention: null as number | null,
      thumbstop_rate: null as number | null,
      hold_rate: null as number | null,
      landing_page_views: null as number | null,
      meta_ad_ids: [] as string[],
      meta_ad_names: [] as string[],
      meta_ad_id: null as string | null,
      meta_campaign_count: 0,
      ad_name: null as string | null,
    };
  }

  const spend = agg.spend;
  const purchases = agg.purchases;
  const impressions = agg.impressions;
  const thumbViews = agg.video_3s_views > 0 ? agg.video_3s_views : agg.video_play_25;
  const holdViews = agg.thruplays > 0 ? agg.thruplays : 0;
  // 1st frame proxy: p25 watched / impressions (Meta continuous-2s not in shared fetch)
  const firstFrame =
    impressions > 0 && agg.video_play_25 > 0
      ? (agg.video_play_25 / impressions) * 100
      : null;
  const thumbstop = impressions > 0 && thumbViews > 0 ? (thumbViews / impressions) * 100 : null;
  const hold = thumbViews > 0 && holdViews > 0 ? Math.min((holdViews / thumbViews) * 100, 100) : null;

  // Prefer the longest / most descriptive ad name for the link label
  const adName =
    agg.ad_names.slice().sort((a, b) => b.length - a.length)[0] || null;

  const uniqueIds = Array.from(new Set(agg.ad_ids.filter(Boolean)));
  const uniqueNames = Array.from(new Set(agg.ad_names.filter(Boolean)));
  // Prefer ad_id paired with the chosen ad name when lengths align; else first id
  let primaryAdId: string | null = uniqueIds[0] || null;
  if (adName && agg.ad_names.length === agg.ad_ids.length) {
    const idx = agg.ad_names.findIndex((n) => n === adName);
    if (idx >= 0 && agg.ad_ids[idx]) primaryAdId = agg.ad_ids[idx];
  }

  return {
    meta_joined: true as const,
    spend,
    purchases,
    cost_per_purchase: purchases > 0 ? spend / purchases : null,
    impressions,
    cpm: impressions > 0 ? (spend / impressions) * 1000 : null,
    first_frame_retention: firstFrame,
    thumbstop_rate: thumbstop,
    hold_rate: hold,
    landing_page_views: agg.landing_page_views,
    meta_ad_ids: uniqueIds,
    meta_ad_names: uniqueNames,
    meta_ad_id: primaryAdId,
    meta_campaign_count: agg.campaigns.size,
    ad_name: adName,
  };
}


function normalizeMetaActId(accountId: string): string {
  return accountId.replace(/^act_/i, '');
}

/** Ads Manager deep link for a single Meta ad id. */
function facebookAdManagerUrl(accountId: string | null | undefined, adId: string | null | undefined): string | null {
  if (!accountId || !adId) return null;
  const act = normalizeMetaActId(accountId);
  if (!act || !adId) return null;
  return `https://adsmanager.facebook.com/adsmanager/manage/ads?act=${encodeURIComponent(act)}&selected_ad_ids=${encodeURIComponent(adId)}`;
}

async function loadMetaInsightsForBrand(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  brandId: string,
  startDate: string,
  endDate: string,
): Promise<MetaAdInsight[]> {
  const { data: brand } = await supabase
    .from('brands')
    .select('meta_ad_account_id')
    .eq('id', brandId)
    .maybeSingle();

  const accountId = (brand as { meta_ad_account_id?: string | null } | null)?.meta_ad_account_id;
  if (!accountId) return [];

  let metaToken = process.env.META_ACCESS_TOKEN || '';
  if (!metaToken) {
    const { data: settings } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'meta_access_token')
      .maybeSingle();
    metaToken = (settings as { value?: string } | null)?.value || '';
  }
  if (!metaToken) return [];

  try {
    // skipMedia: insights-only — fast enough for Trybe join; we keep Trybe thumbnails
    return await fetchCreativeInsights(metaToken, accountId, startDate, endDate, 250, true);
  } catch (e) {
    console.warn('[trybe] Meta join skipped:', e instanceof Error ? e.message : e);
    return [];
  }
}

function buildMetaByTrybeId(insights: MetaAdInsight[]): Map<string, MetaAgg> {
  const map = new Map<string, MetaAgg>();
  for (const row of insights) {
    const tid = extractTrybeIdFromAdName(row.ad_name || '');
    if (!tid) continue;
    let agg = map.get(tid);
    if (!agg) {
      agg = emptyMetaAgg();
      map.set(tid, agg);
    }
    accumulateMeta(agg, row);
  }
  Array.from(map.values()).forEach((agg) => {
    agg.campaign_count = agg.campaigns.size;
  });
  return map;
}

/**
 * Top ads = one card per creative (Trybe trybe_id / asset fingerprint),
 * not one card per submission×campaign placement.
 * Meta spend/metrics joined when ad_name contains trybe=<id>.
 */
function mapTopAds(
  submissions: TrybeSubmission[],
  metaByTrybe: Map<string, MetaAgg>,
  endDate: string,
  metaAdAccountId: string | null,
) {
  type Acc = {
    key: string;
    trybe_id: string | null;
    submission_ids: string[];
    creator_id: string | undefined;
    creator_name: string;
    status: string;
    media_type: string;
    format: 'images' | 'creator_videos' | 'other_videos';
    program: TrybeSubmission['program'];
    placements: number;
    ads_first_day: string | null;
    ads_last_day: string | null;
    thumbnail_url: string | null;
    created_at: string;
    asset_url: string | null;
  };

  const byKey = new Map<string, Acc>();

  for (const s of submissions) {
    const placements = s.ads?.count || 0;
    if (placements <= 0) continue;

    const key = creativeDedupKey(s);
    const existing = byKey.get(key);
    const first = s.ads?.first_day || null;
    const last = s.ads?.last_day || null;

    if (!existing) {
      byKey.set(key, {
        key,
        trybe_id: s.trybe_id ? String(s.trybe_id).toLowerCase() : null,
        submission_ids: [s.id],
        creator_id: s.creator?.id,
        creator_name: s.creator?.name || 'Unknown',
        status: String(s.status || 'unknown'),
        media_type: String(s.media_type || 'unknown'),
        format: formatBucket(s.media_type),
        program: s.program || null,
        placements,
        ads_first_day: first,
        ads_last_day: last,
        thumbnail_url: s.thumbnail_url || null,
        created_at: s.created_at,
        asset_url: s.asset?.url || null,
      });
      continue;
    }

    existing.submission_ids.push(s.id);
    // Sum placement counts carefully: same creative listed twice shouldn't
    // double-count if it's the same submission; distinct submissions share key only via trybe_id.
    if (!existing.submission_ids.slice(0, -1).includes(s.id)) {
      existing.placements += placements;
    }
    if (first && (!existing.ads_first_day || first < existing.ads_first_day)) {
      existing.ads_first_day = first;
    }
    if (last && (!existing.ads_last_day || last > existing.ads_last_day)) {
      existing.ads_last_day = last;
    }
    if (!existing.thumbnail_url && s.thumbnail_url) existing.thumbnail_url = s.thumbnail_url;
    if (s.created_at < existing.created_at) existing.created_at = s.created_at;
    if (s.status === 'approved') existing.status = 'approved';
  }

  const rows = Array.from(byKey.values()).map((acc) => {
    const tid = acc.trybe_id;
    const metaAgg = tid ? metaByTrybe.get(tid) || null : null;
    const metrics = finalizeMetaMetrics(metaAgg);
    const live = isLiveNow(acc.ads_last_day, endDate);

    return {
      id: acc.key,
      trybe_id: acc.trybe_id,
      submission_ids: acc.submission_ids,
      creator_id: acc.creator_id,
      creator_name: acc.creator_name,
      status: acc.status,
      media_type: acc.media_type,
      format: acc.format,
      program: acc.program,
      // placements = Trybe ads.count summed across deduped submissions (campaign copies)
      placements: acc.placements,
      ads_first_day: acc.ads_first_day,
      ads_last_day: acc.ads_last_day,
      launched_at: acc.ads_first_day,
      live,
      thumbnail_url: acc.thumbnail_url,
      created_at: acc.created_at,
      asset_url: acc.asset_url,
      ...metrics,
      facebook_ad_url: facebookAdManagerUrl(
        metaAdAccountId,
        (metrics as { meta_ad_id?: string | null }).meta_ad_id || null,
      ),
      spend_note: metrics.meta_joined
        ? null
        : 'Spend n/a until Meta join (ad name must include trybe=<id>)',
    };
  });

  // Sort: Meta-joined spend desc, then placements, then recency
  rows.sort((a, b) => {
    const as = a.spend ?? -1;
    const bs = b.spend ?? -1;
    if (bs !== as) return bs - as;
    if (b.placements !== a.placements) return b.placements - a.placements;
    return (b.ads_last_day || '').localeCompare(a.ads_last_day || '');
  });

  return rows;
}

export async function GET(request: NextRequest) {
  const { auth, error, status } = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error }, { status: status || 401 });

  if (!['admin', 'strategist', 'founder'].includes(auth.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const brandId = searchParams.get('brand_id');
  const tab = (searchParams.get('tab') || 'all') as
    | 'overview'
    | 'leaderboard'
    | 'top-ads'
    | 'all';
  const days = Math.min(Math.max(parseInt(searchParams.get('days') || '30', 10) || 30, 1), 90);
  const programIdOverride = searchParams.get('program_id') || undefined;

  if (!brandId) {
    return NextResponse.json({ error: 'brand_id required' }, { status: 400 });
  }

  if (auth.role !== 'admin' && auth.brand_id && auth.brand_id !== brandId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: brand, error: brandErr } = await supabase
    .from('brands')
    .select('id, name, slug, archived_at, meta_ad_account_id')
    .eq('id', brandId)
    .maybeSingle();

  if (brandErr) return NextResponse.json({ error: brandErr.message }, { status: 500 });
  if (!brand) return NextResponse.json({ error: 'Brand not found' }, { status: 404 });
  if (brand.archived_at) {
    return NextResponse.json({ error: 'Brand is archived' }, { status: 400 });
  }
  if (isFondBrand(brand)) {
    return NextResponse.json({ error: 'FOND is excluded from Trybe Program Overview' }, { status: 400 });
  }

  const { data: integration, error: intErr } = await supabase
    .from('brand_integrations')
    .select('api_key, metadata, label, updated_at')
    .eq('brand_id', brandId)
    .eq('provider', 'trybe')
    .maybeSingle();

  if (intErr) {
    if (intErr.message.includes('brand_integrations')) {
      return NextResponse.json({
        error: 'brand_integrations table missing — run create_brand_integrations.sql',
        configured: false,
      }, { status: 503 });
    }
    return NextResponse.json({ error: intErr.message }, { status: 500 });
  }

  if (!integration?.api_key) {
    return NextResponse.json({
      configured: false,
      brand: { id: brand.id, name: brand.name, slug: brand.slug },
      error: 'Trybe API key not configured for this brand. Add it under Team → brand settings.',
    }, { status: 404 });
  }

  const meta = (integration.metadata || {}) as Record<string, string | null | undefined>;
  const programId = programIdOverride || meta.trybe_program_id || undefined;
  const endDate = trybeYesterdayUtc();
  const startDate = trybeWindowStart(endDate, days);

  const wantOverview = tab === 'all' || tab === 'overview' || tab === 'top-ads';
  const wantLeaderboard = tab === 'all' || tab === 'leaderboard';
  const wantTopAds = tab === 'all' || tab === 'top-ads';

  try {
    const [submissions, leaderboard, metaInsights] = await Promise.all([
      wantOverview
        ? listSubmissions(integration.api_key, {
            program_id: programId,
            maxPages: 20,
          })
        : Promise.resolve([] as TrybeSubmission[]),
      wantLeaderboard
        ? listCreatorPerformance(integration.api_key, {
            start_date: startDate,
            end_date: endDate,
            sort_by: 'spend',
            active_only: true,
          })
        : Promise.resolve([] as TrybeCreatorPerformanceRow[]),
      wantTopAds
        ? loadMetaInsightsForBrand(supabase, brandId, startDate, endDate)
        : Promise.resolve([] as MetaAdInsight[]),
    ]);

    const filteredSubs = programId
      ? submissions.filter((s) => !s.program?.id || s.program.id === programId)
      : submissions;

    const metaByTrybe = buildMetaByTrybeId(metaInsights);
    // Filter overview timeline to selected window (submissions API is unscoped by date)
    const windowedSubs = filteredSubs.filter((s) => {
      const d = (s.created_at || '').slice(0, 10);
      return d >= startDate && d <= endDate;
    });

    const payload: Record<string, unknown> = {
      configured: true,
      brand: { id: brand.id, name: brand.name, slug: brand.slug },
      trybe: {
        trybe_brand_id: meta.trybe_brand_id || null,
        trybe_program_id: programId || null,
        trybe_program_name: meta.trybe_program_name || null,
      },
      window: { start_date: startDate, end_date: endDate, days },
      meta_join: {
        insights_fetched: metaInsights.length,
        trybe_ids_matched: metaByTrybe.size,
      },
    };

    if (tab === 'all' || tab === 'overview') {
      // Use windowed for volume chart; keep full totals from filteredSubs for status cards
      // so Nick still sees pipeline outside the day window if needed — prefer windowed for clarity
      payload.overview = aggregateOverview(windowedSubs.length ? windowedSubs : filteredSubs, startDate, endDate);
      if (windowedSubs.length) {
        (payload.overview as { total_all_pulled?: number }).total_all_pulled = filteredSubs.length;
      }
    }
    if (wantLeaderboard) {
      payload.leaderboard = mapLeaderboard(leaderboard);
    }
    if (wantTopAds) {
      payload.top_ads = mapTopAds(
        filteredSubs,
        metaByTrybe,
        endDate,
        (brand as { meta_ad_account_id?: string | null }).meta_ad_account_id || null,
      );
    }

    return NextResponse.json(payload);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Trybe fetch failed';
    console.error('[trybe]', message);
    return NextResponse.json({ error: message, configured: true }, { status: 502 });
  }
}
