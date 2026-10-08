import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authenticateRequest } from '@/lib/auth';
import { visionImagesFromUnknown } from '@/lib/auto-tag/frames';
import { usageRecord } from '@/lib/auto-tag/grok';
import { getAutoTagProvider } from '@/lib/auto-tag/provider';
import {
  buildTagPrompt,
  mediaFormatFromHint,
  normalizeAutoTag,
  storefrontOrigin,
  type CatalogProduct,
} from '@/lib/creative-auto-tag';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/creative-auto-tag
 * Body: { brand_id, files: [{ file_name, media_format, aspect_ratio, file_type, images: dataUrl[] }] }
 *
 * One vision call per file. Non-admins may only tag their own brand.
 * A non-admin with no brand_id is rejected.
 */

function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

interface IncomingFile {
  file_name?: string;
  media_format?: string | null;
  aspect_ratio?: string | null;
  file_type?: string | null;
  images?: unknown;
}

export async function POST(request: NextRequest) {
  const { auth, error, status } = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error }, { status: status || 401 });

  let body: { brand_id?: string; files?: IncomingFile[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const brandId = body.brand_id;
  if (!brandId) {
    return NextResponse.json({ error: 'brand_id required' }, { status: 400 });
  }

  if (auth.role !== 'admin') {
    if (!auth.brand_id || auth.brand_id !== brandId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  const files = Array.isArray(body.files) ? body.files.slice(0, 6) : [];
  if (!files.length) {
    return NextResponse.json({ error: 'files required' }, { status: 400 });
  }

  const provider = getAutoTagProvider();
  if (!provider.isConfigured()) {
    return NextResponse.json({
      results: files.map(() => ({ tags: null, skipped: 'unconfigured' })),
    });
  }

  const db = supabase();
  const { data: brand, error: brandError } = await db
    .from('brands')
    .select('id, name, website_url, shopify_store_domain')
    .eq('id', brandId)
    .single();
  if (brandError || !brand) {
    return NextResponse.json({ error: 'Brand not found' }, { status: 404 });
  }

  const { data: productRows } = await db
    .from('shopify_products')
    .select('shopify_product_id, title, handle')
    .eq('brand_id', brandId)
    .eq('status', 'active');

  const products: CatalogProduct[] = (productRows || [])
    .map((row) => ({
      id: String(row.shopify_product_id),
      title: row.title || '',
      handle: row.handle || '',
    }))
    .filter((p) => p.id && p.title);

  const origin = storefrontOrigin(brand.website_url, brand.shopify_store_domain);
  const results = [];

  for (const file of files) {
    const images = visionImagesFromUnknown(file.images);

    if (!images.length) {
      results.push({ tags: null, skipped: 'no_frames' });
      continue;
    }

    const format = mediaFormatFromHint(file.media_format, file.file_type);
    const fileLabel = file.file_name || 'creative';
    try {
      const tagged = await provider.tag({
        images,
        fileLabel,
        prompt: buildTagPrompt({
          brandName: brand.name || 'Brand',
          storefront: origin,
          fileName: fileLabel,
          mediaFormat: format,
          aspectRatio: file.aspect_ratio,
          products,
        }),
      });
      const tags = normalizeAutoTag(tagged.raw, {
        products,
        mediaFormat: format,
        storefrontOrigin: origin,
      });
      results.push({
        tags,
        auto_tags: {
          provider: provider.id,
          model: tagged.model,
          raw: tagged.raw,
          accepted: tags,
          usage: usageRecord(tagged.usage),
          tagged_at: new Date().toISOString(),
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Auto-tag failed';
      console.warn('creative-auto-tag:', message.slice(0, 200));
      results.push({ tags: null, skipped: 'failed' });
    }
  }

  return NextResponse.json({ results });
}
