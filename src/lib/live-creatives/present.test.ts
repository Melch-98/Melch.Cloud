import { describe, expect, it } from 'vitest';
import { adMatchesProduct, adProductKeys, groupAdsByProduct, type LiveCreativeView } from '@/lib/live-creatives/present';

function row(partial: Partial<LiveCreativeView> & Pick<LiveCreativeView, 'ad_id' | 'asset_key' | 'product_key' | 'product_label'>): LiveCreativeView {
  return {
    product_kind: 'product',
    product_source: 'url',
    card_products: null,
    ...partial,
  };
}

describe('groupAdsByProduct', () => {
  it('splits flexible spend across assets and recomputes ROAS and CPA from the sums', () => {
    const rows = new Map<string, LiveCreativeView[]>([
      ['ad-1', [
        row({ ad_id: 'ad-1', asset_key: 'a', product_key: 'product:soap', product_label: 'Soap Bar' }),
        row({ ad_id: 'ad-1', asset_key: 'b', product_key: 'product:soap', product_label: 'Soap Bar' }),
      ]],
      ['ad-2', [
        row({ ad_id: 'ad-2', asset_key: 'c', product_key: 'product:soap', product_label: 'Soap Bar' }),
        row({ ad_id: 'ad-2', asset_key: 'd', product_key: 'homepage', product_label: 'Homepage', product_kind: 'homepage' }),
      ]],
    ]);
    const groups = groupAdsByProduct([
      { ad_id: 'ad-1', spend: 10, purchase_value: 30, purchases: 2 },
      { ad_id: 'ad-2', spend: 8, purchase_value: 4, purchases: 1 },
    ], rows);
    const soap = groups.find((group) => group.product_key === 'product:soap');
    const home = groups.find((group) => group.product_key === 'homepage');
    expect(soap).toMatchObject({ creatives: 3, spend: 14, purchase_value: 32, purchases: 2.5 });
    expect(soap?.roas).toBeCloseTo(32 / 14);
    expect(soap?.cpa).toBeCloseTo(14 / 2.5);
    expect(home).toMatchObject({ creatives: 1, spend: 4, purchase_value: 2, purchases: 0.5 });
    expect(home?.roas).toBeCloseTo(2 / 4);
    expect(home?.cpa).toBeCloseTo(4 / 0.5);
  });

  it('keeps carousel spend on the first card and still matches the other cards in the filter', () => {
    const carousel = row({
      ad_id: 'ad-9',
      asset_key: 'card-1',
      product_key: 'product:soap',
      product_label: 'Soap Bar',
      card_products: [
        { product_key: 'product:soap', product_label: 'Soap Bar', product_kind: 'product' },
        { product_key: 'shop_all', product_label: 'Shop All', product_kind: 'shop_all' },
      ],
    });
    const rows = new Map([['ad-9', [carousel]]]);
    expect(adProductKeys([carousel])).toEqual(['product:soap', 'shop_all']);
    expect(adMatchesProduct([carousel], ['shop_all'])).toBe(true);
    expect(adMatchesProduct([carousel], ['homepage'])).toBe(false);
    const [group] = groupAdsByProduct([{ ad_id: 'ad-9', spend: 20, purchase_value: 40, purchases: 4 }], rows);
    expect(group).toMatchObject({ product_key: 'product:soap', creatives: 1, spend: 20, roas: 2, cpa: 5 });
  });
});
