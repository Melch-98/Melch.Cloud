// One live_creatives row per asset. Flexible ads split. Catalog is one row.
// Carousel keeps the first card as the product and stores every card link.
// assetsFromCreative is pure: the caller passes a post it already fetched.

import { classifyAdFormat, type AdFormat } from '@/lib/ad-classification';
import { imageHashFromCreative, videoIdFromCreative } from '@/lib/meta-funnel';
import {
  hostnameOf,
  mapLandingUrl,
  type CatalogProduct,
  type CollectionTitle,
  type MappedProduct,
  type ProductKind,
} from '@/lib/live-creatives/landing';

export type LiveFormat = 'Image' | 'Video' | 'Carousel' | 'Flexible' | 'Catalog' | 'Other';

export interface StoryPost {
  call_to_action?: { type?: string; value?: { link?: string; lead_gen_form_id?: string } } | null;
  attachments?: {
    data?: Array<{
      unshimmed_url?: string | null;
      url?: string | null;
      target?: { url?: string | null } | null;
      type?: string | null;
      subattachments?: {
        data?: Array<{
          unshimmed_url?: string | null;
          url?: string | null;
          target?: { url?: string | null } | null;
        }>;
      } | null;
    }>;
  } | null;
}

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

const DESTINATIONS: Record<string, { product_key: string; product_label: string; product_kind: ProductKind }> = {
  lead_form: { product_key: 'lead_form', product_label: 'Lead form', product_kind: 'lead_form' },
  messages: { product_key: 'messages', product_label: 'Messages', product_kind: 'messages' },
  call: { product_key: 'call', product_label: 'Phone call', product_kind: 'call' },
  ig_profile: { product_key: 'ig_profile', product_label: 'Instagram profile', product_kind: 'ig_profile' },
  meta_shop: { product_key: 'meta_shop', product_label: 'Meta Shop', product_kind: 'meta_shop' },
  app: { product_key: 'app', product_label: 'App', product_kind: 'app' },
};

const CTA_KIND: Record<string, ProductKind> = {
  CALL: 'call',
  CALL_NOW: 'call',
  CALL_ME: 'call',
  VIDEO_CALL: 'call',
  AUDIO_CALL: 'call',
  MESSAGE_PAGE: 'messages',
  WHATSAPP_MESSAGE: 'messages',
  INSTAGRAM_MESSAGE: 'messages',
  BUY_VIA_MESSAGE: 'messages',
  CHAT_WITH_US: 'messages',
  START_A_CHAT: 'messages',
  CHAT_NOW: 'messages',
  INSTALL_APP: 'app',
  USE_APP: 'app',
  INSTALL_MOBILE_APP: 'app',
  USE_MOBILE_APP: 'app',
  MOBILE_DOWNLOAD: 'app',
  UPDATE_APP: 'app',
  PLAY_GAME: 'app',
  PLAY_GAME_ON_FACEBOOK: 'app',
  OPEN_INSTANT_APP: 'app',
  SEE_SHOP: 'meta_shop',
  SWIPE_UP_SHOP: 'meta_shop',
  BROWSE_SHOP: 'meta_shop',
  VIEW_INSTAGRAM_PROFILE: 'ig_profile',
  INSTAGRAM_PROFILE: 'ig_profile',
};

const LEAD_CTAS = new Set(['APPLY_NOW', 'SIGN_UP', 'SUBSCRIBE', 'GET_QUOTE', 'GET_OFFER', 'GET_OFFER_VIEW', 'DOWNLOAD']);

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

function first(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (value) return value;
  }
  return null;
}

/** Unwrap l.facebook.com/l.php?u= (and the same shim on facebook.com). */
export function unwrapFacebookRedirect(raw: string): string {
  let current = raw.trim();
  for (let hop = 0; hop < 3; hop += 1) {
    let url: URL;
    try {
      url = new URL(current);
    } catch {
      return current;
    }
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const shim = host === 'l.facebook.com'
      || host === 'lm.facebook.com'
      || host === 'facebook.com'
      || host === 'm.facebook.com'
      || host === 'web.facebook.com';
    if (!shim || path !== '/l.php') return current;
    const encoded = url.searchParams.get('u');
    if (!encoded) return current;
    let decoded = encoded;
    try {
      const once = decodeURIComponent(encoded);
      if (once) decoded = once;
    } catch {
      decoded = encoded;
    }
    if (!decoded || decoded === current) return current;
    current = decoded.trim();
  }
  return current;
}

function clean(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const url = unwrapFacebookRedirect(raw);
  // A catalog token is not a page. Skipping it lets a later real URL win.
  if (url.includes('{{') || url.includes('}}')) return null;
  return url;
}

function linkFromAttachment(link: any): string | null {
  return clean(link?.link) || clean(link?.call_to_action?.value?.link);
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
    const link = clean(item?.website_url) || clean(item?.url);
    if (link) links.push(link);
  }
  return links;
}

function attachmentUrl(item: {
  unshimmed_url?: unknown;
  url?: unknown;
  target?: { url?: unknown } | null;
} | null | undefined): string | null {
  if (!item) return null;
  return clean(item.unshimmed_url) || clean(item.url) || clean(item.target?.url);
}

export function postLinks(post: StoryPost | null | undefined): { link: string | null; cards: string[] } {
  if (!post) return { link: null, cards: [] };
  const cta = clean(post.call_to_action?.value?.link);
  const first = Array.isArray(post.attachments?.data) ? post.attachments.data[0] : null;
  const attachment = first ? (clean(first.unshimmed_url) || clean(first.url)) : null;
  const subs = Array.isArray(first?.subattachments?.data) ? first.subattachments.data : [];
  const cards: string[] = [];
  for (const sub of subs) {
    const url = attachmentUrl(sub);
    if (url) cards.push(url);
  }
  return { link: cta || attachment || cards[0] || null, cards };
}

function siteLinkUrl(creative: Creative): string | null {
  const list = creative?.creative_sourcing_spec?.site_links_spec;
  if (!Array.isArray(list)) return null;
  for (const item of list) {
    const url = clean(item?.site_link_url);
    if (url) return url;
  }
  return null;
}

/**
 * Website URL, first hit wins:
 * link_data.link, link_data CTA, video CTA, template link, asset-feed website_url,
 * creative link_url / object_url / template_url / CTA, post CTA / attachment, site link.
 */
export function primaryLanding(creative: Creative, post?: StoryPost | null): string | null {
  const story = creative?.object_story_spec || {};
  const feed = feedLinks(creative?.asset_feed_spec);
  const posted = postLinks(post);
  return first(
    clean(story.link_data?.link),
    clean(story.link_data?.call_to_action?.value?.link),
    clean(story.video_data?.call_to_action?.value?.link),
    clean(story.template_data?.link),
    feed[0],
    clean(creative?.link_url),
    clean(creative?.object_url),
    clean(creative?.template_url),
    clean(creative?.call_to_action?.value?.link),
    posted.link,
    siteLinkUrl(creative),
  );
}

export function instagramOnlyCreative(creative: Creative): boolean {
  if (!creative) return false;
  const name = (text(creative.name) || '').toLowerCase();
  if (name.startsWith('instagram post:')) return true;
  if (!text(creative.effective_instagram_media_id)) return false;
  return !text(creative.effective_object_story_id) && !text(creative.object_story_id);
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

/** Page post to fetch when the creative itself has no link. Instagram-only creatives are skipped. */
export function storyIdForPostFetch(creative: unknown): string | null {
  if (!creative || typeof creative !== 'object' || Array.isArray(creative)) return null;
  const node = creative as Creative;
  if (instagramOnlyCreative(node)) return null;
  if (primaryLanding(node, null) || carouselLinks(node).length > 0) return null;
  return text(node.effective_object_story_id) || text(node.object_story_id);
}

function linkAt(links: string[], index: number, total: number, fallback: string | null): string | null {
  if (links.length === 1) return links[0];
  if (total > 0 && links.length === total && links[index]) return links[index];
  return links[0] || fallback;
}

function firstThumb(creative: Creative, extra?: string | null): string | null {
  return extra || text(creative?.thumbnail_url) || text(creative?.image_url);
}

export function assetsFromCreative(input: {
  adId: string;
  creative: Creative;
  adset?: { dynamic?: boolean; productSetId?: string } | null;
  post?: StoryPost | null;
}): AssetDraft[] {
  const creative = input.creative || {};
  const story = creative.object_story_spec || {};
  const feed = creative.asset_feed_spec;
  const flags = input.adset
    ? { dynamic: !!input.adset.dynamic, productSetId: input.adset.productSetId || '' }
    : null;
  const format = formatFromClassifier(classifyAdFormat(creative, flags));
  const feedUrls = feedLinks(feed);
  const primary = primaryLanding(creative, input.post);
  const posted = postLinks(input.post);

  if (format === 'Catalog') {
    return [{
      asset_key: `catalog:${input.adId}`,
      format,
      landing_url: primary,
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
        landing_url: primary,
        asset_name: key,
        thumbnail_url: firstThumb(creative),
        card_landings: [],
      }];
    }
    return pieces.map((piece, index) => ({
      asset_key: piece.key,
      format,
      landing_url: linkAt(feedUrls, index, pieces.length, primary),
      asset_name: piece.name,
      thumbnail_url: firstThumb(creative, piece.thumb),
      card_landings: [],
    }));
  }

  const storyCards = carouselLinks(creative);
  const postCarousel = posted.cards.length >= 2;
  if (format === 'Carousel' || postCarousel) {
    const cards = storyCards.length ? storyCards : posted.cards;
    const firstChild = story.link_data?.child_attachments?.[0];
    const key = text(firstChild?.image_hash) || text(firstChild?.video_id) || `carousel:${input.adId}`;
    return [{
      asset_key: key,
      format: 'Carousel',
      landing_url: cards[0] || primary,
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
      landing_url: primary,
      asset_name: key,
      thumbnail_url: firstThumb(creative, text(story.video_data?.image_url)),
      card_landings: [],
    }];
  }

  const key = imageHashFromCreative(creative) || `image:${input.adId}`;
  return [{
    asset_key: key,
    format: format === 'Image' ? 'Image' : format,
    landing_url: primary,
    asset_name: key,
    thumbnail_url: firstThumb(creative, text(story.link_data?.image_url) || text(story.link_data?.picture)),
    card_landings: [],
  }];
}

function bareHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, '');
}

function hostIs(host: string, names: string[]): boolean {
  const bare = bareHost(host);
  return names.some((name) => bare === name || bare.endsWith(`.${name}`));
}

function kindFromUrl(url: string | null): ProductKind | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (trimmed.toLowerCase().startsWith('tel:')) return 'call';
  const host = hostnameOf(trimmed);
  if (!host) return null;
  if (hostIs(host, ['instagram.com'])) return 'ig_profile';
  if (hostIs(host, ['m.me', 'messenger.com', 'wa.me', 'whatsapp.com'])) return 'messages';
  if (hostIs(host, ['apps.apple.com', 'itunes.apple.com', 'play.google.com'])) return 'app';
  if (hostIs(host, ['facebook.com', 'fb.com'])) {
    try {
      const withProto = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
      const path = new URL(withProto).pathname.toLowerCase();
      if (path.includes('/shop') || path.includes('/commerce')) return 'meta_shop';
    } catch {
      return null;
    }
  }
  return null;
}

function isExternalWebsite(url: string): boolean {
  if (url.includes('{{') || url.includes('}}')) return false;
  if (url.trim().toLowerCase().startsWith('tel:')) return false;
  const host = hostnameOf(url);
  if (!host) return false;
  if (hostIs(host, [
    'facebook.com', 'fb.com', 'fb.me', 'instagram.com', 'messenger.com', 'm.me',
    'whatsapp.com', 'wa.me', 'l.facebook.com', 'lm.facebook.com',
    'apps.apple.com', 'itunes.apple.com', 'play.google.com',
  ])) return false;
  return true;
}

function isFbMe(url: string | null): boolean {
  const host = hostnameOf(url || '');
  return !!host && hostIs(host, ['fb.me']);
}

function kindFromDestinationKey(key: string): ProductKind | null {
  const norm = key.toLowerCase().replace(/-/g, '_');
  if (norm === 'lead_form' || norm === 'leadgen' || norm === 'lead_gen_form' || norm.includes('lead_form')) return 'lead_form';
  if (norm === 'messages' || norm === 'messenger' || norm === 'whatsapp' || norm === 'instagram_direct') return 'messages';
  if (norm === 'call' || norm === 'phone_call' || norm === 'phone') return 'call';
  if (norm === 'ig_profile' || norm === 'instagram_profile') return 'ig_profile';
  if (norm === 'meta_shop' || norm === 'shop' || norm === 'native_commerce') return 'meta_shop';
  if (norm === 'app' || norm === 'application' || norm === 'app_store') return 'app';
  return null;
}

function kindFromDestinationSpec(spec: unknown): ProductKind | null {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return null;
  for (const [key, value] of Object.entries(spec as Record<string, unknown>)) {
    const fromKey = kindFromDestinationKey(key);
    if (fromKey) return fromKey;
    if (typeof value === 'string') {
      const fromValue = kindFromDestinationKey(value);
      if (fromValue) return fromValue;
    }
  }
  return null;
}

function ctaTypeOf(creative: Creative, post?: StoryPost | null): string {
  const feedTypes = creative?.asset_feed_spec?.call_to_action_types;
  const feedType = Array.isArray(feedTypes) ? feedTypes[0] : null;
  return (
    text(creative?.call_to_action_type)
    || text(creative?.call_to_action?.type)
    || text(creative?.object_story_spec?.link_data?.call_to_action?.type)
    || text(creative?.object_story_spec?.video_data?.call_to_action?.type)
    || text(post?.call_to_action?.type)
    || text(feedType)
    || ''
  ).toUpperCase();
}

function leadFormId(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  return text((value as { lead_gen_form_id?: unknown }).lead_gen_form_id);
}

function hasLeadForm(creative: Creative, post?: StoryPost | null): boolean {
  const values: unknown[] = [
    creative?.call_to_action?.value,
    creative?.object_story_spec?.link_data?.call_to_action?.value,
    creative?.object_story_spec?.video_data?.call_to_action?.value,
    creative?.object_story_spec?.template_data?.call_to_action?.value,
    post?.call_to_action?.value,
  ];
  const children = creative?.object_story_spec?.link_data?.child_attachments;
  if (Array.isArray(children)) {
    for (const child of children) {
      const action = child && typeof child === 'object' ? (child as { call_to_action?: { value?: unknown } }).call_to_action : null;
      values.push(action?.value);
    }
  }
  return values.some((value) => !!leadFormId(value));
}

function productSetChoice(
  creative: Creative,
  adset?: { productSetId?: string } | null,
): { product_key: string; product_label: string } | null {
  if (text(creative?.product_set_id) || text(adset?.productSetId)) {
    return { product_key: 'catalog', product_label: 'Catalog' };
  }
  if (text(creative?.creative_sourcing_spec?.associated_product_set_id)) {
    return { product_key: 'product_set', product_label: 'Product set' };
  }
  return null;
}

function signalKind(
  creative: Creative,
  post: StoryPost | null | undefined,
  url: string | null,
  adset?: { productSetId?: string } | null,
): ProductKind | null {
  const fromUrl = kindFromUrl(url);
  if (fromUrl) return fromUrl;
  const fromSpec = kindFromDestinationSpec(creative?.destination_spec);
  if (fromSpec) return fromSpec;
  if (hasLeadForm(creative, post)) return 'lead_form';
  const cta = ctaTypeOf(creative, post);
  if (isFbMe(url) && LEAD_CTAS.has(cta)) return 'lead_form';
  if (CTA_KIND[cta]) return CTA_KIND[cta];
  if (productSetChoice(creative, adset)) return null;
  if (text(creative?.object_store_url)) return 'app';
  const objectType = String(creative?.object_type || '').toUpperCase();
  if (objectType === 'APPLICATION' || objectType === 'STORE_ITEM') return 'app';
  if (instagramOnlyCreative(creative)) return 'ig_profile';
  return null;
}

function withDestination(base: MappedProduct, kind: ProductKind, raw: string | null): MappedProduct {
  const spec = DESTINATIONS[kind];
  if (!spec) return base;
  return {
    ...base,
    product_key: spec.product_key,
    product_label: spec.product_label,
    product_kind: spec.product_kind,
    landing_url: base.landing_url ?? raw,
  };
}

function otherWebsite(base: MappedProduct, raw: string): MappedProduct {
  const source = base.landing_url_normalized || base.landing_url || raw;
  const host = hostnameOf(source);
  let path = '';
  try {
    const withProto = /^[a-z][a-z0-9+.-]*:\/\//i.test(source) ? source : `https://${source}`;
    const pathname = new URL(withProto).pathname || '/';
    path = pathname !== '/' && pathname.endsWith('/') ? pathname.replace(/\/+$/, '') : (pathname === '/' ? '' : pathname);
  } catch {
    path = '';
  }
  const slug = `${host ? bareHost(host) : ''}${path}`;
  return {
    ...base,
    product_key: `other:${slug || 'website'}`,
    product_label: `Other: ${slug || 'website'}`,
    product_kind: 'other',
    landing_url: base.landing_url ?? raw,
  };
}

function mapResolved(input: {
  url: string | null;
  hosts: string[];
  products: CatalogProduct[];
  collections: CollectionTitle[];
  creative: Creative;
  post?: StoryPost | null;
  adset?: { productSetId?: string } | null;
  role: 'primary' | 'card';
}): MappedProduct {
  const mapped = mapLandingUrl(input.url, input.hosts, input.products, input.collections);
  if (mapped.product_kind !== 'none') return mapped;
  if (input.url && isExternalWebsite(input.url)) return otherWebsite(mapped, input.url);
  if (input.role === 'card') {
    const fromUrl = kindFromUrl(input.url);
    if (fromUrl) return withDestination(mapped, fromUrl, input.url);
    return mapped;
  }
  const kind = signalKind(input.creative, input.post, input.url, input.adset);
  if (kind) return withDestination(mapped, kind, input.url);
  const catalog = productSetChoice(input.creative, input.adset);
  if (catalog) {
    return {
      ...mapped,
      product_key: catalog.product_key,
      product_label: catalog.product_label,
      product_kind: 'catalog',
      landing_url: mapped.landing_url ?? input.url,
    };
  }
  return mapped;
}

export function draftsFromAd(input: {
  brandId: string;
  adId: string;
  adName?: string | null;
  creativeId?: string | null;
  creative: unknown;
  post?: StoryPost | null;
  adset?: { dynamic?: boolean; productSetId?: string } | null;
  hosts: string[];
  products: CatalogProduct[];
  collections?: CollectionTitle[];
}): LiveCreativeDraft[] {
  const creative = (input.creative && typeof input.creative === 'object' && !Array.isArray(input.creative)
    ? input.creative
    : null) as Creative;
  const assets = assetsFromCreative({
    adId: input.adId,
    creative,
    adset: input.adset,
    post: input.post,
  });
  const creativeId = input.creativeId || text(creative?.id);
  const collections = input.collections || [];
  return assets.map((asset) => {
    const cards = asset.card_landings.map((url) => mapResolved({
      url,
      hosts: input.hosts,
      products: input.products,
      collections,
      creative,
      post: input.post,
      adset: input.adset,
      role: 'card',
    }));
    const primary = cards[0] || mapResolved({
      url: asset.landing_url,
      hosts: input.hosts,
      products: input.products,
      collections,
      creative,
      post: input.post,
      adset: input.adset,
      role: 'primary',
    });
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
