import { deriveBatchCreativeType } from '@/lib/batch-creative-type';
import { usageEndDateError } from '@/lib/usage-end-date';
import {
  batchFileNamePreview,
  fileExtension,
  nameTypeForModes,
  normalizeUploadModes,
  previewCreativeFileName,
  structureCapacityMessage,
  uploadStructure,
  type Creative,
  type LocalMedia,
  type UploadModes,
  type UploadStructure,
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
  modes: UploadModes;
  /** Details, plus cards or assets when carousel or flexible is on. */
  creative: Creative;
  /** One plain creative per file. Used when neither carousel nor flexible is on. */
  plainCreatives: readonly Creative[];
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

/** Files that belong on this submit. Plain mode is one creative per file. */
export function collectUploadPieces(input: Pick<MapV2Input, 'modes' | 'creative' | 'plainCreatives'>): Piece[] {
  const modes = normalizeUploadModes(input.modes);
  const structure = uploadStructure(modes);
  const { creative } = input;

  if (structure === 'carousel') {
    return creative.cards.flatMap((card) => {
      const attached = withFile(card.media);
      if (!attached) return [];
      return [{ ...attached, creative, cardHeadline: card.headline.trim() || null }];
    });
  }

  if (structure === 'flexible') {
    return creative.assets.flatMap((asset) => {
      const attached = withFile(asset.media);
      if (!attached) return [];
      return [{ ...attached, creative, cardHeadline: null }];
    });
  }

  return input.plainCreatives.flatMap((item) => {
    const attached = withFile(item.media);
    if (!attached) return [];
    return [{ ...attached, creative: item, cardHeadline: null }];
  });
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

function detailCreative(input: MapV2Input, piece: Piece, structure: UploadStructure): Creative {
  if (structure !== 'plain') return piece.creative;
  return {
    ...piece.creative,
    productKey: input.creative.productKey,
    productLabel: input.creative.productLabel,
    angle: input.creative.angle,
    caption: input.creative.caption,
    handle: input.creative.handle,
  };
}

function storedName(input: MapV2Input, piece: Piece, structure: UploadStructure): string {
  const named = detailCreative(input, piece, structure);
  const typeWord = nameTypeForModes(input.modes);
  if (!typeWord) return batchFileNamePreview(named).fileName;
  return previewCreativeFileName(named, input.creatorName, typeWord, piece.file.name).fileName;
}

/**
 * One submission for every file on the card.
 * Default plain bulk: creator_name '', no whitelist, carousel, or flexible flags.
 * creative_type is never the word whitelist.
 */
export function mapV2Submission(input: MapV2Input): MappedSubmission {
  const modes = normalizeUploadModes(input.modes);
  const structure = uploadStructure(modes);
  const pieces = collectUploadPieces({ ...input, modes });
  const names = dedupeStoredFileNames(pieces.map((piece) => storedName({ ...input, modes }, piece, structure)));
  const isCarousel = modes.carousel;
  const isFlexible = modes.flexible;
  const isWhitelist = modes.whitelist;
  const creative = input.creative;
  const detailed = isWhitelist || isCarousel || isFlexible;

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
    creator_name: detailed ? input.creatorName.trim() : '',
    creator_social_handle: isWhitelist ? creative.handle.trim() || null : null,
    landing_page_url: '',
    copy_title: '',
    copy_headline: null,
    copy_body: detailed ? creative.caption.trim() : '',
    copy_cta: null,
    notes: '',
    is_carousel: isCarousel,
    is_flexible: isFlexible,
    is_whitelist: isWhitelist,
    usage_end_date: usageEndDate,
    file_count: pieces.length,
  };

  const files: MappedUploadFile[] = pieces.map((piece, index) => {
    const source = detailCreative({ ...input, modes }, piece, structure);
    const product = detailed
      ? productColumns(source.productKey, source.productLabel)
      : { product_id: null, product_name: null };
    const angle = detailed ? source.angle.trim() : '';
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
  modes: UploadModes;
  creative: Creative;
  plainCreatives: readonly Creative[];
  today: string;
}): string | null {
  if (!input.brandId?.trim()) return 'Choose a brand';
  const modes = normalizeUploadModes(input.modes);
  const count = collectUploadPieces({ ...input, modes }).length;
  if (count < 1) return 'Add at least one file';
  const capacity = structureCapacityMessage(uploadStructure(modes), count);
  if (capacity) return capacity;
  if (modes.whitelist && !input.creative.perpetual) {
    return usageEndDateError(input.creative.usageEndDate, input.today);
  }
  return null;
}
