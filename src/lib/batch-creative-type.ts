const VIDEO_EXT = /\.(mp4|mov|webm|m4v|avi)$/i;
const IMAGE_EXT = /\.(jpe?g|png|gif|webp|heic|avif)$/i;

export type BatchCreativeType = 'image' | 'video' | 'mixed' | 'carousel' | 'flexible' | 'other';

export interface BatchCreativeFlags {
  isCarousel?: boolean;
  isFlexible?: boolean;
}

/** Image or video from the browser MIME type, then the file extension. */
export function fileMediaKind(file: { type?: string; name?: string }): 'image' | 'video' | 'other' {
  const type = (file.type || '').toLowerCase();
  const name = file.name || '';
  if (type.startsWith('video/') || VIDEO_EXT.test(name)) return 'video';
  if (type.startsWith('image/') || IMAGE_EXT.test(name)) return 'image';
  return 'other';
}

/**
 * Batch label stored on submissions.creative_type.
 * Stats Creative Type Mix reads that column. Carousel and flexible win over
 * the file mix because those toggles describe the batch, not one file.
 */
export function deriveBatchCreativeType(
  files: Array<{ type?: string; name?: string }>,
  flags: BatchCreativeFlags = {}
): BatchCreativeType {
  if (flags.isCarousel) return 'carousel';
  if (flags.isFlexible) return 'flexible';
  const kinds = new Set<'image' | 'video'>();
  for (const file of files) {
    const kind = fileMediaKind(file);
    if (kind === 'image' || kind === 'video') kinds.add(kind);
  }
  if (kinds.size === 0) return 'other';
  if (kinds.size === 2) return 'mixed';
  return kinds.has('video') ? 'video' : 'image';
}
