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

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const FOND_SLUGS = new Set(['fond', 'fond-regenerative', 'fond-bone-broth']);

function isFondBrand(b: { slug?: string | null; name?: string | null }) {
  const slug = (b.slug || '').toLowerCase();
  const name = (b.name || '').toLowerCase();
  if (FOND_SLUGS.has(slug)) return true;
  if (name === 'fond' || name.startsWith('fond ')) return true;
  return false;
}

function aggregateOverview(submissions: TrybeSubmission[]) {
  const byStatus: Record<string, number> = {};
  const byMedia: Record<string, number> = {};
  const byDay: Record<string, { total: number; by_status: Record<string, number> }> = {};
  let withAds = 0;
  let totalAds = 0;

  for (const s of submissions) {
    const status = String(s.status || 'unknown');
    const media = String(s.media_type || 'unknown');
    byStatus[status] = (byStatus[status] || 0) + 1;
    byMedia[media] = (byMedia[media] || 0) + 1;

    const day = (s.created_at || '').slice(0, 10) || 'unknown';
    if (!byDay[day]) byDay[day] = { total: 0, by_status: {} };
    byDay[day].total += 1;
    byDay[day].by_status[status] = (byDay[day].by_status[status] || 0) + 1;

    const adsCount = s.ads?.count || 0;
    if (adsCount > 0) {
      withAds += 1;
      totalAds += adsCount;
    }
  }

  const timeline = Object.entries(byDay)
    .filter(([d]) => d !== 'unknown')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, ...v }));

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
      // Spend comes from Trybe creator-performance (not invented per-ad)
      spend: centsToDollars(p.spend_cents),
      spend_cents: p.spend_cents ?? 0,
      purchases: p.purchases ?? 0,
      purchase_value: centsToDollars(p.purchase_value_cents),
      purchase_value_cents: p.purchase_value_cents ?? 0,
      roas: p.roas ?? null,
    };
  });
}

function mapTopAds(submissions: TrybeSubmission[]) {
  return submissions
    .filter((s) => (s.ads?.count || 0) > 0)
    .map((s) => ({
      id: s.id,
      trybe_id: s.trybe_id || null,
      creator_id: s.creator?.id,
      creator_name: s.creator?.name,
      status: s.status,
      media_type: s.media_type,
      program: s.program || null,
      ads_count: s.ads?.count || 0,
      ads_first_day: s.ads?.first_day || null,
      ads_last_day: s.ads?.last_day || null,
      thumbnail_url: s.thumbnail_url || null,
      created_at: s.created_at,
      // Explicit: Trybe does not expose per-ad spend on submissions
      spend: null as number | null,
      spend_note: 'Per-ad spend not available from Trybe submissions — use creator leaderboard spend',
    }))
    .sort((a, b) => b.ads_count - a.ads_count || b.created_at.localeCompare(a.created_at));
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
    .select('id, name, slug, archived_at')
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
    const [submissions, leaderboard] = await Promise.all([
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
    ]);

    // Optional client-side program filter if API ignored program_id
    const filteredSubs = programId
      ? submissions.filter((s) => !s.program?.id || s.program.id === programId)
      : submissions;

    const payload: Record<string, unknown> = {
      configured: true,
      brand: { id: brand.id, name: brand.name, slug: brand.slug },
      trybe: {
        trybe_brand_id: meta.trybe_brand_id || null,
        trybe_program_id: programId || null,
        trybe_program_name: meta.trybe_program_name || null,
      },
      window: { start_date: startDate, end_date: endDate, days },
    };

    if (tab === 'all' || tab === 'overview') {
      payload.overview = aggregateOverview(filteredSubs);
    }
    if (wantLeaderboard) {
      payload.leaderboard = mapLeaderboard(leaderboard);
    }
    if (wantTopAds) {
      payload.top_ads = mapTopAds(filteredSubs);
    }

    return NextResponse.json(payload);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Trybe fetch failed';
    console.error('[trybe]', message);
    return NextResponse.json({ error: message, configured: true }, { status: 502 });
  }
}
