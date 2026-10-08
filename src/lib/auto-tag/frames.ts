import { rasterMeetsMinimum } from '@/lib/auto-tag/image-size';
import type { AutoTagImage } from '@/lib/auto-tag/provider';
import { parseImageDataUrl } from '@/lib/creative-auto-tag';

/** xAI vision accepts jpeg and png only, and rejects rasters under 512 pixels. */
export function visionImageFromBytes(mediaType: string, bytes: Uint8Array): AutoTagImage | null {
  const type = mediaType.toLowerCase();
  if (type !== 'image/jpeg' && type !== 'image/png') return null;
  if (bytes.byteLength > 1_500_000) return null;
  if (!rasterMeetsMinimum(bytes)) return null;
  return { mediaType: type, base64: Buffer.from(bytes).toString('base64') };
}

export function visionImageFromDataUrl(input: string): AutoTagImage | null {
  const parsed = parseImageDataUrl(input);
  if (!parsed) return null;
  if (parsed.media_type !== 'image/jpeg' && parsed.media_type !== 'image/png') return null;
  const bytes = Uint8Array.from(Buffer.from(parsed.data, 'base64'));
  if (!rasterMeetsMinimum(bytes)) return null;
  return { mediaType: parsed.media_type, base64: parsed.data };
}

export function visionImagesFromUnknown(input: unknown, limit = 3): AutoTagImage[] {
  if (!Array.isArray(input)) return [];
  const out: AutoTagImage[] = [];
  for (const item of input) {
    if (typeof item !== 'string') continue;
    const image = visionImageFromDataUrl(item);
    if (!image) continue;
    out.push(image);
    if (out.length >= limit) break;
  }
  return out;
}
