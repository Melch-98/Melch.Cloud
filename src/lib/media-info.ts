/**
 * Format and aspect detection used by the live uploader.
 * Moved here so /upload-v2 stores the same slugs. The rules are unchanged:
 * VIDEO|STATIC|AUDIO|DOCUMENT, and 1x1|9x16|4x5|16x9|OTHER within 5%.
 */

export type StoredMediaFormat = 'VIDEO' | 'STATIC' | 'AUDIO' | 'DOCUMENT';

export type StoredAspectRatio = '1x1' | '9x16' | '4x5' | '16x9' | 'OTHER';

export function detectFormat(mimeType: string): StoredMediaFormat {
  if (mimeType.startsWith('video/')) return 'VIDEO';
  if (mimeType.startsWith('image/')) return 'STATIC';
  if (mimeType.startsWith('audio/')) return 'AUDIO';
  return 'DOCUMENT';
}

export function detectAspectRatio(width: number, height: number): StoredAspectRatio {
  if (width === 0 || height === 0) return 'OTHER';
  const ratio = width / height;
  const tolerance = 0.05;

  if (Math.abs(ratio - 1) < tolerance) return '1x1';
  if (Math.abs(ratio - 9 / 16) < tolerance) return '9x16';
  if (Math.abs(ratio - 4 / 5) < tolerance) return '4x5';
  if (Math.abs(ratio - 16 / 9) < tolerance) return '16x9';
  return 'OTHER';
}

/**
 * Values written to submission_files. The crop target (`9:16` | `4:5` | `1:1`)
 * is a preview frame and is not an input here.
 */
export function measuredFileMedia(
  file: { type: string },
  width: number | null,
  height: number | null,
): { mediaFormat: StoredMediaFormat; detectedAspectRatio: StoredAspectRatio | null } {
  return {
    mediaFormat: detectFormat(file.type),
    detectedAspectRatio: width && height ? detectAspectRatio(width, height) : null,
  };
}
