/** Frame size for the vision call. Long side ~768px. Area must be at least 512 pixels. */

export const TARGET_LONG_SIDE = 768;
export const MIN_TOTAL_PIXELS = 512;

export interface FrameSize {
  width: number;
  height: number;
}

/**
 * Scale so the long side is about 768px.
 * If that would leave fewer than 512 pixels in total, scale up further.
 * Returns null when the source has no usable dimensions.
 */
export function targetFrameSize(width: number, height: number): FrameSize | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    return null;
  }
  const longSide = Math.max(width, height);
  const scale = TARGET_LONG_SIDE / longSide;
  let tw = Math.max(1, Math.round(width * scale));
  let th = Math.max(1, Math.round(height * scale));
  if (tw * th < MIN_TOTAL_PIXELS) {
    const boost = Math.sqrt(MIN_TOTAL_PIXELS / (tw * th));
    tw = Math.max(1, Math.round(tw * boost));
    th = Math.max(1, Math.round(th * boost));
  }
  if (tw * th < MIN_TOTAL_PIXELS) return null;
  return { width: tw, height: th };
}

export function readRasterSize(bytes: Uint8Array): FrameSize | null {
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const width = readUint32(bytes, 16);
    const height = readUint32(bytes, 20);
    if (width > 0 && height > 0) return { width, height };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    return readJpegSize(bytes);
  }
  return null;
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0
  );
}

function readJpegSize(bytes: Uint8Array): FrameSize | null {
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2;
      continue;
    }
    if (offset + 4 > bytes.length) return null;
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    const isSof =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isSof && offset + 9 < bytes.length) {
      const height = (bytes[offset + 5] << 8) | bytes[offset + 6];
      const width = (bytes[offset + 7] << 8) | bytes[offset + 8];
      if (width > 0 && height > 0) return { width, height };
    }
    if (length < 2) return null;
    offset += 2 + length;
  }
  return null;
}

export function rasterMeetsMinimum(bytes: Uint8Array): boolean {
  const size = readRasterSize(bytes);
  if (!size) return true;
  return size.width * size.height >= MIN_TOTAL_PIXELS;
}
