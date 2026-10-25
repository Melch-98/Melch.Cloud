import { describe, expect, it } from 'vitest';
import { detectAspectRatio, detectFormat, measuredFileMedia } from '@/lib/media-info';

describe('live uploader media detection', () => {
  it('keeps the 5% aspect buckets and the mime format slugs', () => {
    expect(detectAspectRatio(1080, 1080)).toBe('1x1');
    expect(detectAspectRatio(1080, 1920)).toBe('9x16');
    expect(detectAspectRatio(1080, 1350)).toBe('4x5');
    expect(detectAspectRatio(1920, 1080)).toBe('16x9');
    expect(detectAspectRatio(1040, 1000)).toBe('1x1');
    expect(detectAspectRatio(1060, 1000)).toBe('OTHER');
    expect(detectAspectRatio(1000, 1100)).toBe('OTHER');
    expect(detectAspectRatio(0, 0)).toBe('OTHER');

    expect(detectFormat('video/mp4')).toBe('VIDEO');
    expect(detectFormat('image/jpeg')).toBe('STATIC');
    expect(detectFormat('audio/mpeg')).toBe('AUDIO');
    expect(detectFormat('application/pdf')).toBe('DOCUMENT');
    expect(detectFormat('')).toBe('DOCUMENT');
  });

  it('stores the detected aspect, not the preview crop target', () => {
    const cropTarget = '1:1';
    const stored = measuredFileMedia({ type: 'video/mp4' }, 1080, 1920);
    expect(cropTarget).toBe('1:1');
    expect(stored).toEqual({ mediaFormat: 'VIDEO', detectedAspectRatio: '9x16' });
    expect(measuredFileMedia({ type: 'image/png' }, null, null)).toEqual({
      mediaFormat: 'STATIC',
      detectedAspectRatio: null,
    });
  });
});
