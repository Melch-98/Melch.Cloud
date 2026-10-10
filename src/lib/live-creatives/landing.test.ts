import { describe, expect, it } from 'vitest';
import {
  hostAllowed,
  hostsFromBrandConfig,
  isProductKind,
  mapLandingUrl,
  normalizeLanding,
} from '@/lib/live-creatives/landing';

const hosts = ['mintier.com', 'mintier.myshopify.com'];
const products = [
  { handle: 'tallow-balm', title: 'Tallow Balm' },
  { handle: 'soap', title: 'Soap Bar' },
];
const collections = [{ handle: 'summer', title: 'Summer Edit' }];

describe('normalizeLanding', () => {
  it('strips query, fragment, trailing slash, locale, and lowercases', () => {
    const norm = normalizeLanding(
      'https://Mintier.com/en-ca/products/Tallow-Balm/?utm_source=fb&utm_medium=paid#reviews',
      hosts,
    );
    expect(norm).toMatchObject({
      host: 'mintier.com',
      path: '/products/tallow-balm',
      landing_url_normalized: 'https://mintier.com/products/tallow-balm',
      sameDomain: true,
    });
  });

  it('strips en-us and a bare fr prefix', () => {
    expect(normalizeLanding('https://mintier.com/en-us/collections/summer/', hosts)?.path).toBe('/collections/summer');
    expect(normalizeLanding('https://mintier.com/fr', hosts)?.path).toBe('/');
    expect(normalizeLanding('/fr/products/soap', hosts)?.path).toBe('/products/soap');
  });

  it('accepts the myshopify host, the custom domain, and a www alias', () => {
    expect(hostAllowed('www.mintier.com', ['mintier.com'])).toBe(true);
    expect(normalizeLanding('https://mintier.myshopify.com/products/soap', hosts)?.sameDomain).toBe(true);
    expect(normalizeLanding('https://www.mintier.com/shop', ['www.mintier.com'])?.sameDomain).toBe(true);
    expect(normalizeLanding('https://other.example/products/soap', hosts)?.sameDomain).toBe(false);
  });

  it('reads hosts from website, shop domain, and shop.json', () => {
    expect(hostsFromBrandConfig({
      websiteUrl: 'https://www.mintier.com',
      shopifyStoreDomain: 'mintier.myshopify.com',
      shopDomains: ['checkout.mintier.com'],
      shopInfo: { domain: 'shop.mintier.com', myshopify_domain: 'mintier.myshopify.com' },
    }).sort()).toEqual([
      'checkout.mintier.com',
      'mintier.myshopify.com',
      'shop.mintier.com',
      'www.mintier.com',
    ]);
  });
});

describe('mapLandingUrl', () => {
  const sample = [
    'https://mintier.com/en-ca/products/tallow-balm?utm_source=fb',
    'https://mintier.com/collections/summer/products/soap/',
    'https://mintier.com/products/not-a-real-sku',
    'https://mintier.com/fr/',
    'https://mintier.com/collections/all',
    'https://mintier.com/collections/shop-all',
    'https://mintier.com/shop',
    'https://mintier.com/collections/all-products',
    'https://mintier.com/collections/summer',
    'https://mintier.com/pages/about',
    'https://instagram.com/mintier',
    '',
  ];

  it('maps a sample storefront', () => {
    const mapped = sample.map((url) => {
      const product = mapLandingUrl(url, hosts, products, collections);
      return {
        url: url || '(missing)',
        product_key: product.product_key,
        product_label: product.product_label,
        product_kind: product.product_kind,
      };
    });
    expect(mapped).toEqual([
      { url: sample[0], product_key: 'product:tallow-balm', product_label: 'Tallow Balm', product_kind: 'product' },
      { url: sample[1], product_key: 'product:soap', product_label: 'Soap Bar', product_kind: 'product' },
      { url: sample[2], product_key: 'product:not-a-real-sku', product_label: 'Not A Real Sku', product_kind: 'product' },
      { url: sample[3], product_key: 'homepage', product_label: 'Homepage', product_kind: 'homepage' },
      { url: sample[4], product_key: 'shop_all', product_label: 'Shop All', product_kind: 'shop_all' },
      { url: sample[5], product_key: 'shop_all', product_label: 'Shop All', product_kind: 'shop_all' },
      { url: sample[6], product_key: 'shop_all', product_label: 'Shop All', product_kind: 'shop_all' },
      { url: sample[7], product_key: 'shop_all', product_label: 'Shop All', product_kind: 'shop_all' },
      { url: sample[8], product_key: 'collection:summer', product_label: 'Collection: Summer Edit', product_kind: 'collection' },
      { url: sample[9], product_key: 'other:/pages/about', product_label: 'Other: /pages/about', product_kind: 'other' },
      { url: sample[10], product_key: 'none', product_label: 'No landing page', product_kind: 'none' },
      { url: '(missing)', product_key: 'none', product_label: 'No landing page', product_kind: 'none' },
    ]);
  });

  it('title-cases an unknown product or collection handle', () => {
    expect(mapLandingUrl('https://mintier.com/products/not-a-real-sku', hosts, products)).toMatchObject({
      product_key: 'product:not-a-real-sku',
      product_label: 'Not A Real Sku',
      product_kind: 'product',
    });
    expect(mapLandingUrl('https://mintier.com/collections/summer-edit', hosts, products, collections)).toMatchObject({
      product_key: 'collection:summer-edit',
      product_label: 'Collection: Summer Edit',
      product_kind: 'collection',
    });
  });

  it('accepts destination kinds and rejects unknown ones', () => {
    expect(isProductKind('lead_form')).toBe(true);
    expect(isProductKind('messages')).toBe(true);
    expect(isProductKind('call')).toBe(true);
    expect(isProductKind('ig_profile')).toBe(true);
    expect(isProductKind('meta_shop')).toBe(true);
    expect(isProductKind('app')).toBe(true);
    expect(isProductKind('catalog')).toBe(true);
    expect(isProductKind('none')).toBe(true);
    expect(isProductKind('nope')).toBe(false);
  });

  it('treats a catalog template token as no landing page', () => {
    const mapped = mapLandingUrl('https://mintier.com/products/{{product.handle}}', hosts, products);
    expect(mapped.product_kind).toBe('none');
    expect(mapped.product_label).toBe('No landing page');
  });
});
