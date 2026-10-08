import { describe, expect, it } from 'vitest';
import { MIN_TOTAL_PIXELS, rasterMeetsMinimum, targetFrameSize } from '@/lib/auto-tag/image-size';
import { aggregateSummaryRows, matrixPageColumnKey, matrixSummaryColumnKey } from '@/lib/creative-matrix';
import { buildSharedTagPrompt, buildTagPrompt, normalizeAutoTag } from '@/lib/creative-auto-tag';
import { applyUserContextPatch, mergeAutoTagIntoContext, tagSourceForContext } from '@/lib/creative-tag-merge';
import { buildSubmissionFileRow, legacySubmissionFileRow, persistedTagSource } from '@/lib/creative-upload-plan';

const products = [{ id: '111', title: 'Daily Serum', handle: 'daily-serum' }];

function raw(overrides: Record<string, unknown> = {}) {
  return {
    creative_type: 'grwm',
    creative_type_confidence: 0.91,
    fidelity: 'high_def',
    fidelity_confidence: 0.99,
    product_id: '111',
    product_name: 'Not In The Catalog',
    product_confidence: 0.95,
    hook_angle: 'Tired skin at night',
    hook_angle_confidence: 0.8,
    ...overrides,
  };
}

describe('normalizeAutoTag', () => {
  it('keeps a real product and the matrix fidelity, ignoring a disagreeing model', () => {
    const tags = normalizeAutoTag(raw(), {
      products,
      mediaFormat: 'video',
      storefrontOrigin: 'https://shop.example',
    });
    expect(tags.creative_type).toBe('grwm');
    expect(tags.fidelity).toBe('lofi');
    expect(tags.product_name).toBe('Daily Serum');
    expect(tags.landing_page_url).toBe('https://shop.example/products/daily-serum');
    expect(matrixPageColumnKey(tags.creative_type)).toBe('lofi_video');
    expect(matrixSummaryColumnKey(tags.creative_type)).toBe('lofi_video');
    expect(
      aggregateSummaryRows([
        { product_name: tags.product_name, creative_type: tags.creative_type, fidelity: tags.fidelity },
      ])
    ).toEqual([{ product_name: 'Daily Serum', creative_type: 'grwm', fidelity: 'lofi', count: 1 }]);
  });

  it('maps a high-def still into the page and summary columns', () => {
    const tags = normalizeAutoTag(
      raw({ creative_type: 'ecom_product_shots', product_id: '111' }),
      { products, mediaFormat: 'static', storefrontOrigin: 'https://shop.example' }
    );
    expect(tags.fidelity).toBe('high_def');
    expect(matrixPageColumnKey(tags.creative_type)).toBe('hd_static');
    expect(matrixSummaryColumnKey(tags.creative_type)).toBe('high_def_static');
  });

  it('nulls low confidence, unknown products, and a format mismatch', () => {
    const low = normalizeAutoTag(raw({ creative_type_confidence: 0.2, product_confidence: 0.1, hook_angle_confidence: 0.4 }), {
      products,
      mediaFormat: 'video',
      storefrontOrigin: 'https://shop.example',
    });
    expect(low.creative_type).toBeNull();
    expect(low.product_id).toBeNull();
    expect(low.hook_angle).toBeNull();

    const unknown = normalizeAutoTag(raw({ product_id: 'nope', product_name: 'Invented Oil' }), {
      products,
      mediaFormat: 'video',
    });
    expect(unknown.product_id).toBeNull();

    const mismatch = normalizeAutoTag(raw(), { products, mediaFormat: 'static' });
    expect(mismatch.creative_type).toBeNull();
    expect(mismatch.fidelity).toBeNull();
  });

  it('rejects a product at 0.7 and keeps the creative type', () => {
    const tags = normalizeAutoTag(raw({ product_confidence: 0.7 }), {
      products,
      mediaFormat: 'video',
      storefrontOrigin: 'https://shop.example',
    });
    expect(tags.creative_type).toBe('grwm');
    expect(tags.product_id).toBeNull();
    expect(tags.product_name).toBeNull();
    expect(tags.landing_page_url).toBeNull();

    const accepted = normalizeAutoTag(raw({ product_confidence: 0.8 }), {
      products,
      mediaFormat: 'video',
      storefrontOrigin: 'https://shop.example',
    });
    expect(accepted.product_id).toBe('111');
    expect(accepted.product_name).toBe('Daily Serum');
  });
});

describe('tag prompt cache order', () => {
  it('puts the brand and catalog before the file name, and tells ties to return null', () => {
    const catalog = [
      { id: '1', title: 'Ginger & Cayenne 8 pack FBM', handle: 'ginger-8' },
      { id: '2', title: 'FOND Beef Bone Broth', handle: 'beef' },
    ];
    const shared = buildSharedTagPrompt({
      brandName: 'FOND',
      storefront: 'https://fond.example',
      products: catalog,
    });
    const first = buildTagPrompt({
      brandName: 'FOND',
      storefront: 'https://fond.example',
      products: catalog,
      fileName: 'clip-a.mp4',
      mediaFormat: 'video',
      aspectRatio: '9x16',
    });
    const second = buildTagPrompt({
      brandName: 'FOND',
      storefront: 'https://fond.example',
      products: catalog,
      fileName: 'clip-b.jpg',
      mediaFormat: 'static',
      aspectRatio: '1x1',
    });
    expect(shared.includes('File name:')).toBe(false);
    expect(first.startsWith(shared)).toBe(true);
    expect(second.startsWith(shared)).toBe(true);
    expect(first.indexOf('Ginger & Cayenne 8 pack FBM')).toBeLessThan(first.indexOf('File name:'));
    expect(shared).toContain('0.8');
    expect(shared.toLowerCase()).toContain('pack size');
    expect(shared.toLowerCase()).toContain('variant');
  });
});

describe('merge locks', () => {
  it('does not overwrite a field the user already edited', () => {
    const tags = normalizeAutoTag(raw(), { products, mediaFormat: 'video', storefrontOrigin: 'https://shop.example' });
    const locked = applyUserContextPatch(undefined, { creativeType: 'founder_story', hookAngle: 'Mine' });
    const merged = mergeAutoTagIntoContext(locked, tags);
    expect(merged.creativeType).toBe('founder_story');
    expect(merged.hookAngle).toBe('Mine');
    expect(merged.productName).toBe('Daily Serum');
    expect(merged.autoFilled).toContain('productId');
    expect(merged.autoFilled).not.toContain('creativeType');
    expect(tagSourceForContext(merged)).toBe('mixed');
  });

  it('a product pick can fill the landing page without locking it', () => {
    const next = applyUserContextPatch(
      undefined,
      { productId: '111', productName: 'Daily Serum', landingPageUrl: 'https://shop.example/products/daily-serum' },
      ['productId']
    );
    expect(next.lockedFields?.productId).toBe(true);
    expect(next.lockedFields?.landingPageUrl).toBeUndefined();
  });

  it('a missing vision key does not leave the row pending', () => {
    expect(persistedTagSource({ tagStatus: 'running' }, false)).toBeNull();
    expect(persistedTagSource({ tagStatus: 'running' }, true)).toBe('pending');
    expect(tagSourceForContext({ tagStatus: 'skipped' })).toBeNull();
  });
});

describe('submission file row', () => {
  it('keeps the original name and drops new columns on the legacy retry', () => {
    const row = buildSubmissionFileRow({
      submissionId: 'sub',
      storagePath: 'brand/batch/IMG_1.mp4',
      proposedFileName: 'TallowTwins_15s.mp4',
      originalFileName: 'IMG_1.mp4',
      fileType: 'video/mp4',
      fileSize: 10,
      context: { tagStatus: 'running', creativeType: '' },
      frames: ['data:image/jpeg;base64,abc'],
      visionConfigured: true,
    });
    expect(row.file_name).toBe('TallowTwins_15s.mp4');
    expect(row.original_file_name).toBe('IMG_1.mp4');
    expect(row.tag_source).toBe('pending');
    expect((row.auto_tags as { frames?: string[] }).frames).toHaveLength(1);

    const legacy = legacySubmissionFileRow(row);
    expect(legacy.file_name).toBe('IMG_1.mp4');
    expect(legacy.original_file_name).toBeUndefined();
    expect(legacy.auto_tags).toBeUndefined();
    expect(legacy.tag_source).toBeUndefined();
  });

  it('does not store frames when vision is not configured', () => {
    const row = buildSubmissionFileRow({
      submissionId: 'sub',
      storagePath: 'path',
      proposedFileName: 'Named.jpg',
      originalFileName: 'shot.jpg',
      fileType: 'image/jpeg',
      fileSize: 4,
      context: { tagStatus: 'skipped' },
      frames: ['data:image/jpeg;base64,abc'],
      visionConfigured: false,
    });
    expect(row.tag_source).toBeNull();
    expect((row.auto_tags as { frames?: string[] }).frames).toBeUndefined();
  });
});

describe('frame size', () => {
  it('targets about 768px on the long side and refuses a zero size', () => {
    expect(targetFrameSize(2000, 1000)).toEqual({ width: 768, height: 384 });
    expect(targetFrameSize(100, 50)).toEqual({ width: 768, height: 384 });
    expect(targetFrameSize(0, 10)).toBeNull();
  });

  it('skips a raster under 512 pixels and keeps one we cannot measure', () => {
    expect(rasterMeetsMinimum(png(10, 10))).toBe(false);
    expect(10 * 10).toBeLessThan(MIN_TOTAL_PIXELS);
    expect(rasterMeetsMinimum(png(32, 16))).toBe(true);
    expect(rasterMeetsMinimum(new Uint8Array([1, 2, 3, 4]))).toBe(true);
  });
});

function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes[16] = (width >>> 24) & 255;
  bytes[17] = (width >>> 16) & 255;
  bytes[18] = (width >>> 8) & 255;
  bytes[19] = width & 255;
  bytes[20] = (height >>> 24) & 255;
  bytes[21] = (height >>> 16) & 255;
  bytes[22] = (height >>> 8) & 255;
  bytes[23] = height & 255;
  return bytes;
}
