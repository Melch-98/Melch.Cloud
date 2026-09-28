// Classifies Meta ads by who the ad runs as (brand vs partnership) and by
// creative format. Rules are based on Marketing API creative fields, checked
// against live Melch brand accounts. Ad names are never used.

export type AdSource = 'brand' | 'partnership' | 'unknown';
export type AdFormat = 'image' | 'video' | 'carousel' | 'catalog' | 'flexible' | 'other';

export const AD_SOURCES: { value: AdSource; label: string }[] = [
  { value: 'brand', label: 'Brand-run' },
  { value: 'partnership', label: 'Whitelisted / Partner' },
  { value: 'unknown', label: 'Unknown source' },
];

export const AD_FORMATS: { value: AdFormat; label: string }[] = [
  { value: 'image', label: 'Image' },
  { value: 'video', label: 'Video' },
  { value: 'carousel', label: 'Carousel' },
  { value: 'catalog', label: 'Catalog' },
  { value: 'flexible', label: 'Flexible' },
  { value: 'other', label: 'Other' },
];

/** Formats Nick asked for always stay in the menu. Catalog / flexible / other appear once an ad lands there. */
export const PRIMARY_FORMATS: AdFormat[] = ['image', 'video', 'carousel'];

export interface BrandIdentity {
  pageIds: Set<string>;
  instagramIds: Set<string>;
}

export interface AdsetFormatFlags {
  dynamic: boolean;
  productSetId: string;
}

export interface ClassifiedAd {
  ad_source: AdSource;
  ad_format: AdFormat;
}

export interface CopyAdMetrics {
  ad_id: string;
  ad_name: string;
  ad_source: AdSource;
  ad_format: AdFormat;
  spend: number;
  purchase_value: number;
  purchases: number;
  impressions: number;
  clicks: number;
  ctr: number;
  link_ctr: number;
  cpm: number;
  cpc: number;
  add_to_cart: number;
  initiate_checkout: number;
  thumbstop_rate: number;
  reach: number;
  frequency: number;
}

type CreativeLike = Record<string, any> | null | undefined;

function firstId(...vals: unknown[]): string {
  for (const v of vals) {
    if (v == null) continue;
    const s = String(v).trim();
    if (s && s !== '0' && s !== 'null' && s !== 'undefined') return s;
  }
  return '';
}

export function creativePageId(creative: CreativeLike): string {
  if (!creative) return '';
  const story = creative.object_story_spec || {};
  const fromStory = firstId(story.page_id, creative.actor_id, creative.object_id);
  if (fromStory) return fromStory;
  const storyId = firstId(creative.effective_object_story_id, creative.object_story_id);
  const prefix = storyId.split('_')[0] || '';
  return /^\d+$/.test(prefix) ? prefix : '';
}

export function creativeInstagramId(creative: CreativeLike): string {
  if (!creative) return '';
  const story = creative.object_story_spec || {};
  return firstId(
    creative.instagram_user_id,
    creative.instagram_actor_id,
    story.instagram_user_id,
    story.instagram_actor_id,
  );
}

/**
 * Partnership / whitelist / branded content.
 * Live accounts (Mintier, Tallow Twins, Organic Jaguar) mark these with a
 * second identity on the creative:
 *   - facebook_branded_content.sponsor_page_id
 *   - instagram_branded_content.sponsor_id
 * Which side is the brand varies. On some ads the sponsor is the brand and
 * page_id is the creator; on others page_id is the brand and the sponsor is
 * the creator. Either way a sponsor id means the ad runs as a partnership.
 * branded_content.ad_format alone is not used — it is not a documented
 * identity field.
 */
export function hasPartnershipIdentity(creative: CreativeLike): boolean {
  if (!creative) return false;
  const story = creative.object_story_spec || {};
  const slots = [story, story.photo_data, story.video_data, story.link_data, story.template_data];
  if (firstId(creative.branded_content_sponsor_page_id)) return true;
  if (firstId(creative.facebook_branded_content?.sponsor_page_id)) return true;
  if (firstId(creative.instagram_branded_content?.sponsor_id)) return true;
  if (firstId(creative.branded_content?.sponsor_page_id, creative.branded_content?.sponsor_id)) return true;
  if (firstId(creative.branded_content?.instagram_boost_post_access_token)) return true;
  return slots.some((slot) => firstId(slot?.branded_content_sponsor_page_id));
}

/**
 * Drop a page or Instagram id list that doesn't overlap any creative in this
 * response. An empty promote_pages edge (what this token gets today) must not
 * mark every ad as a partner. A list that overlaps is safe to compare against.
 */
export function reliableIdentity(identity: BrandIdentity, creatives: CreativeLike[]): BrandIdentity {
  const seenPages: string[] = [];
  const seenIgs: string[] = [];
  for (const creative of creatives) {
    const pageId = creativePageId(creative);
    const igId = creativeInstagramId(creative);
    if (pageId) seenPages.push(pageId);
    if (igId) seenIgs.push(igId);
  }
  const pageIds = new Set<string>();
  const instagramIds = new Set<string>();
  if (identity.pageIds.size > 0 && seenPages.some((id) => identity.pageIds.has(id))) {
    identity.pageIds.forEach((id) => pageIds.add(id));
  }
  if (identity.instagramIds.size > 0 && seenIgs.some((id) => identity.instagramIds.has(id))) {
    identity.instagramIds.forEach((id) => instagramIds.add(id));
  }
  return { pageIds, instagramIds };
}

export function classifyAdSource(creative: CreativeLike, identity: BrandIdentity): AdSource {
  if (!creative) return 'unknown';
  if (hasPartnershipIdentity(creative)) return 'partnership';

  const pageId = creativePageId(creative);
  const igId = creativeInstagramId(creative);
  // Legacy whitelist: the ad's page or Instagram actor is not one of the
  // accounts connected to this ad account, and Meta did not set sponsor fields.
  if (identity.pageIds.size > 0 && pageId && !identity.pageIds.has(pageId)) return 'partnership';
  if (identity.instagramIds.size > 0 && igId && !identity.instagramIds.has(igId)) return 'partnership';

  return 'brand';
}

/**
 * Format, most specific signal first.
 * Catalog: creative.product_set_id, ad set promoted_object.product_set_id, or template_data.
 * Flexible: asset_feed_spec.ad_formats AUTOMATIC_FORMAT, optimization_type FORMAT_AUTOMATION,
 *   or the ad set is_dynamic_creative flag.
 *   optimization_type DEGREES_OF_FREEDOM is Advantage+ enhancements and is on almost
 *   every ad — it is not flexible. PLACEMENT is a crop of one creative, not a new format.
 * Carousel: link_data.child_attachments length >= 2, asset_feed carousels, or ad_formats CAROUSEL.
 * Video / image: object_type, video_data, photo_data, link image, or SINGLE_VIDEO / SINGLE_IMAGE.
 * Anything with conflicting media and no explicit format is Other.
 */
export function classifyAdFormat(creative: CreativeLike, adset?: AdsetFormatFlags | null): AdFormat {
  if (!creative) return 'other';

  const objectType = String(creative.object_type || '').toUpperCase();
  const story = creative.object_story_spec || {};
  const link = story.link_data;
  const video = story.video_data;
  const photo = story.photo_data;
  const template = story.template_data;
  const feed = creative.asset_feed_spec;
  const adFormats: string[] = (Array.isArray(feed?.ad_formats) ? feed.ad_formats : []).map((f: unknown) =>
    String(f).toUpperCase(),
  );
  const optimization = String(feed?.optimization_type || '').toUpperCase();
  const childCount = Array.isArray(link?.child_attachments) ? link.child_attachments.length : 0;
  const feedCards = Array.isArray(feed?.carousels)
    ? feed.carousels.reduce(
        (n: number, carousel: any) => n + (Array.isArray(carousel?.child_attachments) ? carousel.child_attachments.length : 0),
        0,
      )
    : 0;
  const imageCount = Array.isArray(feed?.images) ? feed.images.length : 0;
  const videoCount = Array.isArray(feed?.videos) ? feed.videos.length : 0;

  if (firstId(creative.product_set_id, adset?.productSetId) || template) return 'catalog';
  if (adFormats.includes('AUTOMATIC_FORMAT') || optimization === 'FORMAT_AUTOMATION' || adset?.dynamic) {
    return 'flexible';
  }
  if (childCount >= 2 || feedCards >= 2 || adFormats.includes('CAROUSEL') || objectType.includes('CAROUSEL')) {
    return 'carousel';
  }

  const explicitVideo = adFormats.includes('SINGLE_VIDEO');
  const explicitImage = adFormats.includes('SINGLE_IMAGE');
  const hasVideo = objectType === 'VIDEO' || !!video?.video_id || explicitVideo || (videoCount > 0 && imageCount === 0);
  const hasLinkImage = !!(link && (link.image_hash || link.picture || link.image_url || link.image_crops));
  const hasImage =
    objectType === 'PHOTO' ||
    !!photo ||
    explicitImage ||
    hasLinkImage ||
    (imageCount > 0 && videoCount === 0 && !video?.video_id);

  const placementMix =
    (optimization === 'PLACEMENT' || optimization === 'ASSET_CUSTOMIZATION') &&
    imageCount > 0 &&
    videoCount > 0 &&
    !explicitVideo &&
    !explicitImage &&
    !video?.video_id &&
    !photo &&
    !hasLinkImage;
  if (placementMix) return 'other';

  if (explicitVideo && !explicitImage) return 'video';
  if (explicitImage && !explicitVideo) return 'image';
  if (hasVideo && !hasImage) return 'video';
  if (hasImage && !hasVideo) return 'image';
  if (hasVideo && hasImage) return 'other';

  // A single link ad (object_type SHARE + link_data, no cards, no video) is a static ad.
  if ((objectType === 'SHARE' || link) && !video?.video_id && childCount < 2 && videoCount === 0) return 'image';

  return 'other';
}

export function classifyCreative(
  creative: CreativeLike,
  identity: BrandIdentity,
  adset?: AdsetFormatFlags | null,
): ClassifiedAd {
  return {
    ad_source: classifyAdSource(creative, identity),
    ad_format: classifyAdFormat(creative, adset),
  };
}

export function emptyIdentity(): BrandIdentity {
  return { pageIds: new Set(), instagramIds: new Set() };
}

export function matchesAdSlice(
  ad: { ad_source?: string; ad_format?: string },
  source: AdSource | 'all',
  format: AdFormat | 'all',
): boolean {
  if (source !== 'all' && ad.ad_source !== source) return false;
  if (format !== 'all' && ad.ad_format !== format) return false;
  return true;
}

export function formatBadgeKey(format: AdFormat | undefined): string {
  switch (format) {
    case 'image':
      return 'IMAGE';
    case 'video':
      return 'VIDEO';
    case 'carousel':
      return 'CAROUSEL';
    case 'catalog':
      return 'CATALOG';
    case 'flexible':
      return 'FLEXIBLE';
    default:
      return 'UNKNOWN';
  }
}

export function sourceLabel(source: AdSource | undefined): string {
  return AD_SOURCES.find((s) => s.value === source)?.label || 'Unknown source';
}

export function formatLabel(format: AdFormat | undefined): string {
  return AD_FORMATS.find((f) => f.value === format)?.label || 'Other';
}

interface CopyRow {
  type: string;
  text: string;
  ad_ids: string[];
  ad_names: string[];
  spend: number;
  purchase_value: number;
  roas: number;
  cpa: number;
  purchases: number;
  impressions: number;
  clicks: number;
  ctr: number;
  link_ctr: number;
  cpm: number;
  cpc: number;
  add_to_cart: number;
  initiate_checkout: number;
  thumbstop_rate: number;
  reach: number;
  frequency: number;
  ad_count: number;
}

/** Rebuild copy rows so spend and totals only include ads in the selected slice. */
export function sliceCopyInputs<T extends CopyRow>(
  inputs: T[],
  ads: CopyAdMetrics[],
  source: AdSource | 'all',
  format: AdFormat | 'all',
): T[] {
  if (source === 'all' && format === 'all') return inputs;
  const byId = new Map(ads.map((ad) => [ad.ad_id, ad]));
  const sliced: T[] = [];

  for (const input of inputs) {
    const matched: CopyAdMetrics[] = [];
    for (const adId of input.ad_ids) {
      const ad = byId.get(adId);
      if (ad && matchesAdSlice(ad, source, format)) matched.push(ad);
    }
    if (matched.length === 0) continue;

    let totalSpend = 0;
    let totalPV = 0;
    let totalPurchases = 0;
    let totalImpressions = 0;
    let totalClicks = 0;
    let totalReach = 0;
    let totalATC = 0;
    let totalIC = 0;
    let weightedCTR = 0;
    let weightedLinkCTR = 0;
    let weightedThumbstop = 0;
    const adNames: string[] = [];

    for (const ad of matched) {
      adNames.push(ad.ad_name);
      totalSpend += ad.spend;
      totalPV += ad.purchase_value;
      totalPurchases += ad.purchases;
      totalImpressions += ad.impressions;
      totalClicks += ad.clicks;
      totalReach += ad.reach;
      totalATC += ad.add_to_cart;
      totalIC += ad.initiate_checkout;
      weightedCTR += ad.ctr * ad.impressions;
      weightedLinkCTR += ad.link_ctr * ad.impressions;
      weightedThumbstop += ad.thumbstop_rate * ad.impressions;
    }

    sliced.push({
      ...input,
      ad_ids: matched.map((ad) => ad.ad_id),
      ad_names: adNames,
      spend: totalSpend,
      purchase_value: totalPV,
      roas: totalSpend > 0 ? totalPV / totalSpend : 0,
      cpa: totalPurchases > 0 ? totalSpend / totalPurchases : 0,
      purchases: totalPurchases,
      impressions: totalImpressions,
      clicks: totalClicks,
      ctr: totalImpressions > 0 ? weightedCTR / totalImpressions : 0,
      link_ctr: totalImpressions > 0 ? weightedLinkCTR / totalImpressions : 0,
      cpm: totalImpressions > 0 ? (totalSpend / totalImpressions) * 1000 : 0,
      cpc: totalClicks > 0 ? totalSpend / totalClicks : 0,
      add_to_cart: totalATC,
      initiate_checkout: totalIC,
      thumbstop_rate: totalImpressions > 0 ? weightedThumbstop / totalImpressions : 0,
      reach: totalReach,
      frequency: totalReach > 0 ? totalImpressions / totalReach : 0,
      ad_count: matched.length,
    });
  }

  sliced.sort((a, b) => b.spend - a.spend);
  return sliced;
}
