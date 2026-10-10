import { NextRequest, NextResponse } from 'next/server';
import { liveCreativeAccess } from '@/lib/live-creatives/access';
import { actorDenied, liveCreativeActor } from '@/lib/live-creatives/actor';
import { effectiveProduct } from '@/lib/live-creatives/merge';
import { overrideChoices } from '@/lib/live-creatives/present';

export const dynamic = 'force-dynamic';

const ROW_COLUMNS = [
  'ad_id', 'asset_key', 'creative_id', 'format', 'landing_url', 'landing_url_normalized',
  'product_key', 'product_label', 'product_kind', 'ad_name', 'asset_name', 'thumbnail_url',
  'product_source', 'manual_product_key', 'manual_product_label', 'manual_product_kind',
  'card_products', 'first_seen', 'last_active',
].join(', ');

export async function GET(request: NextRequest) {
  const auth = await liveCreativeActor(request);
  const denied = actorDenied(auth);
  if (denied) return denied;
  const { supabase, role, brandId: userBrandId } = auth as Exclude<typeof auth, { error: NextResponse }>;
  const brandId = request.nextUrl.searchParams.get('brandId') || '';
  if (!brandId) return NextResponse.json({ error: 'brandId required' }, { status: 400 });
  const access = liveCreativeAccess(role, userBrandId, brandId);
  if (access === 'none') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const [{ data, error }, productsResult] = await Promise.all([
    supabase
      .from('live_creatives')
      .select(ROW_COLUMNS)
      .eq('brand_id', brandId)
      .eq('platform', 'meta')
      .order('ad_name', { ascending: true }),
    supabase.from('shopify_products').select('handle, title').eq('brand_id', brandId),
  ]);

  if (error) {
    const missing = /live_creatives/i.test(error.message);
    return NextResponse.json(
      { error: missing ? 'live_creatives is not applied yet' : error.message },
      { status: missing ? 503 : 500 },
    );
  }

  const rows = (data || []).map((row: {
    ad_id: string;
    asset_key: string;
    creative_id: string | null;
    format: string | null;
    landing_url: string | null;
    landing_url_normalized: string | null;
    ad_name: string | null;
    asset_name: string | null;
    thumbnail_url: string | null;
    first_seen: string | null;
    last_active: string | null;
    card_products: unknown;
    product_key: string | null;
    product_label: string | null;
    product_kind: string | null;
    manual_product_key: string | null;
    manual_product_label: string | null;
    manual_product_kind: string | null;
    product_source: string | null;
  }) => {
    const product = effectiveProduct(row);
    return {
      ad_id: row.ad_id,
      asset_key: row.asset_key,
      creative_id: row.creative_id,
      format: row.format,
      landing_url: row.landing_url,
      landing_url_normalized: row.landing_url_normalized,
      ad_name: row.ad_name,
      asset_name: row.asset_name,
      thumbnail_url: row.thumbnail_url,
      first_seen: row.first_seen,
      last_active: row.last_active,
      card_products: row.card_products,
      ...product,
    };
  });

  return NextResponse.json({
    rows,
    choices: overrideChoices(productsResult.data || []),
    access,
  });
}
