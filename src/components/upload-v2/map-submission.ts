import { deriveBatchCreativeType } from '@/lib/batch-creative-type';
import { usageEndDateError } from '@/lib/usage-end-date';
import {
  batchFileNamePreview,
  fileExtension,
  previewCreativeFileName,
  type Creative,
  type CreativeType,
  type LocalMedia,
} from '@/components/upload-v2/model';

export type SubmissionInsertRow = {
  brand_id: string;
  user_id: string;
  drive_sync_status: 'pending';
  batch_name: string;
  creative_type: string;
  creator_name: string;
  creator_social_handle: string | null;
  landing_page_url: string;
  copy_title: string;
  copy_headline: null;
  copy_body: string;
  copy_cta: null;
  notes: string;
  is_carousel: boolean;
  is_flexible: boolean;
  is_whitelist: boolean;
  usage_end_date: string | null;
  file_count: number;
};

export type SubmissionFileInsertRow = {
  file_name: string;
  file_type: string;
  file_size: number;
  media_format: 'VIDEO' | 'STATIC' | 'AUDIO' | 'DOCUMENT' | null;
  aspect_ratio: '1x1' | '9x16' | '4x5' | '16x9' | 'OTHER' | null;
  width: number | null;
  height: number | null;
  copy_headline: string | null;
  copy_body: string | null;
  product_id: string | null;
  product_name: string | null;
  hook_angle: string | null;
  original_file_name: string;
};

export type MappedUploadFile = {
  file: File;
  row: SubmissionFileInsertRow;
};

export type MappedSubmission = {
  submission: SubmissionInsertRow;
  files: MappedUploadFile[];
};

export type MapV2Input = {
  brandId: string;
  userId: string;
  batchName: string;
  creatorName: string;
  creativeType: CreativeType;
  batchOn: boolean;
  /** The creative on screen when Batch is off. */
  creative: Creative;
  batchCreatives: readonly Creative[];
};

type Piece = {
  file: File;
  media: LocalMedia;
  creative: Creative;
  cardHeadline: string | null;
};

function withFile(media: LocalMedia | null | undefined): { file: File; media: LocalMedia } | null {
  if (!media?.file) return null;
  return { file: media.file, media };
}

/** Files that belong on this submit. Batch is its own list. Single modes use the active creative. */
export function collectUploadPieces(input: Pick<MapV2Input, 'creativeType' | 'batchOn' | 'creative' | 'batchCreatives'>): Piece[] {
  if (input.batchOn) {
    return input.batchCreatives.flatMap((creative) => {
      const attached = withFile(creative.media);
      if (!attached) return [];
      return [{ ...attached, creative, cardHeadline: null }];
    });
  }

  const { creative } = input;
  if (input.creativeType === 'carousel') {
    return creative.cards.flatMap((card) => {
      const attached = withFile(card.media);
      if (!attached) return [];
      return [{ ...attached, creative, cardHeadline: card.headline.trim() || null }];
    });
  }

  if (input.creativeType === 'flexible') {
    return creative.assets.flatMap((asset) => {
      const attached = withFile(asset.media);
      if (!attached) return [];
      return [{ ...attached, creative, cardHeadline: null }];
    });
  }

  const attached = withFile(creative.media);
  if (!attached) return [];
  return [{ ...attached, creative, cardHeadline: null }];
}

/** First file keeps its name. Later collisions become name-2, name-3, before the extension. */
export function dedupeStoredFileNames(names: readonly string[]): string[] {
  const used = new Set<string>();
  return names.map((name) => {
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
    let n = 2;
    let candidate = suffixFileName(name, n);
    while (used.has(candidate)) {
      n += 1;
      candidate = suffixFileName(name, n);
    }
    used.add(candidate);
    return candidate;
  });
}

function suffixFileName(name: string, n: number): string {
  const ext = fileExtension(name);
  const stem = ext ? name.slice(0, -ext.length) : name;
  return `${stem}-${n}${ext}`;
}

/**
 * Product title for a real product choice. Homepage, Shop All, and No landing page
 * are not product names. The picker only has title and handle, so product_id stays null.
 */
export function productColumns(productKey: string, productLabel: string): {
  product_id: string | null;
  product_name: string | null;
} {
  const key = productKey.trim();
  const label = productLabel.trim();
  if (!label || !key || key === 'none' || key === 'homepage' || key === 'shop_all') {
    return { product_id: null, product_name: null };
  }
  return { product_id: null, product_name: label };
}

function storedName(input: MapV2Input, piece: Piece): string {
  if (input.batchOn) return batchFileNamePreview(piece.creative).fileName;
  return previewCreativeFileName(
    piece.creative,
    input.creatorName,
    input.creativeType,
    piece.file.name,
  ).fileName;
}

/**
 * One submission for the active creative, or one submission for the whole batch.
 * Batch mode is a plain bulk upload: creator_name '', and no whitelist, carousel, or flexible flags.
 * creative_type is never the word whitelist.
 */
export function mapV2Submission(input: MapV2Input): MappedSubmission {
  const pieces = collectUploadPieces(input);
  const names = dedupeStoredFileNames(pieces.map((piece) => storedName(input, piece)));
  const batch = input.batchOn;
  const isCarousel = !batch && input.creativeType === 'carousel';
  const isFlexible = !batch && input.creativeType === 'flexible';
  const isWhitelist = !batch && input.creativeType === 'whitelist';
  const creative = input.creative;

  const usageEndDate = isWhitelist && !creative.perpetual
    ? creative.usageEndDate.trim() || null
    : null;

  const submission: SubmissionInsertRow = {
    brand_id: input.brandId,
    user_id: input.userId,
    drive_sync_status: 'pending',
    batch_name: input.batchName,
    creative_type: deriveBatchCreativeType(
      pieces.map((piece) => ({ type: piece.file.type, name: piece.file.name })),
      { isCarousel, isFlexible },
    ),
    creator_name: batch ? '' : input.creatorName.trim(),
    creator_social_handle: isWhitelist ? creative.handle.trim() || null : null,
    landing_page_url: '',
    copy_title: '',
    copy_headline: null,
    copy_body: batch ? '' : creative.caption.trim(),
    copy_cta: null,
    notes: '',
    is_carousel: isCarousel,
    is_flexible: isFlexible,
    is_whitelist: isWhitelist,
    usage_end_date: usageEndDate,
    file_count: pieces.length,
  };

  const files: MappedUploadFile[] = pieces.map((piece, index) => {
    const product = batch
      ? { product_id: null, product_name: null }
      : productColumns(piece.creative.productKey, piece.creative.productLabel);
    const angle = batch ? '' : piece.creative.angle.trim();
    return {
      file: piece.file,
      row: {
        file_name: names[index],
        file_type: piece.file.type || 'application/octet-stream',
        file_size: piece.file.size || 0,
        media_format: piece.media.mediaFormat,
        aspect_ratio: piece.media.detectedAspectRatio,
        width: piece.media.width || null,
        height: piece.media.height || null,
        copy_headline: isCarousel ? piece.cardHeadline : null,
        copy_body: null,
        product_id: product.product_id,
        product_name: product.product_name,
        hook_angle: angle || null,
        original_file_name: piece.file.name,
      },
    };
  });

  return { submission, files };
}

/** Why Submit stays disabled. Null means the form can submit. */
export function v2SubmitBlocker(input: {
  brandId?: string;
  creativeType: CreativeType;
  batchOn: boolean;
  creative: Creative;
  batchCreatives: readonly Creative[];
  today: string;
}): string | null {
  if (!input.brandId?.trim()) return 'Choose a brand';
  const count = collectUploadPieces(input).length;
  if (count < 1) return 'Add at least one file';
  if (!input.batchOn && input.creativeType === 'whitelist' && !input.creative.perpetual) {
    return usageEndDateError(input.creative.usageEndDate, input.today);
  }
  return null;
}
