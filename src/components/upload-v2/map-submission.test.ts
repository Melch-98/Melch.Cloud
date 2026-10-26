import { describe, expect, it } from 'vitest';
import {
  dedupeStoredFileNames,
  mapV2Submission,
  productColumns,
  v2SubmitBlocker,
  type MapV2Input,
} from '@/components/upload-v2/map-submission';
import type { CarouselCard, Creative, FlexibleAsset, LocalMedia, UploadModes } from '@/components/upload-v2/model';

function file(name: string, type: string, bytes = 1200): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

function local(
  source: File,
  width: number,
  height: number,
  detected: LocalMedia['detectedAspectRatio'],
): LocalMedia {
  return {
    url: `blob:${source.name}`,
    kind: source.type.startsWith('video/') ? 'video' : 'image',
    name: source.name,
    bytes: source.size,
    width,
    height,
    file: source,
    mediaFormat: source.type.startsWith('video/') ? 'VIDEO' : 'STATIC',
    detectedAspectRatio: detected,
  };
}

function creative(partial: Partial<Creative> = {}): Creative {
  return {
    id: 'creative-1',
    name: 'Creative',
    originalName: 'file.jpg',
    caption: '',
    productKey: '',
    productLabel: '',
    angle: '',
    handle: '',
    usageEndDate: '',
    perpetual: false,
    ratio: '1:1',
    kicker: '',
    from: '#111',
    to: '#222',
    media: null,
    assets: [],
    cards: [],
    ...partial,
  };
}

function card(id: string, media: LocalMedia | null, headline = ''): CarouselCard {
  return { id, headline, kicker: '', from: '#111', to: '#222', media };
}

function asset(id: string, media: LocalMedia): FlexibleAsset {
  return { id, media };
}

function modes(partial: Partial<UploadModes> = {}): UploadModes {
  return { whitelist: false, carousel: false, flexible: false, ...partial };
}

function input(partial: Partial<MapV2Input> = {}): MapV2Input {
  return {
    brandId: 'brand-1',
    userId: 'user-1',
    batchName: 'MNT_261025_0001',
    creatorName: '',
    modes: modes(),
    creative: creative(),
    plainCreatives: [],
    ...partial,
  };
}

describe('dedupeStoredFileNames', () => {
  it('suffixes collisions with -2 and -3 before the extension', () => {
    expect(dedupeStoredFileNames(['a.jpg', 'a.jpg', 'a.jpg'])).toEqual(['a.jpg', 'a-2.jpg', 'a-3.jpg']);
    expect(dedupeStoredFileNames(['a.jpg', 'a-2.jpg', 'a.jpg'])).toEqual(['a.jpg', 'a-2.jpg', 'a-3.jpg']);
    expect(dedupeStoredFileNames(['clip'])).toEqual(['clip']);
  });
});

describe('mapV2Submission', () => {
  it('maps a whitelist creative and keeps the detected aspect off the crop target', () => {
    const source = file('morning.mp4', 'video/mp4', 4000);
    const mapped = mapV2Submission(input({
      creatorName: '  Jane Doe  ',
      modes: modes({ whitelist: true }),
      creative: creative({
        caption: '  Hold the frame  ',
        productKey: 'product:chicken-bone-broth',
        productLabel: 'Chicken Bone Broth',
        angle: 'Morning ritual',
        handle: ' @jane ',
        usageEndDate: '2026-12-31',
        perpetual: false,
        ratio: '1:1',
      }),
      plainCreatives: [creative({ media: local(source, 1080, 1920, '9x16') })],
    }));

    expect(mapped.submission).toMatchObject({
      brand_id: 'brand-1',
      user_id: 'user-1',
      drive_sync_status: 'pending',
      batch_name: 'MNT_261025_0001',
      creative_type: 'video',
      creator_name: 'Jane Doe',
      creator_social_handle: '@jane',
      copy_body: 'Hold the frame',
      is_carousel: false,
      is_flexible: false,
      is_whitelist: true,
      usage_end_date: '2026-12-31',
      file_count: 1,
    });
    expect(mapped.submission.creative_type).not.toBe('whitelist');
    expect(mapped.files).toHaveLength(1);
    expect(mapped.files[0].file).toBe(source);
    expect(mapped.files[0].row).toMatchObject({
      file_name: 'jane-doe_whitelist_chicken-bone-broth_morning-ritual.mp4',
      original_file_name: 'morning.mp4',
      file_type: 'video/mp4',
      file_size: 4000,
      media_format: 'VIDEO',
      aspect_ratio: '9x16',
      width: 1080,
      height: 1920,
      product_id: null,
      product_name: 'Chicken Bone Broth',
      hook_angle: 'Morning ritual',
      copy_headline: null,
    });
  });

  it('stores a null usage date when the whitelist is perpetual', () => {
    const source = file('ever.jpg', 'image/jpeg');
    const mapped = mapV2Submission(input({
      modes: modes({ whitelist: true }),
      creative: creative({
        perpetual: true,
        usageEndDate: '2020-01-01',
      }),
      plainCreatives: [creative({ media: local(source, 1080, 1080, '1x1') })],
    }));
    expect(mapped.submission.usage_end_date).toBeNull();
    expect(mapped.submission.creative_type).toBe('static');
    expect(mapped.files[0].row.file_name).toBe('ever.jpg');
    expect(mapped.files[0].row.original_file_name).toBe('ever.jpg');
  });

  it('keeps the original name when creator, product, and angle are empty', () => {
    const source = file('shelf.jpg', 'image/jpeg');
    const mapped = mapV2Submission(input({
      modes: modes({ carousel: true }),
      creative: creative({
        angle: '   ',
        cards: [card('a', local(source, 1080, 1350, '4x5'), '  ')],
      }),
    }));
    expect(mapped.files[0].row.file_name).toBe('shelf.jpg');
    expect(mapped.files[0].row.hook_angle).toBeNull();
    expect(mapped.files[0].row.copy_headline).toBeNull();
  });

  it('maps a carousel of 3 and suffixes colliding renamed names', () => {
    const files = ['a.jpg', 'b.jpg', 'c.jpg'].map((name) => file(name, 'image/jpeg'));
    const mapped = mapV2Submission(input({
      creatorName: 'Jane',
      modes: modes({ carousel: true }),
      creative: creative({
        productKey: 'product:serum',
        productLabel: 'Serum',
        angle: 'Morning',
        caption: 'Three cards',
        handle: '@ignored',
        usageEndDate: '2026-12-31',
        cards: [
          card('1', local(files[0], 1080, 1350, '4x5'), 'Open'),
          card('2', null),
          card('3', local(files[1], 1080, 1920, '9x16'), 'Hold'),
          card('4', local(files[2], 1920, 1080, '16x9'), 'Close'),
        ],
      }),
    }));

    expect(mapped.submission).toMatchObject({
      creative_type: 'carousel',
      creator_name: 'Jane',
      creator_social_handle: null,
      copy_body: 'Three cards',
      is_carousel: true,
      is_flexible: false,
      is_whitelist: false,
      usage_end_date: null,
      file_count: 3,
    });
    expect(mapped.files.map((item) => item.row.file_name)).toEqual([
      'jane_carousel_serum_morning.jpg',
      'jane_carousel_serum_morning-2.jpg',
      'jane_carousel_serum_morning-3.jpg',
    ]);
    expect(mapped.files.map((item) => item.row.original_file_name)).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
    expect(mapped.files.map((item) => item.row.copy_headline)).toEqual(['Open', 'Hold', 'Close']);
    expect(mapped.files.map((item) => item.row.aspect_ratio)).toEqual(['4x5', '9x16', '16x9']);
    expect(mapped.files.every((item) => item.row.product_name === 'Serum' && item.row.product_id === null)).toBe(true);
    expect(mapped.files.every((item) => item.row.hook_angle === 'Morning')).toBe(true);
  });

  it('maps a flexible creative of 3 as flexible even when the files are mixed', () => {
    const files = [
      file('one.jpg', 'image/jpeg'),
      file('two.mp4', 'video/mp4'),
      file('three.png', 'image/png'),
    ];
    const mapped = mapV2Submission(input({
      modes: modes({ flexible: true }),
      creative: creative({
        assets: [
          asset('1', local(files[0], 1080, 1080, '1x1')),
          asset('2', local(files[1], 1080, 1920, '9x16')),
          asset('3', local(files[2], 1000, 1100, 'OTHER')),
        ],
      }),
    }));
    expect(mapped.submission).toMatchObject({
      creative_type: 'flexible',
      is_carousel: false,
      is_flexible: true,
      is_whitelist: false,
      file_count: 3,
      usage_end_date: null,
    });
    expect(mapped.submission.is_carousel && mapped.submission.is_flexible).toBe(false);
    expect(mapped.files.map((item) => item.row.media_format)).toEqual(['STATIC', 'VIDEO', 'STATIC']);
    expect(mapped.files.map((item) => item.row.file_name)).toEqual(['one.jpg', 'two.mp4', 'three.png']);
  });

  it('maps the default plain list as bulk creatives and dedupes original names', () => {
    const names = ['pour.jpg', 'shelf.jpg', 'pour.jpg', 'grid.png'];
    const plainCreatives = names.map((name, index) => creative({
      id: `b-${index}`,
      caption: 'should not land on the submission',
      productKey: 'product:ignored',
      productLabel: 'Ignored',
      angle: 'Ignored',
      handle: '@ignored',
      usageEndDate: '2026-12-31',
      media: local(file(name, 'image/png'), 1080, 1350, '4x5'),
    }));
    const mapped = mapV2Submission(input({
      creatorName: 'Jane Doe',
      creative: creative({
        caption: 'should not land on the submission',
        productKey: 'product:ignored',
        productLabel: 'Ignored',
        angle: 'Ignored',
        handle: '@jane',
        usageEndDate: '2026-12-31',
      }),
      plainCreatives,
    }));

    expect(mapped.submission).toMatchObject({
      creative_type: 'static',
      creator_name: '',
      creator_social_handle: null,
      copy_body: '',
      is_carousel: false,
      is_flexible: false,
      is_whitelist: false,
      usage_end_date: null,
      file_count: 4,
    });
    expect(mapped.files.map((item) => item.row.file_name)).toEqual([
      'pour.jpg',
      'shelf.jpg',
      'pour-2.jpg',
      'grid.png',
    ]);
    expect(mapped.files.map((item) => item.row.original_file_name)).toEqual(names);
    expect(mapped.files.every((item) => item.row.product_name === null && item.row.hook_angle === null)).toBe(true);
  });

  it('maps plain whitelist creatives with the whitelist slug and a shared usage date', () => {
    const names = ['pour.jpg', 'shelf.jpg'];
    const mapped = mapV2Submission(input({
      creatorName: 'Jane',
      modes: modes({ whitelist: true }),
      creative: creative({
        productKey: 'product:serum',
        productLabel: 'Serum',
        angle: 'Morning',
        handle: '@jane',
        usageEndDate: '2026-12-31',
        caption: 'Whitelisted',
      }),
      plainCreatives: names.map((name, index) => creative({
        id: `p-${index}`,
        productKey: 'product:ignored',
        productLabel: 'Ignored',
        angle: 'Ignored',
        media: local(file(name, 'image/jpeg'), 1080, 1350, '4x5'),
      })),
    }));
    expect(mapped.submission).toMatchObject({
      creative_type: 'static',
      creator_name: 'Jane',
      creator_social_handle: '@jane',
      copy_body: 'Whitelisted',
      is_carousel: false,
      is_flexible: false,
      is_whitelist: true,
      usage_end_date: '2026-12-31',
      file_count: 2,
    });
    expect(mapped.files.map((item) => item.row.file_name)).toEqual([
      'jane_whitelist_serum_morning.jpg',
      'jane_whitelist_serum_morning-2.jpg',
    ]);
    expect(mapped.files.every((item) => item.row.product_name === 'Serum' && item.row.hook_angle === 'Morning')).toBe(true);
  });

  it('lets whitelist sit on a carousel and drops flexible when both structure chips are set', () => {
    const source = file('card.jpg', 'image/jpeg');
    const mapped = mapV2Submission(input({
      creatorName: 'Jane',
      modes: modes({ whitelist: true, carousel: true, flexible: true }),
      creative: creative({
        handle: '@jane',
        usageEndDate: '2026-12-31',
        productKey: 'product:serum',
        productLabel: 'Serum',
        angle: 'Morning',
        cards: [card('1', local(source, 1080, 1350, '4x5'), 'Open')],
        assets: [asset('x', local(file('asset.jpg', 'image/jpeg'), 1080, 1080, '1x1'))],
      }),
    }));
    expect(mapped.submission).toMatchObject({
      creative_type: 'carousel',
      creator_name: 'Jane',
      creator_social_handle: '@jane',
      is_carousel: true,
      is_flexible: false,
      is_whitelist: true,
      usage_end_date: '2026-12-31',
      file_count: 1,
    });
    expect(mapped.files[0].row.file_name).toBe('jane_carousel_serum_morning.jpg');
    expect(mapped.files[0].row.copy_headline).toBe('Open');
  });

  it('does not treat homepage or a missing file as a product upload', () => {
    expect(productColumns('homepage', 'Homepage')).toEqual({ product_id: null, product_name: null });
    expect(productColumns('shop_all', 'Shop All')).toEqual({ product_id: null, product_name: null });
    expect(productColumns('none', 'No landing page')).toEqual({ product_id: null, product_name: null });
    expect(productColumns('custom:broth', 'Broth')).toEqual({ product_id: null, product_name: 'Broth' });

    const mapped = mapV2Submission(input({
      creative: creative({
        productKey: 'homepage',
        productLabel: 'Homepage',
        media: { ...local(file('home.jpg', 'image/jpeg'), 1080, 1080, '1x1'), file: null },
      }),
    }));
    expect(mapped.files).toHaveLength(0);
    expect(mapped.submission.file_count).toBe(0);
  });
});

describe('v2SubmitBlocker', () => {
  const today = '2026-10-25';

  it('requires a brand, a file, and a usable whitelist date', () => {
    const base = {
      modes: modes({ whitelist: true }),
      creative: creative(),
      plainCreatives: [],
      today,
    };
    expect(v2SubmitBlocker(base)).toBe('Choose a brand');
    expect(v2SubmitBlocker({ ...base, brandId: 'brand-1' })).toBe('Add at least one file');
    expect(v2SubmitBlocker({
      ...base,
      brandId: 'brand-1',
      creative: creative({
        usageEndDate: '2026-10-01',
        media: local(file('a.jpg', 'image/jpeg'), 1080, 1080, '1x1'),
      }),
      plainCreatives: [creative({ media: local(file('a.jpg', 'image/jpeg'), 1080, 1080, '1x1') })],
    })).toBe('Usage end date must be today or later');
    expect(v2SubmitBlocker({
      ...base,
      brandId: 'brand-1',
      creative: creative({
        perpetual: true,
        usageEndDate: '2020-01-01',
        media: local(file('a.jpg', 'image/jpeg'), 1080, 1080, '1x1'),
      }),
      plainCreatives: [creative({ media: local(file('a.jpg', 'image/jpeg'), 1080, 1080, '1x1') })],
    })).toBeNull();
    expect(v2SubmitBlocker({
      ...base,
      brandId: 'brand-1',
      creative: creative({
        usageEndDate: '',
        media: local(file('a.jpg', 'image/jpeg'), 1080, 1080, '1x1'),
      }),
      plainCreatives: [creative({ media: local(file('a.jpg', 'image/jpeg'), 1080, 1080, '1x1') })],
    })).toBeNull();
  });

  it('does not apply the whitelist date rule to the default plain list', () => {
    expect(v2SubmitBlocker({
      brandId: 'brand-1',
      modes: modes(),
      creative: creative({ usageEndDate: '1999-01-01' }),
      plainCreatives: [creative({ media: local(file('a.jpg', 'image/jpeg'), 1080, 1080, '1x1') })],
      today,
    })).toBeNull();
  });

  it('blocks a carousel that is under 2 cards or over 10', () => {
    const one = [creative({ media: local(file('a.jpg', 'image/jpeg'), 1080, 1080, '1x1') })];
    const cards = (count: number) => Array.from({ length: count }, (_, index) => (
      card(String(index), local(file(`c-${index}.jpg`, 'image/jpeg'), 1080, 1080, '1x1'))
    ));
    expect(v2SubmitBlocker({
      brandId: 'brand-1',
      modes: modes({ carousel: true }),
      creative: creative({ cards: cards(1) }),
      plainCreatives: one,
      today,
    })).toBe('A carousel needs at least 2 cards.');
    expect(v2SubmitBlocker({
      brandId: 'brand-1',
      modes: modes({ carousel: true }),
      creative: creative({ cards: cards(15) }),
      plainCreatives: [],
      today,
    })).toBe('Carousel holds 10 cards. 5 files are over the limit. Remove them or turn Carousel off.');
    expect(v2SubmitBlocker({
      brandId: 'brand-1',
      modes: modes({ flexible: true }),
      creative: creative({
        assets: Array.from({ length: 12 }, (_, index) => (
          asset(String(index), local(file(`a-${index}.jpg`, 'image/jpeg'), 1080, 1080, '1x1'))
        )),
      }),
      plainCreatives: [],
      today,
    })).toBe('A flexible creative holds 10 assets. 2 files are over the limit. Remove them or turn Flexible off.');
  });
});
