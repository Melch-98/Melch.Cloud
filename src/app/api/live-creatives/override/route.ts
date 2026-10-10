import { NextRequest, NextResponse } from 'next/server';
import { liveCreativeAccess } from '@/lib/live-creatives/access';
import { actorDenied, liveCreativeActor } from '@/lib/live-creatives/actor';
import { isProductKind } from '@/lib/live-creatives/landing';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

export async function PUT(request: NextRequest) {
  const auth = await liveCreativeActor(request);
  const denied = actorDenied(auth);
  if (denied) return denied;
  const { supabase, role, brandId: userBrandId } = auth as Exclude<typeof auth, { error: NextResponse }>;

  let body: {
    brandId?: string;
    adId?: string;
    clear?: boolean;
    productKey?: string;
    productLabel?: string;
    productKind?: string;
  } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const brandId = body.brandId?.trim() || '';
  const adId = body.adId?.trim() || '';
  if (!brandId || !adId) {
    return NextResponse.json({ error: 'brandId and adId are required' }, { status: 400 });
  }
  if (liveCreativeAccess(role, userBrandId, brandId) !== 'write') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const now = new Date().toISOString();
  let patch: Record<string, unknown>;
  if (body.clear) {
    patch = {
      manual_product_key: null,
      manual_product_label: null,
      manual_product_kind: null,
      product_source: 'url',
      updated_at: now,
    };
  } else {
    const productKey = body.productKey?.trim() || '';
    const productLabel = body.productLabel?.trim() || '';
    const productKind = body.productKind?.trim() || '';
    if (!productKey || !productLabel || !isProductKind(productKind) || productKey.length > 200) {
      return NextResponse.json({ error: 'productKey, productLabel, and productKind are required' }, { status: 400 });
    }
    patch = {
      manual_product_key: productKey,
      manual_product_label: productLabel,
      manual_product_kind: productKind,
      product_source: 'manual',
      updated_at: now,
    };
  }

  const { data, error } = await supabase
    .from('live_creatives')
    .update(patch)
    .eq('brand_id', brandId)
    .eq('platform', 'meta')
    .eq('ad_id', adId)
    .select('ad_id, asset_key, manual_product_key, product_source');

  if (error) {
    const missing = /live_creatives/i.test(error.message);
    return NextResponse.json(
      { error: missing ? 'live_creatives is not applied yet' : error.message },
      { status: missing ? 503 : 500 },
    );
  }
  if (!data?.length) {
    return NextResponse.json({ error: 'No live creative for this ad yet. Run the product sync first.' }, { status: 404 });
  }
  return NextResponse.json({ updated: data.length, product_source: body.clear ? 'url' : 'manual' });
}
