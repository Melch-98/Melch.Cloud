import { describe, expect, it } from 'vitest';
import { draftsFromAd } from '@/lib/live-creatives/assets';

const hosts = ['mintier.com'];
const products = [
  { handle: 'tallow-balm', title: 'Tallow Balm' },
  { handle: 'soap', title: 'Soap Bar' },
];

function draft(creative: Record<string, unknown>, adset?: { dynamic?: boolean; productSetId?: string }) {
  return draftsFromAd({
    brandId: 'brand-1',
    adId: 'ad-1',
    adName: 'Balm ad',
    creativeId: 'cr-1',
    creative,
    adset,
    hosts,
    products,
  });
}

describe('draftsFromAd', () => {
  it('stores every carousel card and uses the first card as the product', () => {
    const rows = draft({
      id: 'cr-1',
      object_story_spec: {
        link_data: {
          child_attachments: [
            { link: 'https://mintier.com/products/tallow-balm?utm_source=fb', image_hash: 'card-1', name: 'Balm' },
            { link: 'https://mintier.com/products/soap', image_hash: 'card-2', name: 'Soap' },
            { link: 'https://mintier.com/collections/all', image_hash: 'card-3', name: 'All' },
          ],
        },
      },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      asset_key: 'card-1',
      format: 'Carousel',
      product_key: 'product:tallow-balm',
      product_label: 'Tallow Balm',
      product_kind: 'product',
      asset_name: 'Balm',
    });
    expect(rows[0].card_products?.map((card) => card.product_key)).toEqual([
      'product:tallow-balm',
      'product:soap',
      'shop_all',
    ]);
  });

  it('writes one flexible row per image hash and video id', () => {
    const rows = draft({
      id: 'cr-1',
      asset_feed_spec: {
        ad_formats: ['AUTOMATIC_FORMAT'],
        images: [
          { hash: 'hash-a', url: 'https://cdn.example/a.jpg' },
          { hash: 'hash-b' },
        ],
        videos: [{ video_id: 'vid-1', thumbnail_url: 'https://cdn.example/v.jpg' }],
        link_urls: [
          { website_url: 'https://mintier.com/products/tallow-balm' },
          { website_url: 'https://mintier.com/products/soap' },
          { website_url: 'https://mintier.com/' },
        ],
      },
    });
    expect(rows.map((row) => ({
      asset_key: row.asset_key,
      format: row.format,
      product_key: row.product_key,
      thumbnail_url: row.thumbnail_url,
    }))).toEqual([
      { asset_key: 'hash-a', format: 'Flexible', product_key: 'product:tallow-balm', thumbnail_url: 'https://cdn.example/a.jpg' },
      { asset_key: 'hash-b', format: 'Flexible', product_key: 'product:soap', thumbnail_url: null },
      { asset_key: 'vid-1', format: 'Flexible', product_key: 'homepage', thumbnail_url: 'https://cdn.example/v.jpg' },
    ]);
  });

  it('shares one asset-feed link across flexible assets', () => {
    const rows = draft({
      asset_feed_spec: {
        optimization_type: 'FORMAT_AUTOMATION',
        images: [{ hash: 'hash-a' }, { hash: 'hash-b' }],
        link_urls: [{ website_url: 'https://mintier.com/products/soap' }],
      },
    });
    expect(rows.map((row) => row.product_key)).toEqual(['product:soap', 'product:soap']);
  });

  it('uses catalog:{ad_id} for a catalog ad', () => {
    const rows = draft({
      product_set_id: 'ps_1',
      object_story_spec: {
        template_data: { link: 'https://mintier.com/products/tallow-balm' },
      },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      asset_key: 'catalog:ad-1',
      format: 'Catalog',
      product_key: 'product:tallow-balm',
      product_label: 'Tallow Balm',
    });
  });

  it('reads a video call-to-action link and an image link', () => {
    const video = draft({
      object_story_spec: {
        video_data: {
          video_id: 'vid-9',
          call_to_action: { value: { link: 'https://mintier.com/' } },
        },
      },
    });
    expect(video[0]).toMatchObject({ asset_key: 'vid-9', format: 'Video', product_key: 'homepage' });

    const image = draft({
      image_hash: 'still-1',
      object_story_spec: {
        link_data: { link: 'https://mintier.com/en-us/products/soap?utm_campaign=asc' },
      },
    });
    expect(image[0]).toMatchObject({ asset_key: 'still-1', format: 'Image', product_key: 'product:soap' });
  });
});
