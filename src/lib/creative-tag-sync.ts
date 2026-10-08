import { visionImageFromBytes, visionImagesFromUnknown } from '@/lib/auto-tag/frames';
import { usageRecord } from '@/lib/auto-tag/grok';
import { getAutoTagProvider, type AutoTagImage } from '@/lib/auto-tag/provider';
import {
  buildTagPrompt,
  landingUrlForProduct,
  mediaFormatFromHint,
  normalizeAutoTag,
  storefrontOrigin,
  type CatalogProduct,
} from '@/lib/creative-auto-tag';
import { assignCreativeFileNames, type BatchNameItem } from '@/lib/creative-naming';
import { CREATIVE_TYPES_MAP } from '@/lib/creative-types';

/**
 * Loose service-role client. Callers already hold one from the Dropbox sync routes.
 * A missing column (migration not applied yet) makes this a no-op so sync still runs.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ServiceClient = any;

function missingColumn(error: { message?: string; code?: string } | null | undefined): boolean {
  if (!error) return false;
  const msg = (error.message || '').toLowerCase();
  return error.code === 'PGRST204' || msg.includes('column') || msg.includes('schema cache');
}

interface PendingFile {
  id: string;
  file_name: string;
  original_file_name: string | null;
  file_url: string;
  file_type: string | null;
  media_format: string | null;
  aspect_ratio: string | null;
  creative_type: string | null;
  fidelity: string | null;
  product_id: string | null;
  product_name: string | null;
  hook_angle: string | null;
  landing_page_url: string | null;
  creator_name: string | null;
  dropbox_path: string | null;
  dropbox_job_id: string | null;
  auto_tags: Record<string, unknown> | null;
  tag_source: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

async function loadBrand(supabase: ServiceClient, brandId: string) {
  const full = await supabase
    .from('brands')
    .select('id, name, slug, website_url, shopify_store_domain, file_naming_pattern')
    .eq('id', brandId)
    .single();
  if (!full.error && full.data) return full.data as Record<string, string | null>;
  const basic = await supabase
    .from('brands')
    .select('id, name, slug, website_url, shopify_store_domain')
    .eq('id', brandId)
    .single();
  return (basic.data || null) as Record<string, string | null> | null;
}

async function loadProducts(supabase: ServiceClient, brandId: string): Promise<CatalogProduct[]> {
  const { data } = await supabase
    .from('shopify_products')
    .select('shopify_product_id, title, handle')
    .eq('brand_id', brandId)
    .eq('status', 'active');
  return (data || [])
    .map((row: { shopify_product_id: string | number; title: string | null; handle: string | null }) => ({
      id: String(row.shopify_product_id),
      title: row.title || '',
      handle: row.handle || '',
    }))
    .filter((p: CatalogProduct) => p.id && p.title);
}

async function framesFor(supabase: ServiceClient, file: PendingFile): Promise<AutoTagImage[]> {
  const stored = visionImagesFromUnknown(file.auto_tags?.frames);
  if (stored.length) return stored;

  const mime = (file.file_type || '').toLowerCase();
  if (!mime.startsWith('image/') || !file.file_url) return [];
  const { data: blob, error } = await supabase.storage.from('creatives').download(file.file_url);
  if (error || !blob || blob.size > 1_500_000) return [];
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const image = visionImageFromBytes(blob.type || mime, bytes);
  return image ? [image] : [];
}

/**
 * Fill empty creative tags on files the uploader marked pending, then rename
 * them before Dropbox sync. Files already on their way to Dropbox are skipped.
 * A missing API key returns without writing. A model error does not stop the sync.
 */
export async function tagPendingSubmissionFiles(
  supabase: ServiceClient,
  submissionId: string
): Promise<void> {
  const provider = getAutoTagProvider();
  if (!provider.isConfigured()) return;

  const { data, error } = await supabase
    .from('submission_files')
    .select(
      `id, file_name, original_file_name, file_url, file_type, media_format, aspect_ratio,
       creative_type, fidelity, product_id, product_name, hook_angle, landing_page_url,
       creator_name, dropbox_path, dropbox_job_id, auto_tags, tag_source`
    )
    .eq('submission_id', submissionId);

  if (error || !data) {
    if (error && !missingColumn(error)) {
      console.warn('Auto-tag fallback skipped:', error.message);
    }
    return;
  }

  const files = data as PendingFile[];
  const pending = files.filter(
    (file) => file.tag_source === 'pending' && !file.dropbox_path && !file.dropbox_job_id
  );
  if (!pending.length) return;

  const { data: submission } = await supabase
    .from('submissions')
    .select('brand_id')
    .eq('id', submissionId)
    .single();
  const brandId = submission?.brand_id as string | undefined;
  if (!brandId) return;

  const brand = await loadBrand(supabase, brandId);
  if (!brand) return;
  const products = await loadProducts(supabase, brandId);
  const origin = storefrontOrigin(brand.website_url, brand.shopify_store_domain);

  const resolved = new Map<string, { nameItem: BatchNameItem; patch: Record<string, unknown> }>();

  for (const file of pending) {
    const meta = asRecord(file.auto_tags) || {};
    const nameEdited = meta.name_edited === true;
    const original = file.original_file_name || file.file_name;
    const duration = typeof meta.duration_seconds === 'number' ? meta.duration_seconds : null;
    const aspect = file.aspect_ratio || (typeof meta.aspect_ratio === 'string' ? meta.aspect_ratio : null);
    const mediaFormat =
      file.media_format || (typeof meta.media_format === 'string' ? meta.media_format : null);

    let creativeType = file.creative_type || null;
    let productId = file.product_id || null;
    let productName = file.product_name || null;
    let hook = file.hook_angle || null;
    let landing = file.landing_page_url || null;
    let autoTags: Record<string, unknown> = {
      status: 'failed',
      name_edited: nameEdited,
      error: 'No frames to tag',
    };
    let tagSource: 'fallback' | 'mixed' | 'failed' = 'failed';

    try {
      const images = await framesFor(supabase, { ...file, auto_tags: meta });
      if (images.length) {
        const format = mediaFormatFromHint(mediaFormat, file.file_type);
        const tagged = await provider.tag({
          images,
          fileLabel: original,
          prompt: buildTagPrompt({
            brandName: brand.name || 'Brand',
            storefront: origin,
            fileName: original,
            mediaFormat: format,
            aspectRatio: aspect,
            products,
          }),
        });
        const accepted = normalizeAutoTag(tagged.raw, {
          products,
          mediaFormat: format,
          storefrontOrigin: origin,
        });
        if (!creativeType && accepted.creative_type) creativeType = accepted.creative_type;
        if (!productId && accepted.product_id) {
          productId = accepted.product_id;
          productName = accepted.product_name;
        }
        if (!hook && accepted.hook_angle) hook = accepted.hook_angle;
        if (!landing && accepted.landing_page_url) landing = accepted.landing_page_url;
        if (!landing && productId) {
          const product = products.find((p) => p.id === productId);
          landing = landingUrlForProduct(origin, product?.handle) || landing;
        }
        const userHadSomething = Boolean(
          file.creative_type || file.product_id || file.hook_angle || file.landing_page_url
        );
        tagSource = userHadSomething ? 'mixed' : 'fallback';
        autoTags = {
          provider: provider.id,
          model: tagged.model,
          raw: tagged.raw,
          accepted,
          usage: usageRecord(tagged.usage),
          name_edited: nameEdited,
          tagged_at: new Date().toISOString(),
          source: 'fallback',
        };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Auto-tag failed';
      autoTags = { status: 'failed', name_edited: nameEdited, error: message.slice(0, 300) };
      tagSource = 'failed';
      console.warn(`Auto-tag fallback failed for ${file.id}:`, message.slice(0, 200));
    }

    const fidelity = creativeType ? CREATIVE_TYPES_MAP.get(creativeType)?.fidelity ?? null : null;
    resolved.set(file.id, {
      nameItem: {
        brandName: brand.name,
        brandSlug: brand.slug,
        productName,
        hookAngle: hook,
        creativeType,
        creatorName: file.creator_name,
        aspectRatio: aspect,
        durationSeconds: duration,
        mediaFormat,
        originalFileName: original,
        pattern: brand.file_naming_pattern,
        customFileName: nameEdited || tagSource === 'failed' ? file.file_name : null,
      },
      patch: {
        creative_type: creativeType,
        fidelity,
        product_id: productId,
        product_name: productName,
        hook_angle: hook,
        landing_page_url: landing,
        auto_tags: autoTags,
        tag_source: tagSource,
      },
    });
  }

  const nameInputs: BatchNameItem[] = files.map((file) => {
    const pendingItem = resolved.get(file.id);
    if (pendingItem) return pendingItem.nameItem;
    return {
      originalFileName: file.original_file_name || file.file_name,
      customFileName: file.file_name,
    };
  });
  const names = assignCreativeFileNames(nameInputs);

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const item = resolved.get(file.id);
    if (!item) continue;
    const { error: updateError } = await supabase
      .from('submission_files')
      .update({ ...item.patch, file_name: names[i] })
      .eq('id', file.id);
    if (updateError) {
      console.warn(`Auto-tag save failed for ${file.id}:`, updateError.message);
    }
  }
}
