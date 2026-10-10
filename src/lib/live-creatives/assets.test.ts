import { describe, expect, it } from 'vitest';
import { draftsFromAd } from '@/lib/live-creatives/assets';

const hosts = ['mintier.com'];
const products = [
  { handle: 'tallow-balm', title: 'Tallow Balm' },
  { handle: 'soap', title: 'Soap Bar' },
];

function draft(
  creative: Record<string, unknown>,
  adset?: { dynamic?: boolean; productSetId?: string },
  post?: Parameters<typeof draftsFromAd>[0]['post'],
) {
  return draftsFromAd({
    brandId: 'brand-1',
    adId: 'ad-1',
    adName: 'Balm ad',
    creativeId: 'cr-1',
    creative,
    adset,
    post,
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

  it('reads a Facebook post call-to-action link', () => {
    const rows = draft(
      { effective_object_story_id: '10_20', name: 'Boosted post' },
      undefined,
      { call_to_action: { type: 'SHOP_NOW', value: { link: 'https://mintier.com/products/tallow-balm?utm_source=fb' } } },
    );
    expect(rows[0]).toMatchObject({
      product_key: 'product:tallow-balm',
      product_label: 'Tallow Balm',
      product_kind: 'product',
    });
    expect(rows[0].landing_url).toContain('mintier.com/products/tallow-balm');
  });

  it('unwraps an attachment unshimmed_url behind l.facebook.com', () => {
    const wrapped = `https://l.facebook.com/l.php?u=${encodeURIComponent('https://mintier.com/products/soap?utm_source=fb')}&h=AT0`;
    const rows = draft(
      { effective_object_story_id: '10_21' },
      undefined,
      { attachments: { data: [{ unshimmed_url: wrapped, type: 'share' }] } },
    );
    expect(rows[0]).toMatchObject({ product_key: 'product:soap', product_label: 'Soap Bar' });
    expect(rows[0].landing_url).not.toContain('l.facebook.com');
    expect(rows[0].landing_url).toContain('mintier.com/products/soap');
  });

  it('fills carousel card landings from post subattachments', () => {
    const rows = draft(
      { effective_object_story_id: '10_22', name: 'Carousel post' },
      undefined,
      {
        attachments: {
          data: [{
            type: 'album',
            subattachments: {
              data: [
                { unshimmed_url: 'https://mintier.com/products/tallow-balm' },
                { url: 'https://mintier.com/products/soap' },
                { unshimmed_url: `https://l.facebook.com/l.php?u=${encodeURIComponent('https://mintier.com/collections/all')}` },
              ],
            },
          }],
        },
      },
    );
    expect(rows[0].format).toBe('Carousel');
    expect(rows[0].card_products?.map((card) => card.product_key)).toEqual([
      'product:tallow-balm',
      'product:soap',
      'shop_all',
    ]);
    expect(rows[0].product_key).toBe('product:tallow-balm');
  });

  it('uses the creative call to action for an Instagram-only post', () => {
    const rows = draft({
      name: 'Instagram post: Summer reel',
      effective_instagram_media_id: '178900',
      effective_object_story_id: '10_23',
      call_to_action: { type: 'LEARN_MORE', value: { link: 'https://mintier.com/products/soap' } },
    });
    expect(rows[0]).toMatchObject({ product_key: 'product:soap', product_kind: 'product' });
  });

  it('prefers site_links_spec and otherwise labels a product set', () => {
    const withLink = draft({
      product_set_id: 'ps_9',
      creative_sourcing_spec: {
        associated_product_set_id: 'ps_9',
        site_links_spec: [{ site_link_title: 'Soap', site_link_url: 'https://mintier.com/products/soap' }],
      },
    });
    expect(withLink[0]).toMatchObject({ product_key: 'product:soap', product_kind: 'product' });

    const setOnly = draft({
      creative_sourcing_spec: { associated_product_set_id: 'ps_9' },
    });
    expect(setOnly[0]).toMatchObject({
      product_key: 'product_set',
      product_label: 'Product set',
      product_kind: 'catalog',
    });

    const catalogOnly = draft({ product_set_id: 'ps_9' }, { productSetId: 'ps_9' });
    expect(catalogOnly[0]).toMatchObject({
      asset_key: 'catalog:ad-1',
      product_key: 'catalog',
      product_label: 'Catalog',
      product_kind: 'catalog',
    });
  });

  it('reads link_url and object_url when the story spec is empty', () => {
    expect(draft({ link_url: 'https://mintier.com/products/soap' })[0]).toMatchObject({
      product_key: 'product:soap',
    });
    expect(draft({ object_url: 'https://mintier.com/' })[0]).toMatchObject({
      product_key: 'homepage',
      product_label: 'Homepage',
    });
    expect(draft({ link_url: 'https://example.com/summer-sale' })[0]).toMatchObject({
      product_kind: 'other',
      product_label: 'Other: example.com/summer-sale',
    });
    expect(draft({ link_url: 'https://instagram.com/mintier' })[0]).toMatchObject({
      product_key: 'ig_profile',
      product_label: 'Instagram profile',
    });
  });

  it('labels a catalog product set when the only url is a template token', () => {
    const rows = draft({
      product_set_id: 'ps_1',
      object_story_spec: {
        template_data: { link: 'https://mintier.com/products/{{product.handle}}' },
      },
      creative_sourcing_spec: {
        site_links_spec: [{ site_link_url: 'https://mintier.com/products/soap' }],
      },
    });
    expect(rows[0]).toMatchObject({ format: 'Catalog', product_key: 'product:soap' });

    const tokenOnly = draft({
      product_set_id: 'ps_1',
      object_story_spec: {
        template_data: { link: 'https://mintier.com/products/{{product.handle}}' },
      },
    });
    expect(tokenOnly[0]).toMatchObject({
      format: 'Catalog',
      product_key: 'catalog',
      product_label: 'Catalog',
      product_kind: 'catalog',
      landing_url: null,
    });
  });

  it('labels a lead form instead of no landing page', () => {
    const rows = draft({
      call_to_action_type: 'SIGN_UP',
      destination_spec: { lead_form: { form_id: '999' } },
      object_story_spec: {
        link_data: {
          link: 'https://fb.me/',
          call_to_action: { type: 'SIGN_UP', value: { lead_gen_form_id: '999' } },
        },
      },
    });
    expect(rows[0]).toMatchObject({
      product_key: 'lead_form',
      product_label: 'Lead form',
      product_kind: 'lead_form',
    });
    expect(rows[0].product_label).not.toBe('No landing page');
  });

  it('labels messages and a Meta Shop with no website', () => {
    expect(draft({
      call_to_action_type: 'MESSAGE_PAGE',
      destination_spec: { messages: {} },
    })[0]).toMatchObject({
      product_key: 'messages',
      product_label: 'Messages',
      product_kind: 'messages',
      landing_url: null,
    });
    expect(draft({
      call_to_action_type: 'SEE_SHOP',
      destination_spec: { meta_shop: {} },
    })[0]).toMatchObject({
      product_key: 'meta_shop',
      product_label: 'Meta Shop',
      product_kind: 'meta_shop',
      landing_url: null,
    });
  });

  it('labels a phone call and an app when there is no website', () => {
    expect(draft({ call_to_action_type: 'CALL_NOW' })[0]).toMatchObject({
      product_label: 'Phone call',
      product_kind: 'call',
    });
    expect(draft({ call_to_action_type: 'INSTALL_MOBILE_APP', object_store_url: 'https://apps.apple.com/app/id1' })[0]).toMatchObject({
      product_label: 'App',
      product_kind: 'app',
    });
  });

  it('maps a catalog product when the link host is not the brand website', () => {
    const rows = draftsFromAd({
      brandId: 'fond',
      adId: 'ad-fond',
      adName: 'Chicken sampler',
      creativeId: 'cr-fond',
      creative: { link_url: 'https://fondbonebroth.com/products/best-selling-chicken-sampler' },
      hosts: ['fondregenerative.com'],
      products: [{ handle: 'best-selling-chicken-sampler', title: 'Chicken Sampler' }],
    });
    expect(rows[0]).toMatchObject({
      product_key: 'product:best-selling-chicken-sampler',
      product_label: 'Chicken Sampler',
      product_kind: 'product',
      landing_url: 'https://fondbonebroth.com/products/best-selling-chicken-sampler',
    });

    const unknown = draftsFromAd({
      brandId: 'fond',
      adId: 'ad-other',
      creativeId: 'cr-other',
      creative: { link_url: 'https://fondbonebroth.com/products/not-in-catalog' },
      hosts: ['fondregenerative.com'],
      products: [{ handle: 'best-selling-chicken-sampler', title: 'Chicken Sampler' }],
    });
    expect(unknown[0]).toMatchObject({
      product_kind: 'other',
      product_label: 'Other: fondbonebroth.com/products/not-in-catalog',
    });
  });
});
