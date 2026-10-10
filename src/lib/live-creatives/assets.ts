// One live_creatives row per asset. Flexible ads split. Catalog is one row.
// Carousel keeps the first card as the product and stores every card link.

import { classifyAdFormat, type AdFormat } from '@/lib/ad-classification';
import { imageHashFromCreative, videoIdFromCreative } from '@/lib/meta-funnel';
import {
  mapLandingUrl,
  type CatalogProduct,
  type CollectionTitle,
  type MappedProduct,
  type ProductKind,
} from '@/lib/live-creatives/landing';

export type LiveFormat = 'Image' | 'Video' | 'Carousel' | 'Flexible' | 'Catalog' | 'Other';

export interface AssetDraft {
  asset_key: string;
  format: LiveFormat;
  landing_url: string | null;
  asset_name: string | null;
  thumbnail_url: string | null;
  /** Every carousel card URL, first card first. Empty for other formats. */
  card_landings: string[];
}

export interface LiveCreativeDraft {
  brand_id: string;
  platform: 'meta';
  ad_id: string;
  asset_key: string;
  creative_id: string | null;
  format: LiveFormat;
  landing_url: string | null;
  landing_url_normalized: string | null;
  product_key: string;
  product_label: string;
  product_kind: ProductKind;
  ad_name: string | null;
  asset_name: string | null;
  thumbnail_url: string | null;
  card_products: MappedProduct[] | null;
  product_source: 'url';
}

type Creative = Record<string, any> | null | undefined;

export function formatFromClassifier(format: AdFormat): LiveFormat {
  switch (format) {
    case 'image':
      return 'Image';
    case 'video':
      return 'Video';
    case 'carousel':
      return 'Carousel';
    case 'flexible':
      return 'Flexible';
    case 'catalog':
      return 'Catalog';
    default:
      return 'Other';
  }
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function linkFromAttachment(link: any): string | null {
  return text(link?.link) || text(link?.call_to_action?.value?.link);
}

export function childLinks(linkData: any): string[] {
  const children = Array.isArray(linkData?.child_attachments) ? linkData.child_attachments : [];
  const links: string[] = [];
  for (const child of children) {
    const link = linkFromAttachment(child);
    if (link) links.push(link);
  }
  return links;
}

export function feedLinks(feed: any): string[] {
  const urls = Array.isArray(feed?.link_urls) ? feed.link_urls : [];
  const links: string[] = [];
  for (const item of urls) {
    const link = text(item?.website_url) || text(item?.url);
    if (link) links.push(link);
  }
  return links;
}

function videoLink(video: any): string | null {
  return text(video?.call_to_action?.value?.link);
}

function storyLinks(creative: Creative): { link: string | null; video: string | null; feed: string[] } {
  const story = creative?.object_story_spec || {};
  return {
    link: linkFromAttachment(story.link_data),
    video: videoLink(story.video_data),
    feed: feedLinks(creative?.asset_feed_spec),
  };
}

function firstThumb(creative: Creative, extra?: string | null): string | null {
  return extra || text(creative?.thumbnail_url) || text(creative?.image_url);
}

function carouselLinks(creative: Creative): string[] {
  const story = creative?.object_story_spec || {};
  const fromChildren = childLinks(story.link_data);
  if (fromChildren.length) return fromChildren;
  const feed = creative?.asset_feed_spec;
  const carousels = Array.isArray(feed?.carousels) ? feed.carousels : [];
  const links: string[] = [];
  for (const carousel of carousels) {
    links.push(...childLinks(carousel));
  }
  if (links.length) return links;
  return feedLinks(feed);
}

function linkAt(links: string[], index: number, total: number, fallback: string | null): string | null {
  if (links.length === 1) return links[0];
  if (total > 0 && links.length === total && links[index]) return links[index];
  return links[0] || fallback;
}

export function assetsFromCreative(input: {
  adId: string;
  creative: Creative;
  adset?: { dynamic?: boolean; productSetId?: string } | null;
}): AssetDraft[] {
  const creative = input.creative || {};
  const story = creative.object_story_spec || {};
  const feed = creative.asset_feed_spec;
  const flags = input.adset
    ? { dynamic: !!input.adset.dynamic, productSetId: input.adset.productSetId || '' }
    : null;
  const format = formatFromClassifier(classifyAdFormat(creative, flags));
  const links = storyLinks(creative);
  const fallback = links.link || links.video || links.feed[0] || text(story.template_data?.link);

  if (format === 'Catalog') {
    return [{
      asset_key: `catalog:${input.adId}`,
      format,
      landing_url: text(story.template_data?.link) || links.link || links.feed[0] || links.video,
      asset_name: 'Catalog',
      thumbnail_url: firstThumb(creative),
      card_landings: [],
    }];
  }

  if (format === 'Flexible') {
    const images = Array.isArray(feed?.images) ? feed.images : [];
    const videos = Array.isArray(feed?.videos) ? feed.videos : [];
    const pieces: Array<{ key: string; name: string; thumb: string | null }> = [];
    for (const image of images) {
      const hash = text(image?.hash) || text(image?.image_hash);
      if (!hash) continue;
      pieces.push({ key: hash, name: hash, thumb: text(image?.url) });
    }
    for (const video of videos) {
      const id = text(video?.video_id);
      if (!id) continue;
      pieces.push({ key: id, name: id, thumb: text(video?.thumbnail_url) });
    }
    if (pieces.length === 0) {
      const key = imageHashFromCreative(creative) || videoIdFromCreative(creative) || `flexible:${input.adId}`;
      return [{
        asset_key: key,
        format,
        landing_url: links.feed[0] || fallback,
        asset_name: key,
        thumbnail_url: firstThumb(creative),
        card_landings: [],
      }];
    }
    return pieces.map((piece, index) => ({
      asset_key: piece.key,
      format,
      landing_url: linkAt(links.feed, index, pieces.length, fallback),
      asset_name: piece.name,
      thumbnail_url: firstThumb(creative, piece.thumb),
      card_landings: [],
    }));
  }

  if (format === 'Carousel') {
    const cards = carouselLinks(creative);
    const firstChild = story.link_data?.child_attachments?.[0];
    const key = text(firstChild?.image_hash) || text(firstChild?.video_id) || `carousel:${input.adId}`;
    return [{
      asset_key: key,
      format,
      landing_url: cards[0] || fallback,
      asset_name: text(firstChild?.name) || text(firstChild?.title) || 'Carousel',
      thumbnail_url: firstThumb(creative, text(firstChild?.picture) || text(firstChild?.image_url)),
      card_landings: cards,
    }];
  }

  if (format === 'Video') {
    const key = videoIdFromCreative(creative) || `video:${input.adId}`;
    return [{
      asset_key: key,
      format,
      landing_url: links.video || links.link || links.feed[0],
      asset_name: key,
      thumbnail_url: firstThumb(creative, text(story.video_data?.image_url)),
      card_landings: [],
    }];
  }

  const key = imageHashFromCreative(creative) || `image:${input.adId}`;
  return [{
    asset_key: key,
    format: format === 'Image' ? 'Image' : format,
    landing_url: links.link || links.feed[0] || links.video,
    asset_name: key,
    thumbnail_url: firstThumb(creative, text(story.link_data?.image_url) || text(story.link_data?.picture)),
    card_landings: [],
  }];
}

export function draftsFromAd(input: {
  brandId: string;
  adId: string;
  adName?: string | null;
  creativeId?: string | null;
  creative: Creative;
  adset?: { dynamic?: boolean; productSetId?: string } | null;
  hosts: string[];
  products: CatalogProduct[];
  collections?: CollectionTitle[];
}): LiveCreativeDraft[] {
  const assets = assetsFromCreative({
    adId: input.adId,
    creative: input.creative,
    adset: input.adset,
  });
  const creativeId = input.creativeId || text(input.creative?.id);
  return assets.map((asset) => {
    const cards = asset.card_landings.map((url) =>
      mapLandingUrl(url, input.hosts, input.products, input.collections || []),
    );
    const primary = cards[0] || mapLandingUrl(asset.landing_url, input.hosts, input.products, input.collections || []);
    return {
      brand_id: input.brandId,
      platform: 'meta',
      ad_id: input.adId,
      asset_key: asset.asset_key,
      creative_id: creativeId,
      format: asset.format,
      landing_url: primary.landing_url ?? asset.landing_url,
      landing_url_normalized: primary.landing_url_normalized,
      product_key: primary.product_key,
      product_label: primary.product_label,
      product_kind: primary.product_kind,
      ad_name: input.adName || null,
      asset_name: asset.asset_name,
      thumbnail_url: asset.thumbnail_url,
      card_products: asset.format === 'Carousel' ? (cards.length ? cards : [primary]) : null,
      product_source: 'url',
    };
  });
}
