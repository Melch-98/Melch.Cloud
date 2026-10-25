import { describe, expect, it } from 'vitest';
import {
  BATCH_MAX_CREATIVES,
  CAROUSEL_MAX_CARDS,
  FLEXIBLE_MAX_ASSETS,
  SAMPLE_CREATIVES,
  addCarouselMedia,
  addFlexibleAssets,
  appendBatchCreatives,
  batchFileNamePreview,
  brandInitials,
  brandLogoUrl,
  followMove,
  formatBytes,
  moveItem,
  previewCreativeFileName,
  removeCarouselCard,
  replaceBatchMedia,
  type FlexibleAsset,
  type LocalMedia,
} from '@/components/upload-v2/model';

function media(name: string, width: number, height: number): LocalMedia {
  return {
    url: `blob:${name}`,
    kind: name.endsWith('.mp4') ? 'video' : 'image',
    name,
    bytes: 2_400_000,
    width,
    height,
  };
}

describe('upload-v2 file placement', () => {
  it('replaces the sample three cards instead of stopping there', () => {
    const sample = SAMPLE_CREATIVES[0].cards;
    expect(sample).toHaveLength(3);
    expect(sample.every((card) => !card.media)).toBe(true);

    const incoming = Array.from({ length: 7 }, (_, index) => media(`card-${index}.jpg`, 1080, 1350));
    const result = addCarouselMedia(sample, incoming, (prefix) => prefix);
    expect(result.cards).toHaveLength(7);
    expect(result.placed).toBe(7);
    expect(result.leftover).toBe(0);
    expect(result.focusIndex).toBe(0);
    expect(result.cards?.[0].headline).toBe('Open on the morning');
    expect(result.cards?.[0].media?.name).toBe('card-0.jpg');
    expect(result.cards?.[6].media?.name).toBe('card-6.jpg');
  });

  it('keeps a second empty card when one file is dropped on an empty carousel', () => {
    const result = addCarouselMedia(SAMPLE_CREATIVES[0].cards, [media('only.jpg', 1080, 1920)], () => 'card');
    expect(result.cards).toHaveLength(2);
    expect(result.cards?.[0].media?.name).toBe('only.jpg');
    expect(result.cards?.[1].media).toBeNull();
    expect(removeCarouselCard(result.cards ?? [], 1)).toBeNull();
  });

  it('caps a carousel at 10 cards', () => {
    let n = 0;
    const incoming = Array.from({ length: 12 }, (_, index) => media(`c-${index}.jpg`, 1080, 1080));
    const result = addCarouselMedia(SAMPLE_CREATIVES[0].cards, incoming, (prefix) => `${prefix}-${n++}`);
    expect(CAROUSEL_MAX_CARDS).toBe(10);
    expect(result.cards).toHaveLength(10);
    expect(result.placed).toBe(10);
    expect(result.leftover).toBe(2);
  });

  it('appends cards once the creative already has media', () => {
    const first = addCarouselMedia(
      SAMPLE_CREATIVES[0].cards,
      [media('a.jpg', 1080, 1920), media('b.jpg', 1080, 1920)],
      () => 'card',
    );
    const second = addCarouselMedia(first.cards ?? [], [media('c.jpg', 1080, 1080)], () => 'extra');
    expect(second.cards).toHaveLength(3);
    expect(second.cards?.[2].media?.name).toBe('c.jpg');
    expect(second.focusIndex).toBe(2);
    expect(removeCarouselCard(second.cards ?? [], 2)).toHaveLength(2);
  });

  it('caps flexible assets at 10 and focuses the first new asset', () => {
    const first = addFlexibleAssets(
      [],
      Array.from({ length: 4 }, (_, index) => media(`asset-${index}.mp4`, 1080, 1920)),
      (prefix) => `${prefix}-a`,
    );
    expect(first.assets).toHaveLength(4);
    expect(first.focusIndex).toBe(0);

    let n = 0;
    const second = addFlexibleAssets(
      first.assets as FlexibleAsset[],
      Array.from({ length: 8 }, (_, index) => media(`more-${index}.mp4`, 1080, 1080)),
      () => `more-${n++}`,
    );
    expect(FLEXIBLE_MAX_ASSETS).toBe(10);
    expect(second.assets).toHaveLength(10);
    expect(second.placed).toBe(6);
    expect(second.leftover).toBe(2);
    expect(second.focusIndex).toBe(4);
  });

  it('adds plain batch creatives and stops at 20', () => {
    const incoming = [
      media('pour-0.jpg', 1080, 1920),
      media('shelf-1.jpg', 1080, 1350),
      media('square-2.jpg', 1080, 1080),
      ...Array.from({ length: 19 }, (_, index) => media(`extra-${index}.mp4`, 720, 1280)),
    ];
    let n = 0;
    const result = appendBatchCreatives([], incoming, () => `id-${n++}`);
    expect(BATCH_MAX_CREATIVES).toBe(20);
    expect(result.placed).toBe(20);
    expect(result.leftover).toBe(2);
    expect(result.creatives).toHaveLength(20);
    expect(result.firstNewIndex).toBe(0);
    expect(result.creatives[0]).toMatchObject({
      originalName: 'pour-0.jpg',
      ratio: '9:16',
      productKey: '',
      productLabel: '',
      angle: '',
      handle: '',
      usageEndDate: '',
      perpetual: false,
      caption: '',
      assets: [],
      cards: [],
    });
    expect(result.creatives[0].media?.name).toBe('pour-0.jpg');
    expect(result.creatives[0].media?.bytes).toBe(2_400_000);
    expect(result.creatives[1].ratio).toBe('4:5');
    expect(result.creatives[2].ratio).toBe('1:1');
    expect(result.creatives[0]).not.toHaveProperty('userAdded');
    expect(SAMPLE_CREATIVES).toHaveLength(6);

    const blocked = appendBatchCreatives(result.creatives, [media('overflow.jpg', 1080, 1080)], () => 'overflow');
    expect(blocked.placed).toBe(0);
    expect(blocked.leftover).toBe(1);
    expect(blocked.creatives).toHaveLength(20);

    const oneMore = appendBatchCreatives(
      result.creatives.slice(0, 19),
      [media('last.jpg', 1000, 1000), media('skipped.jpg', 1600, 900)],
      () => 'last',
    );
    expect(oneMore.placed).toBe(1);
    expect(oneMore.leftover).toBe(1);
    expect(oneMore.firstNewIndex).toBe(19);
    expect(oneMore.creatives[19].originalName).toBe('last.jpg');
    expect(oneMore.creatives[19].ratio).toBe('1:1');
  });

  it('keeps a replaced batch file name and snaps that file’s ratio', () => {
    const [first] = appendBatchCreatives([], [media('pour-0.jpg', 1080, 1920)], () => 'id').creatives;
    const replaced = replaceBatchMedia(first, media('square.jpg', 800, 800));
    expect(replaced.originalName).toBe('square.jpg');
    expect(replaced.media?.name).toBe('square.jpg');
    expect(replaced.ratio).toBe('1:1');
    expect(replaced.productKey).toBe('');
    expect(batchFileNamePreview(replaced)).toEqual({
      fileName: 'square.jpg',
      renamed: false,
      label: 'Original name kept',
    });
  });

  it('renames a single creative from inputs and never renames a batch file', () => {
    const creative = {
      ...SAMPLE_CREATIVES[0],
      media: media('morning-reel.mp4', 1080, 1920),
      productKey: 'product:chicken-bone-broth',
      productLabel: 'Chicken Bone Broth',
      angle: 'Morning ritual',
    };
    expect(previewCreativeFileName(creative, 'Jane Doe', 'whitelist', null)).toEqual({
      fileName: 'jane-doe_whitelist_chicken-bone-broth_morning-ritual.mp4',
      renamed: true,
      label: 'Renamed from inputs',
    });
    const bare = { ...creative, productKey: '', productLabel: '', angle: '' };
    expect(previewCreativeFileName(bare, '', 'carousel', null)).toEqual({
      fileName: 'morning-reel.mp4',
      renamed: false,
      label: 'Original name kept',
    });
    expect(batchFileNamePreview(creative)).toEqual({
      fileName: 'morning-reel.mp4',
      renamed: false,
      label: 'Original name kept',
    });
  });

  it('moves a row and keeps the selection on it', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(followMove(0, 0, 2)).toBe(2);
    expect(followMove(2, 0, 2)).toBe(1);
    expect(followMove(1, 3, 0)).toBe(2);
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(2_400_000)).toBe('2.3 MB');
  });

  it('uses the navbar favicon for a website and initials when there is none', () => {
    expect(brandLogoUrl('https://www.shopmintier.com/')).toBe(
      'https://www.google.com/s2/favicons?domain=www.shopmintier.com&sz=64',
    );
    expect(brandLogoUrl('tallowtwins.ca')).toBe(
      'https://www.google.com/s2/favicons?domain=tallowtwins.ca&sz=64',
    );
    expect(brandLogoUrl(null)).toBeNull();
    expect(brandLogoUrl('   ')).toBeNull();
    expect(brandLogoUrl('not a url')).toBeNull();
    expect(brandInitials('Tallow Twins')).toBe('TT');
    expect(brandInitials('Mintier')).toBe('M');
    expect(brandInitials('FOND Regenerative')).toBe('FR');
    expect(brandInitials('')).toBe('');
  });
});
