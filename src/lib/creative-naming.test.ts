import { describe, expect, it } from 'vitest';
import {
  assignCreativeFileNames,
  buildCreativeFileName,
  sanitizeUserFileName,
  uniqueCreativeFileName,
} from './creative-naming';

const base = {
  brandName: 'Tallow Twins Co',
  brandSlug: 'tallow-twins',
  productName: 'Daily Serum',
  hookAngle: 'tired skin at night',
  creativeType: 'grwm',
  aspectRatio: '9x16',
  mediaFormat: 'VIDEO',
  durationSeconds: 15.2,
  originalFileName: 'IMG_1234.mp4',
};

describe('buildCreativeFileName', () => {
  it('joins known segments and keeps the extension', () => {
    expect(buildCreativeFileName(base)).toBe('TallowTwins_DailySerum_TiredSkinAtNight_GRWM_15s.mp4');
  });

  it('omits a missing creator instead of writing UGC', () => {
    const name = buildCreativeFileName({ ...base, creatorName: '' });
    expect(name).not.toContain('UGC');
    expect(name).toBe('TallowTwins_DailySerum_TiredSkinAtNight_GRWM_15s.mp4');
  });

  it('omits an unknown creative type', () => {
    expect(buildCreativeFileName({ ...base, creativeType: 'not-a-type', durationSeconds: null, mediaFormat: 'STATIC' })).toBe(
      'TallowTwins_DailySerum_TiredSkinAtNight_9x16.mp4'
    );
  });

  it('uses aspect ratio for stills', () => {
    expect(
      buildCreativeFileName({
        ...base,
        creativeType: 'ecom_product_shots',
        mediaFormat: 'STATIC',
        durationSeconds: 12,
        originalFileName: 'shot.JPG',
      })
    ).toBe('TallowTwins_DailySerum_TiredSkinAtNight_EComProductShots_9x16.JPG');
  });

  it('falls back when the pattern has no tokens', () => {
    expect(buildCreativeFileName({ ...base, pattern: 'plain-text' })).toBe(
      buildCreativeFileName(base)
    );
  });

  it('sanitizes a typed name and dedupes with _v2', () => {
    expect(sanitizeUserFileName('My Ad!.mp4', 'clip.mov')).toBe('MyAd.mov');
    const names = assignCreativeFileNames([
      { originalFileName: 'a.mp4', customFileName: 'Hero.mp4' },
      { originalFileName: 'b.mp4', customFileName: 'Hero.mp4' },
      { ...base, originalFileName: 'c.mp4' },
    ]);
    expect(names[0]).toBe('Hero.mp4');
    expect(names[1]).toBe('Hero_v2.mp4');
    expect(names[2].endsWith('.mp4')).toBe(true);
    expect(uniqueCreativeFileName('Hero.mp4', new Set())).toBe('Hero.mp4');
  });
});
