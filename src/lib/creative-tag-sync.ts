import { visionImageFromBytes, visionImagesFromUnknown } from '@/lib/auto-tag/frames';
import { usageRecord } from '@/lib/auto-tag/grok';
import { getAutoTagProvider, type AutoTagImage, type AutoTagProvider } from '@/lib/auto-tag/provider';
import {
  buildFileTagPrompt,
  buildSharedTagPrompt,
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

/** One vision batch must not eat the Dropbox sync. */
export const TAG_SYNC_MAX_BUDGET_MS = 45_000;
export const TAG_SYNC_CALL_TIMEOUT_MS = 20_000;
export const TAG_SYNC_CONCURRENCY = 4;
/** Leave the cron enough time to copy files for other brands after tagging. */
export const TAG_SYNC_CRON_RESERVE_MS = 60_000;

const FILE_COLUMNS = `id, file_name, original_file_name, file_url, file_type, media_format, aspect_ratio,
  creative_type, fidelity, product_id, product_name, hook_angle, landing_page_url,
  creator_name, dropbox_path, dropbox_job_id, auto_tags, tag_source, submission_id`;

export interface TagPendingOptions {
  /** How long this call may spend. 0 skips without claiming rows. */
  budgetMs?: number;
  provider?: AutoTagProvider;
  now?: () => number;
}

/**
 * Budget for a cron batch: at most 45s, and at least 60s before the cron deadline.
 */
export function tagSyncBudgetMs(deadlineMs?: number, now = Date.now()): number {
  if (deadlineMs === undefined) return TAG_SYNC_MAX_BUDGET_MS;
  return Math.max(0, Math.min(TAG_SYNC_MAX_BUDGET_MS, deadlineMs - now - TAG_SYNC_CRON_RESERVE_MS));
}

function missingColumn(error: { message?: string; code?: string } | null | undefined): boolean {
  if (!error) return false;
  const msg = (error.message || '').toLowerCase();
  return error.code === 'PGRST204' || msg.includes('column') || msg.includes('schema cache');
}

interface PendingFile {
  id: string;
  submission_id?: string;
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

interface NameOutcome {
  keepName: boolean;
  nameItem?: BatchNameItem;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function withoutFrames(meta: Record<string, unknown>, extra: Record<string, unknown>): Record<string, unknown> {
  const next = { ...meta, ...extra };
  delete next.frames;
  return next;
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

async function saveFile(supabase: ServiceClient, id: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.from('submission_files').update(patch).eq('id', id);
  if (error) console.warn(`Auto-tag save failed for ${id}:`, error.message);
}

/**
 * Fill empty creative tags on files the uploader marked pending, then rename
 * them before Dropbox sync. Rows are claimed with tag_source='tagging' so two
 * workers cannot both pay for the same file. A missing API key returns without
 * writing. A model error or a spent budget does not stop the Dropbox sync.
 */
export async function tagPendingSubmissionFiles(
  supabase: ServiceClient,
  submissionId: string,
  options: TagPendingOptions = {}
): Promise<void> {
  const provider = options.provider ?? getAutoTagProvider();
  if (!provider.isConfigured()) return;

  const now = options.now ?? Date.now;
  const budgetMs = options.budgetMs ?? TAG_SYNC_MAX_BUDGET_MS;
  if (budgetMs <= 0) return;

  const deadline = now() + budgetMs;

  const claimedResult = await supabase
    .from('submission_files')
    .update({ tag_source: 'tagging' })
    .eq('submission_id', submissionId)
    .eq('tag_source', 'pending')
    .is('dropbox_path', null)
    .is('dropbox_job_id', null)
    .select(FILE_COLUMNS);

  if (claimedResult.error || !claimedResult.data) {
    if (claimedResult.error && !missingColumn(claimedResult.error)) {
      console.warn('Auto-tag fallback skipped:', claimedResult.error.message);
    }
    return;
  }

  const claimed = claimedResult.data as PendingFile[];
  if (!claimed.length) return;

  const outcomes = new Map<string, NameOutcome>();

  const markTimeBudget = async (file: PendingFile) => {
    const meta = asRecord(file.auto_tags) || {};
    await saveFile(supabase, file.id, {
      tag_source: 'failed',
      auto_tags: withoutFrames(meta, {
        status: 'failed',
        error: 'time_budget',
        name_edited: meta.name_edited === true,
      }),
    });
    outcomes.set(file.id, { keepName: true });
  };

  try {
    const { data: submission } = await supabase
      .from('submissions')
      .select('brand_id')
      .eq('id', submissionId)
      .single();
    const brandId = submission?.brand_id as string | undefined;
    const brand = brandId ? await loadBrand(supabase, brandId) : null;
    if (!brand) {
      for (const file of claimed) {
        const meta = asRecord(file.auto_tags) || {};
        await saveFile(supabase, file.id, {
          tag_source: 'failed',
          auto_tags: withoutFrames(meta, {
            status: 'failed',
            error: 'Brand not found',
            name_edited: meta.name_edited === true,
          }),
        });
        outcomes.set(file.id, { keepName: true });
      }
      return;
    }

    const products = await loadProducts(supabase, brand.id || brandId!);
    const origin = storefrontOrigin(brand.website_url, brand.shopify_store_domain);
    const sharedPrompt = buildSharedTagPrompt({
      brandName: brand.name || 'Brand',
      storefront: origin,
      products,
    });

    const tagOne = async (file: PendingFile) => {
      const timeoutMs = Math.min(TAG_SYNC_CALL_TIMEOUT_MS, deadline - now());
      if (timeoutMs <= 0) {
        await markTimeBudget(file);
        return;
      }

      const meta = asRecord(file.auto_tags) || {};
      const nameEdited = meta.name_edited === true;
      const original = file.original_file_name || file.file_name;
      const duration = typeof meta.duration_seconds === 'number' ? meta.duration_seconds : null;
      const aspect = file.aspect_ratio || (typeof meta.aspect_ratio === 'string' ? meta.aspect_ratio : null);
      const mediaFormat =
        file.media_format || (typeof meta.media_format === 'string' ? meta.media_format : null);
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error('time_budget'));
        }, timeoutMs);
      });

      let creativeType = file.creative_type || null;
      let productId = file.product_id || null;
      let productName = file.product_name || null;
      let hook = file.hook_angle || null;
      let landing = file.landing_page_url || null;
      let autoTags: Record<string, unknown> = withoutFrames(meta, {
        status: 'failed',
        name_edited: nameEdited,
        error: 'No frames to tag',
      });
      let tagSource: 'fallback' | 'mixed' | 'failed' = 'failed';
      let keepName = true;

      try {
        const images = await Promise.race([framesFor(supabase, { ...file, auto_tags: meta }), timeout]);
        if (controller.signal.aborted || now() >= deadline) {
          throw new Error('time_budget');
        }
        if (images.length) {
          const format = mediaFormatFromHint(mediaFormat, file.file_type);
          const tagged = await Promise.race([
            provider.tag({
              images,
              fileLabel: original,
              sharedPrompt,
              filePrompt: buildFileTagPrompt({
                fileName: original,
                mediaFormat: format,
                aspectRatio: aspect,
              }),
              signal: controller.signal,
            }),
            timeout,
          ]);
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
          keepName = false;
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
        const timedOut = controller.signal.aborted || message === 'time_budget';
        autoTags = withoutFrames(meta, {
          status: 'failed',
          name_edited: nameEdited,
          error: timedOut ? 'time_budget' : message.slice(0, 300),
        });
        tagSource = 'failed';
        keepName = true;
        if (!timedOut) {
          console.warn(`Auto-tag fallback failed for ${file.id}:`, message.slice(0, 200));
        }
      } finally {
        if (timer) clearTimeout(timer);
      }

      const fidelity = creativeType ? CREATIVE_TYPES_MAP.get(creativeType)?.fidelity ?? null : null;
      await saveFile(supabase, file.id, {
        creative_type: creativeType,
        fidelity,
        product_id: productId,
        product_name: productName,
        hook_angle: hook,
        landing_page_url: landing,
        auto_tags: autoTags,
        tag_source: tagSource,
      });
      outcomes.set(file.id, {
        keepName: keepName || nameEdited,
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
          customFileName: keepName || nameEdited ? file.file_name : null,
        },
      });
    };

    let cursor = 0;
    const workerCount = Math.min(TAG_SYNC_CONCURRENCY, claimed.length);
    const worker = async () => {
      while (cursor < claimed.length) {
        if (now() >= deadline) return;
        const file = claimed[cursor];
        cursor += 1;
        if (!file) return;
        if (now() >= deadline) {
          await markTimeBudget(file);
          return;
        }
        await tagOne(file);
      }
    };

    await Promise.all(Array.from({ length: workerCount }, () => worker()));

    for (let i = cursor; i < claimed.length; i++) {
      const file = claimed[i];
      if (!outcomes.has(file.id)) await markTimeBudget(file);
    }
  } catch (err) {
    console.warn('Auto-tag fallback failed:', err instanceof Error ? err.message : err);
  } finally {
    const leftover = await supabase
      .from('submission_files')
      .select('id, file_name, auto_tags, tag_source')
      .in(
        'id',
        claimed.map((file) => file.id)
      );
    const rows = (leftover.data || []) as PendingFile[];
    for (const row of rows) {
      if (row.tag_source === 'tagging') await markTimeBudget(row);
    }
  }

  try {
    const listed = await supabase
      .from('submission_files')
      .select(FILE_COLUMNS)
      .eq('submission_id', submissionId);
    const files = (listed.data || []) as PendingFile[];
    if (!files.length) return;

    const nameInputs: BatchNameItem[] = files.map((file) => {
      const outcome = outcomes.get(file.id);
      if (outcome?.nameItem && !outcome.keepName) return outcome.nameItem;
      return {
        originalFileName: file.original_file_name || file.file_name,
        customFileName: file.file_name,
      };
    });
    const names = assignCreativeFileNames(nameInputs);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const outcome = outcomes.get(file.id);
      if (!outcome || outcome.keepName) continue;
      if (names[i] === file.file_name) continue;
      const { error } = await supabase
        .from('submission_files')
        .update({ file_name: names[i] })
        .eq('id', file.id)
        .is('dropbox_path', null)
        .is('dropbox_job_id', null);
      if (error) console.warn(`Auto-tag rename failed for ${file.id}:`, error.message);
    }
  } catch (err) {
    console.warn('Auto-tag rename skipped:', err instanceof Error ? err.message : err);
  }
}
