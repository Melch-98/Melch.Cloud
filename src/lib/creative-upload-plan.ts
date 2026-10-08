import { CREATIVE_TYPES_MAP } from '@/lib/creative-types';
import { assignCreativeFileNames, type BatchNameItem } from '@/lib/creative-naming';
import { tagSourceForContext } from '@/lib/creative-tag-merge';
import type { FileContext, FileMediaInfo } from '@/lib/types';

export interface PlannedUploadFile {
  name: string;
  type?: string;
  size?: number;
  context?: Partial<FileContext>;
  media?: Partial<FileMediaInfo>;
}

export function planCreativeFileNames(input: {
  brandName?: string | null;
  brandSlug?: string | null;
  pattern?: string | null;
  files: PlannedUploadFile[];
}): string[] {
  const items: BatchNameItem[] = input.files.map((file) => ({
    brandName: input.brandName,
    brandSlug: input.brandSlug,
    productName: file.context?.productName,
    hookAngle: file.context?.hookAngle,
    creativeType: file.context?.creativeType,
    creatorName: file.context?.creatorName,
    aspectRatio: file.media?.aspectRatio,
    durationSeconds: file.media?.durationSeconds,
    mediaFormat: file.media?.format,
    originalFileName: file.name,
    pattern: input.pattern,
    customFileName: file.context?.lockedFields?.fileName ? file.context.customFileName : null,
  }));
  return assignCreativeFileNames(items);
}

/**
 * tag_source stored on the row.
 * Pending means Dropbox sync may still fill empty fields.
 * A missing vision key must not leave the row pending.
 */
export function persistedTagSource(
  context: Partial<FileContext> | undefined,
  visionConfigured: boolean
): 'ai' | 'user' | 'mixed' | 'pending' | null {
  if (!visionConfigured && context?.tagStatus !== 'done') {
    return tagSourceForContext({ ...context, tagStatus: 'skipped' });
  }
  return tagSourceForContext(context);
}

export function buildSubmissionFileRow(input: {
  submissionId: string;
  storagePath: string;
  proposedFileName: string;
  originalFileName: string;
  fileType: string;
  fileSize: number;
  context?: Partial<FileContext>;
  media?: Partial<FileMediaInfo>;
  frames?: string[] | null;
  visionConfigured: boolean;
}): Record<string, unknown> {
  const ctx = input.context;
  const creativeType = ctx?.creativeType || null;
  const tagSource = persistedTagSource(ctx, input.visionConfigured);
  const prior = { ...(ctx?.autoTags || {}) };
  delete prior.frames;
  const frames =
    input.visionConfigured && tagSource === 'pending' && input.frames && input.frames.length
      ? input.frames.slice(0, 3)
      : null;

  return {
    submission_id: input.submissionId,
    file_name: input.proposedFileName,
    original_file_name: input.originalFileName,
    file_type: input.fileType || 'application/octet-stream',
    file_size: input.fileSize || 0,
    file_url: input.storagePath,
    media_format: input.media?.format || null,
    aspect_ratio: input.media?.aspectRatio || null,
    width: input.media?.width || null,
    height: input.media?.height || null,
    landing_page_url: ctx?.landingPageUrl || null,
    copy_headline: ctx?.copyHeadline || null,
    copy_body: ctx?.copyBody || null,
    copy_cta: ctx?.copyCta || null,
    product_id: ctx?.productId || null,
    product_name: ctx?.productName || null,
    creative_type: creativeType,
    fidelity: creativeType ? CREATIVE_TYPES_MAP.get(creativeType)?.fidelity ?? null : null,
    hook_angle: ctx?.hookAngle || null,
    copy_title: ctx?.copyTemplate || null,
    creator_name: ctx?.creatorName || null,
    creator_social_handle: ctx?.creatorHandle || null,
    tag_source: tagSource,
    auto_tags: {
      ...prior,
      name_edited: Boolean(ctx?.lockedFields?.fileName),
      duration_seconds: input.media?.durationSeconds ?? null,
      aspect_ratio: input.media?.aspectRatio ?? null,
      media_format: input.media?.format ?? null,
      ...(frames ? { frames } : {}),
    },
  };
}

/** Insert shape used when the new columns are not on production yet. Keeps the upload name. */
export function legacySubmissionFileRow(row: Record<string, unknown>): Record<string, unknown> {
  const next = { ...row };
  delete next.original_file_name;
  delete next.auto_tags;
  delete next.tag_source;
  next.file_name = row.original_file_name || row.file_name;
  return next;
}

export function isMissingColumnError(
  error: { message?: string; code?: string } | null | undefined
): boolean {
  if (!error) return false;
  const msg = (error.message || '').toLowerCase();
  return (
    error.code === 'PGRST204' ||
    error.code === '42703' ||
    msg.includes('column') ||
    msg.includes('schema cache')
  );
}
