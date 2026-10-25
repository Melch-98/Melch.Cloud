import { describe, expect, it } from 'vitest';
import {
  GENERIC_LANDING_OPTIONS,
  NO_PRODUCTS_SYNCED_NOTE,
  SAMPLE_CREATIVES,
  freeTextProductChoice,
  mapProductRows,
  productAfterBrandChange,
  productChoicesForBrand,
  productFileSlug,
  visibleProductChoices,
} from '@/components/upload-v2/model';

describe('upload-v2 product choices', () => {
  it('maps shopify rows to options and keeps the query order', () => {
    const products = mapProductRows([
      { title: '  Daily Greens ', handle: 'daily-greens' },
      { title: '', handle: 'no-title' },
      { title: 'Skip', handle: '   ' },
      { title: null, handle: null },
      { title: 'Daily Greens again', handle: 'daily-greens' },
      { title: 'Zinc', handle: 'zinc' },
    ]);

    expect(products).toEqual([
      { product_key: 'product:daily-greens', product_label: 'Daily Greens', product_kind: 'product' },
      { product_key: 'product:no-title', product_label: 'no-title', product_kind: 'product' },
      { product_key: 'product:zinc', product_label: 'Zinc', product_kind: 'product' },
    ]);
    expect(mapProductRows(null)).toEqual([]);
    expect(productFileSlug('product:daily-greens')).toBe('daily-greens');
  });

  it('appends only the generic landing choices', () => {
    expect(GENERIC_LANDING_OPTIONS.map((option) => option.product_label)).toEqual([
      'Homepage',
      'Shop All',
      'No landing page',
    ]);
    expect(GENERIC_LANDING_OPTIONS.map((option) => option.product_kind)).toEqual([
      'homepage',
      'shop_all',
      'none',
    ]);

    const choices = productChoicesForBrand([{ title: 'Zinc', handle: 'zinc' }]);
    expect(choices.map((choice) => choice.product_label)).toEqual([
      'Zinc',
      'Homepage',
      'Shop All',
      'No landing page',
    ]);
    expect(productChoicesForBrand([])).toEqual(GENERIC_LANDING_OPTIONS);
    expect(NO_PRODUCTS_SYNCED_NOTE).toBe('No products synced for this brand yet');
  });

  it('falls back to a typed product name when nothing is synced', () => {
    const catalog = productChoicesForBrand([]);

    expect(freeTextProductChoice('   ', catalog)).toBeNull();
    expect(freeTextProductChoice('!!!', catalog)).toBeNull();
    expect(freeTextProductChoice('homepage', catalog)).toMatchObject({
      product_key: 'homepage',
      product_label: 'Homepage',
    });
    expect(freeTextProductChoice('No landing page', catalog)?.product_key).toBe('none');
    expect(productFileSlug('none')).toBe('');

    const custom = freeTextProductChoice('  Summer Kit  ', catalog);
    expect(custom).toEqual({
      product_key: 'custom:summer-kit',
      product_label: 'Summer Kit',
      product_kind: 'product',
    });
    expect(productFileSlug(custom?.product_key ?? '')).toBe('summer-kit');

    const visible = visibleProductChoices({
      catalog,
      query: 'Summer Kit',
      selectedLabel: '',
      allowFreeText: true,
    });
    expect(visible.map((choice) => choice.product_key)).toEqual(['custom:summer-kit']);

    const withheld = visibleProductChoices({
      catalog: productChoicesForBrand([{ title: 'Zinc', handle: 'zinc' }]),
      query: 'Summer Kit',
      selectedLabel: '',
      allowFreeText: false,
    });
    expect(withheld).toEqual([]);

    expect(freeTextProductChoice('zinc', productChoicesForBrand([{ title: 'Zinc', handle: 'zinc' }]))?.product_key)
      .toBe('product:zinc');
  });

  it('clears a store product when the brand changes and leaves generic landings', () => {
    expect(productAfterBrandChange('product:zinc', 'Zinc')).toEqual({ productKey: '', productLabel: '' });
    expect(productAfterBrandChange('custom:summer-kit', 'Summer Kit')).toEqual({ productKey: '', productLabel: '' });
    expect(productAfterBrandChange('homepage', 'Homepage')).toEqual({
      productKey: 'homepage',
      productLabel: 'Homepage',
    });
    expect(productAfterBrandChange('', '')).toEqual({ productKey: '', productLabel: '' });
  });

  it('starts sample creatives with no product and no broth copy', () => {
    expect(SAMPLE_CREATIVES.length).toBeGreaterThan(0);
    for (const creative of SAMPLE_CREATIVES) {
      expect(creative.productKey).toBe('');
      expect(creative.productLabel).toBe('');
      const blob = JSON.stringify(creative).toLowerCase();
      expect(blob).not.toContain('broth');
      expect(blob).not.toContain('chicken');
    }
  });
});
