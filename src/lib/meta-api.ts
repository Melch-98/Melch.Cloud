// ─── Meta Marketing API Service ─────────────────────────────────
// Standalone creative analytics — no connection to the upload pipeline.
// Fetches ad-level insights directly from Meta's Marketing API.
import { put, list } from '@vercel/blob';

export interface MetaAdInsight {
  ad_id: string;
  ad_name: string;
  campaign_id: string;
  campaign_name: string;
  adset_id: string;
  adset_name: string;
  // Creative
  thumbnail_url: string;
  video_url: string | null;
  creative_type: 'VIDEO' | 'IMAGE' | 'CAROUSEL' | 'UNKNOWN';
  // Financial
  spend: number;
  purchase_value: number;
  roas: number;
  cpa: number;
  // Engagement
  ctr: number;
  link_ctr: number;
  cpm: number;
  thumbstop_rate: number;
  // Conversions
  purchases: number;
  add_to_cart: number;
  initiate_checkout: number;
  cost_per_purchase: number;
  cost_per_atc: number;
  cost_per_ic: number;
  // Delivery
  impressions: number;
  reach: number;
  frequency: number;
  // Video
  video_play_25: number;
  video_play_50: number;
  video_play_75: number;
  video_play_100: number;
  // Derived
  aov: number;
  cpc: number;
  clicks: number;
}

export interface MetaAdAccount {
  id: string;
  name: string;
  currency: string;
  account_status: number;
}

export interface CopyInput {
  type: 'headline' | 'body' | 'description' | 'cta';
  text: string;
  ad_ids: string[];
  ad_names: string[];
  // Aggregated metrics
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

const META_API_BASE = 'https://graph.facebook.com/v21.0';

// ─── Fetch Single Ad Creative Media ────────────────────────────
// Lightweight call to get just the thumbnail + video for one ad.
// Tries multiple fields to find the highest-res image available.
export async function fetchAdMedia(
  accessToken: string,
  adId: string
): Promise<{ thumbnail_url: string; video_url: string | null; creative_type: string }> {
  const empty = { thumbnail_url: '', video_url: null, creative_type: 'UNKNOWN' };

  try {
    // Attempt 1: Fetch core creative fields (avoid image_urls_for_viewing — it crashes with asset_feed_spec)
    const res = await fetch(
      `${META_API_BASE}/${adId}/adcreatives` +
      `?fields=image_url,object_story_spec,asset_feed_spec,object_type,thumbnail_url,video_id` +
      `&access_token=${accessToken}&limit=1`
    );
    if (!res.ok) return empty;
    const data = await res.json();
    const c = data?.data?.[0];
    if (!c) return empty;

    // Determine creative type
    const objectType = c.object_type || '';
    const hasVideo = !!(c.video_id || c.object_story_spec?.video_data || c.asset_feed_spec?.videos?.length);
    const creativeType = hasVideo ? 'VIDEO' :
      objectType === 'SHARE' || objectType === 'PHOTO' ? 'IMAGE' : 'UNKNOWN';

    // Find best image URL (avoid p64x64)
    const storyImg = c.object_story_spec?.video_data?.image_url ||
                     c.object_story_spec?.link_data?.image_url ||
                     c.object_story_spec?.link_data?.picture ||
                     c.object_story_spec?.photo_data?.image_url || '';
    const feedImg = c.asset_feed_spec?.images?.[0]?.url || '';
    const feedVidThumb = c.asset_feed_spec?.videos?.[0]?.thumbnail_url || '';
    const topImg = c.image_url || '';
    const fallbackThumb = c.thumbnail_url || '';

    let thumbnail_url =
      (storyImg && !storyImg.includes('p64x64') ? storyImg : '') ||
      (feedVidThumb && !feedVidThumb.includes('p64x64') ? feedVidThumb : '') ||
      (feedImg && !feedImg.includes('p64x64') ? feedImg : '') ||
      (topImg && !topImg.includes('p64x64') ? topImg : '') ||
      '';

    // Attempt 2: If still no good URL, try image_urls_for_viewing separately
    if (!thumbnail_url) {
      try {
        const res2 = await fetch(
          `${META_API_BASE}/${adId}/adcreatives` +
          `?fields=image_urls_for_viewing` +
          `&access_token=${accessToken}&limit=1`
        );
        if (res2.ok) {
          const data2 = await res2.json();
          const c2 = data2?.data?.[0];
          const viewingUrls = c2?.image_urls_for_viewing || [];
          thumbnail_url = viewingUrls.find((u: string) => u && !u.includes('p64x64')) || '';
        }
      } catch { /* fallback failed */ }
    }

    // Final fallback: blurry thumbnail is better than nothing
    if (!thumbnail_url) thumbnail_url = fallbackThumb;

    // Get video source URL if applicable
    let video_url: string | null = null;
    const videoId = c.video_id || c.object_story_spec?.video_data?.video_id;
    if (videoId) {
      try {
        const vRes = await fetch(
          `${META_API_BASE}/${videoId}?fields=source&access_token=${accessToken}`
        );
        if (vRes.ok) {
          const vData = await vRes.json();
          video_url = vData.source || null;
        }
      } catch { /* video source fetch failed */ }
    }

    return { thumbnail_url, video_url, creative_type: creativeType };
  } catch {
    return empty;
  }
}

// ─── Helpers ────────────────────────────────────────────────────

function safeNum(val: string | number | undefined | null): number {
  if (val === undefined || val === null || val === '') return 0;
  const n = typeof val === 'string' ? parseFloat(val) : val;
  return isNaN(n) ? 0 : n;
}

function extractActionValue(
  actions: Array<{ action_type: string; value: string }> | undefined,
  actionType: string
): number {
  if (!actions) return 0;
  const found = actions.find((a) => a.action_type === actionType);
  return found ? safeNum(found.value) : 0;
}

function extractVideoMetric(
  videoActions: Array<{ action_type: string; value: string }> | undefined,
  actionType: string
): number {
  if (!videoActions) return 0;
  const found = videoActions.find((a) => a.action_type === actionType);
  return found ? safeNum(found.value) : 0;
}

// ─── Fetch Ad Accounts ──────────────────────────────────────────

async function fetchAllPages(url: string): Promise<any[]> {
  let results: any[] = [];
  let nextUrl: string | null = url;
  while (nextUrl) {
    const res = await fetch(nextUrl);
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error?.message || 'Failed to fetch ad accounts');
    }
    const data = await res.json();
    results = results.concat(data.data || []);
    nextUrl = data.paging?.next || null;
  }
  return results;
}

export async function fetchAdAccounts(accessToken: string): Promise<MetaAdAccount[]> {
  const fields = 'id,name,currency,account_status';
  const seen = new Set<string>();
  const accounts: MetaAdAccount[] = [];

  const businessId = process.env.META_BUSINESS_ID || '';

  // 1. Try me/adaccounts (works for user tokens)
  try {
    const meAccounts = await fetchAllPages(
      `${META_API_BASE}/me/adaccounts?fields=${fields}&limit=100&access_token=${accessToken}`
    );
    for (const a of meAccounts) {
      if (!seen.has(a.id)) {
        seen.add(a.id);
        accounts.push({ id: a.id, name: a.name, currency: a.currency, account_status: a.account_status });
      }
    }
  } catch {
    // System user tokens may not support me/adaccounts — continue
  }

  // 2. If we have a business ID, fetch client + owned ad accounts directly
  if (businessId) {
    for (const edge of ['client_ad_accounts', 'owned_ad_accounts']) {
      try {
        const bizAccounts = await fetchAllPages(
          `${META_API_BASE}/${businessId}/${edge}?fields=${fields}&limit=100&access_token=${accessToken}`
        );
        for (const a of bizAccounts) {
          if (!seen.has(a.id)) {
            seen.add(a.id);
            accounts.push({ id: a.id, name: a.name, currency: a.currency, account_status: a.account_status });
          }
        }
      } catch { /* continue */ }
    }
  }

  return accounts;
}

// ─── Fetch Creative Insights ────────────────────────────────────

export async function fetchCreativeInsights(
  accessToken: string,
  adAccountId: string,
  dateFrom: string,
  dateTo: string,
  limit = 50,
  skipMedia = false
): Promise<MetaAdInsight[]> {
  // Step 1: Get ads with insights
  const insightsFields = [
    'ad_id',
    'ad_name',
    'campaign_id',
    'campaign_name',
    'adset_id',
    'adset_name',
    'spend',
    'impressions',
    'reach',
    'frequency',
    'clicks',
    'ctr',
    'inline_link_click_ctr',
    'cpm',
    'cpc',
    'actions',
    'action_values',
    'video_thruplay_watched_actions',
    'video_p25_watched_actions',
    'video_p50_watched_actions',
    'video_p75_watched_actions',
    'video_p100_watched_actions',
    'cost_per_action_type',
  ].join(',');

  const accountId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;

  // Use smaller page size (100) to avoid Meta's "too much data" error on long date ranges.
  // Paginate through results until we hit our total limit or run out of pages.
  const pageSize = Math.min(limit, 100);
  const firstUrl =
    `${META_API_BASE}/${accountId}/insights?` +
    `fields=${insightsFields}` +
    `&time_range={"since":"${dateFrom}","until":"${dateTo}"}` +
    `&level=ad` +
    `&sort=spend_descending` +
    `&limit=${pageSize}` +
    `&access_token=${accessToken}`;

  const rawInsights: any[] = [];
  let nextUrl: string | null = firstUrl;
  let pageNum = 0;
  while (nextUrl && rawInsights.length < limit) {
    // Brief delay between pages to avoid Meta rate limits (skip first page)
    if (pageNum > 0) await new Promise(r => setTimeout(r, 500));
    pageNum++;

    const res = await fetch(nextUrl);
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      // If rate limited and we already have some data, return what we have instead of crashing
      if (rawInsights.length > 0 && (errBody.error?.code === 4 || errBody.error?.code === 32 || errBody.error?.message?.includes('limit'))) {
        console.warn(`Meta rate limit hit after ${rawInsights.length} ads — returning partial data`);
        break;
      }
      throw new Error(errBody.error?.message || 'Failed to fetch insights');
    }
    const page = await res.json();
    const pageData = page.data || [];
    rawInsights.push(...pageData);
    nextUrl = page.paging?.next || null;
  }
  // Trim to requested limit
  if (rawInsights.length > limit) rawInsights.length = limit;

  // When skipMedia is true, bypass all creative/thumbnail/video/blob steps (Steps 2a-2d)
  // This makes the call ~10x faster for analytics-only use cases (Perspective Table, etc.)
  let thumbnails: Record<string, { url: string; type: string; videoId: string | null }> = {};
  let videoSources: Record<string, string> = {};

  if (!skipMedia) {
  // Step 2a: Get creative IDs from ads
  const adIds = [...new Set(rawInsights.map((r: any) => r.ad_id))];
  const adToCreativeId: Record<string, string> = {};

  for (let i = 0; i < adIds.length; i += 50) {
    const chunk = adIds.slice(i, i + 50);
    try {
      const adsRes = await fetch(
        `${META_API_BASE}/?ids=${chunk.join(',')}&fields=creative%7Bid%7D&access_token=${accessToken}`
      );
      if (adsRes.ok) {
        const adsData = await adsRes.json();
        for (const [adId, adInfo] of Object.entries(adsData as Record<string, any>)) {
          const cId = adInfo?.creative?.id;
          if (cId) adToCreativeId[adId] = cId;
        }
      }
    } catch { /* continue */ }
  }

  // Step 2b: Fetch full creative objects directly (works for all types incl. Advantage+/flexible)
  const creativeIds = [...new Set(Object.values(adToCreativeId))];
  const creativeMap: Record<string, { url: string; type: string; videoId: string | null }> = {};

  for (let i = 0; i < creativeIds.length; i += 50) {
    const chunk = creativeIds.slice(i, i + 50);
    try {
      const cRes = await fetch(
        `${META_API_BASE}/?ids=${chunk.join(',')}` +
        `&fields=thumbnail_url,image_url,object_type,object_story_spec,asset_feed_spec` +
        `&access_token=${accessToken}`
      );
      if (cRes.ok) {
        const cData = await cRes.json();
        for (const [cId, cInfo] of Object.entries(cData as Record<string, any>)) {
          const ot = (cInfo as any).object_type?.toUpperCase() || '';
          const videoData = (cInfo as any).object_story_spec?.video_data;
          const linkData = (cInfo as any).object_story_spec?.link_data;
          const photoData = (cInfo as any).object_story_spec?.photo_data;
          const assetFeed = (cInfo as any).asset_feed_spec;

          // Determine type: check object_type, then fallback to story spec / asset_feed
          let cType = 'UNKNOWN';
          if (ot.includes('VIDEO') || videoData?.video_id) cType = 'VIDEO';
          else if (ot.includes('PHOTO') || ot.includes('IMAGE') || photoData) cType = 'IMAGE';
          else if (ot.includes('CAROUSEL') || ot.includes('MULTI')) cType = 'CAROUSEL';
          else if (ot === 'SHARE' || linkData || assetFeed?.images) cType = 'IMAGE';

          const videoId = videoData?.video_id || null;

          // Extract full-res URL from asset_feed_spec.images (Advantage+/flexible creatives)
          const assetFeedImageUrl = assetFeed?.images?.[0]?.url || '';
          // Extract thumbnail_url from asset_feed_spec.videos (Advantage+/flexible video creatives)
          const assetFeedVideoThumb = assetFeed?.videos?.[0]?.thumbnail_url || '';

          // Prefer: story spec image URLs (full res) > asset_feed_spec video thumb > asset_feed_spec image > creative.image_url > thumbnail_url (64px)
          const imageUrl =
            videoData?.image_url ||
            linkData?.image_url ||
            linkData?.picture ||
            photoData?.image_url ||
            (cInfo as any).image_url ||
            (assetFeedVideoThumb && !assetFeedVideoThumb.includes('p64x64') ? assetFeedVideoThumb : '') ||
            assetFeedImageUrl ||
            (cInfo as any).thumbnail_url ||
            '';

          // If asset_feed has videos, mark as VIDEO and get video_id
          const feedVideoId = assetFeed?.videos?.[0]?.video_id || null;
          if (feedVideoId && cType !== 'VIDEO') {
            cType = 'VIDEO';
          }

          creativeMap[cId] = { url: imageUrl, type: cType, videoId: videoId || feedVideoId };
        }
      }
    } catch { /* continue */ }
  }

  // Step 2b-hash: Resolve image hashes from asset_feed_spec.images via adimages endpoint
  // Some Advantage+/flexible creatives only return hash (no url) in asset_feed_spec.images
  const hashesToResolve: { cId: string; hash: string }[] = [];
  for (const [cId, info] of Object.entries(creativeMap)) {
    if (!info.url || info.url.includes('p64x64')) {
      // Find the original creative data to get hashes
      // We need to re-check asset_feed_spec — store hashes during Step 2b
    }
  }
  // Collect all unresolved hashes from creatives that only have blurry/missing URLs
  const unresolvedCreativeIds = Object.entries(creativeMap)
    .filter(([, info]) => !info.url || info.url.includes('p64x64'))
    .map(([cId]) => cId);

  if (unresolvedCreativeIds.length > 0) {
    // Re-fetch these creatives to get their image hashes
    try {
      const hashChunks = [];
      for (let i = 0; i < unresolvedCreativeIds.length; i += 50) {
        hashChunks.push(unresolvedCreativeIds.slice(i, i + 50));
      }
      const allHashes: string[] = [];
      const hashToCreativeId: Record<string, string> = {};

      for (const chunk of hashChunks) {
        try {
          const res = await fetch(
            `${META_API_BASE}/?ids=${chunk.join(',')}&fields=asset_feed_spec,image_hash&access_token=${accessToken}`
          );
          if (res.ok) {
            const data = await res.json();
            for (const [cId, cInfo] of Object.entries(data as Record<string, any>)) {
              const images = (cInfo as any).asset_feed_spec?.images || [];
              for (const img of images) {
                if (img.hash) {
                  allHashes.push(img.hash);
                  hashToCreativeId[img.hash] = cId;
                }
              }
              // Also check asset_feed_spec.videos[].thumbnail_hash
              const videos = (cInfo as any).asset_feed_spec?.videos || [];
              for (const vid of videos) {
                if (vid.thumbnail_hash) {
                  allHashes.push(vid.thumbnail_hash);
                  hashToCreativeId[vid.thumbnail_hash] = cId;
                }
              }
              // Also check top-level image_hash
              const topHash = (cInfo as any).image_hash;
              if (topHash) {
                allHashes.push(topHash);
                hashToCreativeId[topHash] = cId;
              }
            }
          }
        } catch { /* continue */ }
      }

      // Resolve hashes via adimages endpoint (up to 50 at a time)
      const uniqueHashes = [...new Set(allHashes)];
      if (uniqueHashes.length > 0) {
        for (let i = 0; i < uniqueHashes.length; i += 50) {
          const batch = uniqueHashes.slice(i, i + 50);
          try {
            const hashList = batch.map(h => `"${h}"`).join(',');
            const res = await fetch(
              `${META_API_BASE}/${adAccountId}/adimages?hashes=${encodeURIComponent(`[${hashList}]`)}&fields=url,permalink_url&access_token=${accessToken}`
            );
            if (res.ok) {
              const data = await res.json();
              for (const imgData of (data.data || [])) {
                const fullUrl = imgData.permalink_url || imgData.url || '';
                if (fullUrl && !fullUrl.includes('p64x64')) {
                  // Extract hash from the id field (format: "accountId:hash")
                  const imgHash = imgData.id?.split(':')?.[1] || '';
                  const cId = hashToCreativeId[imgHash];
                  if (cId && creativeMap[cId]) {
                    creativeMap[cId] = { ...creativeMap[cId], url: fullUrl };
                  }
                }
              }
            }
          } catch { /* continue */ }
        }
      }
    } catch { /* hash resolution is best-effort */ }
  }

  // Build ad-level thumbnails lookup from creative data
  for (const [adId, cId] of Object.entries(adToCreativeId)) {
    if (creativeMap[cId]) {
      thumbnails[adId] = creativeMap[cId];
    }
  }

  // Step 2b-extra: For ads still stuck on blurry 64px thumbnail,
  // fetch full creative data via ad creatives edge. Try each field SEPARATELY
  // since combining fields crashes the Meta API for Advantage+/flexible creatives.
  const blurryAdIds = Object.entries(thumbnails)
    .filter(([, info]) => info.url.includes('p64x64') || (!info.url && !info.videoId))
    .map(([adId]) => adId);
  const missingAdIds = adIds.filter((id: string) => !thumbnails[id]);
  const adsToFix = [...new Set([...blurryAdIds, ...missingAdIds])];

  if (adsToFix.length > 0) {
    // Try fetching with JUST image_url and asset_feed_spec (no image_urls_for_viewing)
    const fixResults = await Promise.allSettled(
      adsToFix.map(async (adId) => {
        // Attempt 1: image_url + asset_feed_spec + object_story_spec
        try {
          const res = await fetch(
            `${META_API_BASE}/${adId}/adcreatives` +
            `?fields=image_url,asset_feed_spec,object_story_spec,object_type` +
            `&access_token=${accessToken}&limit=1`
          );
          if (res.ok) {
            const data = await res.json();
            const c = data?.data?.[0];
            if (c) {
              const feedImg = c.asset_feed_spec?.images?.[0]?.url || '';
              const feedVidThumb = c.asset_feed_spec?.videos?.[0]?.thumbnail_url || '';
              const storyImg = c.object_story_spec?.video_data?.image_url ||
                               c.object_story_spec?.link_data?.image_url ||
                               c.object_story_spec?.photo_data?.image_url || '';
              const topImg = c.image_url || '';
              const bestUrl = (feedVidThumb && !feedVidThumb.includes('p64x64')) ? feedVidThumb :
                              (feedImg && !feedImg.includes('p64x64')) ? feedImg :
                              (storyImg && !storyImg.includes('p64x64')) ? storyImg :
                              (topImg && !topImg.includes('p64x64')) ? topImg : '';
              if (bestUrl) return { adId, url: bestUrl };
            }
          }
        } catch { /* try next */ }

        // Attempt 2: image_urls_for_viewing alone
        try {
          const res = await fetch(
            `${META_API_BASE}/${adId}/adcreatives` +
            `?fields=image_urls_for_viewing` +
            `&access_token=${accessToken}&limit=1`
          );
          if (res.ok) {
            const data = await res.json();
            const c = data?.data?.[0];
            if (c?.image_urls_for_viewing && Array.isArray(c.image_urls_for_viewing)) {
              const best = c.image_urls_for_viewing.find((u: string) => u && !u.includes('p64x64'));
              if (best) return { adId, url: best };
            }
          }
        } catch { /* continue */ }

        return null;
      })
    );

    for (const result of fixResults) {
      if (result.status !== 'fulfilled' || !result.value) continue;
      const { adId, url } = result.value;
      if (thumbnails[adId]) {
        thumbnails[adId] = { ...thumbnails[adId], url };
      } else {
        thumbnails[adId] = { url, type: 'IMAGE', videoId: null };
      }
      const cId = adToCreativeId[adId];
      if (cId && creativeMap[cId]) {
        creativeMap[cId] = { ...creativeMap[cId], url };
      }
    }
  }

  // Step 2c: Batch fetch video source URLs for video creatives
  // Use the ad account's advideos endpoint (direct /?ids= fails with permission error)
  const videoIds = Object.values(thumbnails)
    .filter((t) => t.videoId)
    .map((t) => t.videoId as string);
  const uniqueVideoIds = [...new Set(videoIds)];

  for (let i = 0; i < uniqueVideoIds.length; i += 10) {
    const chunk = uniqueVideoIds.slice(i, i + 10);
    // Fetch each video via the ad account's advideos endpoint with IN filter
    try {
      const filterValue = JSON.stringify(chunk);
      const filtering = encodeURIComponent(`[{"field":"id","operator":"IN","value":${filterValue}}]`);
      const vidRes = await fetch(
        `${META_API_BASE}/${adAccountId}/advideos?filtering=${filtering}&fields=source&limit=50&access_token=${accessToken}`
      );
      if (vidRes.ok) {
        const vidData = await vidRes.json();
        for (const vidInfo of (vidData.data || [])) {
          if (vidInfo?.id && vidInfo?.source) {
            videoSources[vidInfo.id] = vidInfo.source;
          }
        }
      }
    } catch { /* continue */ }
  }

  // Step 2d: Cache all thumbnail images to Vercel Blob (bypasses Meta CDN 64px issue)
  // Download full-res images from Meta and store on our own CDN, like AdNova does.
  try {
    // Check what's already cached
    const existingBlobs = await list({ prefix: 'creatives/', limit: 1000 });
    const blobCache: Record<string, string> = {};
    for (const blob of existingBlobs.blobs) {
      const match = blob.pathname.match(/creatives\/([^.]+)/);
      if (match) blobCache[match[1]] = blob.url;
    }

    // Find creative IDs that need caching (have a non-blurry source URL OR need downloading)
    const toCacheItems: { adId: string; cId: string; url: string }[] = [];
    for (const [adId, info] of Object.entries(thumbnails)) {
      const cId = adToCreativeId[adId] || adId;
      if (blobCache[cId]) {
        // Already cached — use blob URL
        thumbnails[adId] = { ...info, url: blobCache[cId] };
      } else if (info.url && !info.url.includes('p64x64')) {
        // Has a good source URL — queue for caching
        toCacheItems.push({ adId, cId, url: info.url });
      }
      // If url contains p64x64 and not cached, keep as-is (fallback tried above)
    }

    // Download and upload to blob in parallel (max 10 concurrent)
    const CONCURRENCY = 10;
    for (let i = 0; i < toCacheItems.length; i += CONCURRENCY) {
      const batch = toCacheItems.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(async (item) => {
          try {
            const res = await fetch(item.url, {
              headers: { 'User-Agent': 'melch-cloud/1.0' },
              redirect: 'follow',
            });
            if (!res.ok) return null;
            const contentType = res.headers.get('content-type') || 'image/jpeg';
            const buffer = Buffer.from(await res.arrayBuffer());
            const ext = contentType.includes('png') ? '.png' :
                        contentType.includes('webp') ? '.webp' : '.jpg';
            const blob = await put(`creatives/${item.cId}${ext}`, buffer, {
              access: 'public',
              contentType,
              addRandomSuffix: false,
            });
            return { adId: item.adId, blobUrl: blob.url };
          } catch { return null; }
        })
      );
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value) {
          const { adId, blobUrl } = r.value;
          if (thumbnails[adId]) {
            thumbnails[adId] = { ...thumbnails[adId], url: blobUrl };
          }
        }
      }
    }
  } catch {
    // Blob caching is best-effort — if it fails, Meta URLs still work
  }
  } // end if (!skipMedia)

  // Step 3: Map to our interface
  return rawInsights.map((row: any) => {
    const spend = safeNum(row.spend);
    const impressions = safeNum(row.impressions);
    const reach = safeNum(row.reach);
    const clicks = safeNum(row.clicks);

    // Actions
    const purchases = extractActionValue(row.actions, 'purchase');
    const addToCart = extractActionValue(row.actions, 'add_to_cart');
    const initiateCheckout = extractActionValue(row.actions, 'initiate_checkout');

    // Action values
    const purchaseValue = extractActionValue(row.action_values, 'purchase');

    // Cost per action
    const costPerPurchase = extractActionValue(row.cost_per_action_type, 'purchase');
    const costPerAtc = extractActionValue(row.cost_per_action_type, 'add_to_cart');
    const costPerIc = extractActionValue(row.cost_per_action_type, 'initiate_checkout');

    // Video metrics
    const videoP25 = extractVideoMetric(row.video_p25_watched_actions, 'video_view');
    const videoP50 = extractVideoMetric(row.video_p50_watched_actions, 'video_view');
    const videoP75 = extractVideoMetric(row.video_p75_watched_actions, 'video_view');
    const videoP100 = extractVideoMetric(row.video_p100_watched_actions, 'video_view');

    // Thumbstop = 3-second views / impressions (approximate via video_p25 if available)
    const thumbstopRate = impressions > 0 ? (videoP25 / impressions) * 100 : 0;

    const roas = spend > 0 ? purchaseValue / spend : 0;
    const cpa = purchases > 0 ? spend / purchases : 0;
    const aov = purchases > 0 ? purchaseValue / purchases : 0;

    const info = thumbnails[row.ad_id] || { url: '', type: 'UNKNOWN', videoId: null };
    const videoUrl = info.videoId ? (videoSources[info.videoId] || null) : null;

    return {
      ad_id: row.ad_id,
      ad_name: row.ad_name || '',
      campaign_id: row.campaign_id || '',
      campaign_name: row.campaign_name || '',
      adset_id: row.adset_id || '',
      adset_name: row.adset_name || '',
      thumbnail_url: info.url,
      video_url: videoUrl,
      creative_type: info.type as MetaAdInsight['creative_type'],
      spend,
      purchase_value: purchaseValue,
      roas,
      cpa,
      ctr: safeNum(row.ctr),
      link_ctr: safeNum(row.inline_link_click_ctr),
      cpm: safeNum(row.cpm),
      thumbstop_rate: thumbstopRate,
      purchases,
      add_to_cart: addToCart,
      initiate_checkout: initiateCheckout,
      cost_per_purchase: costPerPurchase,
      cost_per_atc: costPerAtc,
      cost_per_ic: costPerIc,
      impressions,
      reach,
      frequency: safeNum(row.frequency),
      video_play_25: videoP25,
      video_play_50: videoP50,
      video_play_75: videoP75,
      video_play_100: videoP100,
      aov,
      cpc: safeNum(row.cpc),
      clicks,
    };
  });
}

// ─── Fetch Copy Analysis ───────────────────────────────────────
// Extracts ad copy inputs from asset_feed_spec and object_story_spec,
// deduplicates shared copy across ads, and aggregates performance metrics.

export async function fetchCopyAnalysis(
  accessToken: string,
  adAccountId: string,
  dateFrom: string,
  dateTo: string,
  limit = 100
): Promise<CopyInput[]> {
  const accountId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;

  // Step 1: Fetch ad-level insights (same as creative insights but more ads)
  const insightsFields = [
    'ad_id', 'ad_name', 'spend', 'impressions', 'reach', 'frequency',
    'clicks', 'ctr', 'inline_link_click_ctr', 'cpm', 'cpc',
    'actions', 'action_values', 'cost_per_action_type',
    'video_p25_watched_actions',
  ].join(',');

  const url =
    `${META_API_BASE}/${accountId}/insights?` +
    `fields=${insightsFields}` +
    `&time_range={"since":"${dateFrom}","until":"${dateTo}"}` +
    `&level=ad` +
    `&sort=spend_descending` +
    `&limit=${limit}` +
    `&access_token=${accessToken}`;

  const res = await fetch(url);
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error?.message || 'Failed to fetch insights');
  }
  const insightsData = await res.json();
  const rawInsights = insightsData.data || [];

  // Build metrics map per ad
  const adMetrics: Record<string, {
    ad_name: string; spend: number; purchase_value: number; purchases: number;
    impressions: number; clicks: number; ctr: number; link_ctr: number;
    cpm: number; cpc: number; add_to_cart: number; initiate_checkout: number;
    reach: number; frequency: number; thumbstop_rate: number;
  }> = {};

  for (const row of rawInsights) {
    const spend = safeNum(row.spend);
    const impressions = safeNum(row.impressions);
    const purchases = extractActionValue(row.actions, 'purchase');
    const purchaseValue = extractActionValue(row.action_values, 'purchase');
    const addToCart = extractActionValue(row.actions, 'add_to_cart');
    const initiateCheckout = extractActionValue(row.actions, 'initiate_checkout');
    const videoP25 = extractVideoMetric(row.video_p25_watched_actions, 'video_view');
    const thumbstopRate = impressions > 0 ? (videoP25 / impressions) * 100 : 0;

    adMetrics[row.ad_id] = {
      ad_name: row.ad_name || '',
      spend,
      purchase_value: purchaseValue,
      purchases,
      impressions,
      clicks: safeNum(row.clicks),
      ctr: safeNum(row.ctr),
      link_ctr: safeNum(row.inline_link_click_ctr),
      cpm: safeNum(row.cpm),
      cpc: safeNum(row.cpc),
      add_to_cart: addToCart,
      initiate_checkout: initiateCheckout,
      reach: safeNum(row.reach),
      frequency: safeNum(row.frequency),
      thumbstop_rate: thumbstopRate,
    };
  }

  // Step 2: Get creative IDs from ads
  const adIds = Object.keys(adMetrics);
  const adToCreativeId: Record<string, string> = {};

  for (let i = 0; i < adIds.length; i += 50) {
    const chunk = adIds.slice(i, i + 50);
    try {
      const adsRes = await fetch(
        `${META_API_BASE}/?ids=${chunk.join(',')}&fields=creative%7Bid%7D&access_token=${accessToken}`
      );
      if (adsRes.ok) {
        const adsData = await adsRes.json();
        for (const [adId, adInfo] of Object.entries(adsData as Record<string, any>)) {
          const cId = adInfo?.creative?.id;
          if (cId) adToCreativeId[adId] = cId;
        }
      }
    } catch { /* continue */ }
  }

  // Step 3: Fetch asset_feed_spec and object_story_spec for copy data
  const creativeIds = [...new Set(Object.values(adToCreativeId))];
  const creativeToAdIds: Record<string, string[]> = {};
  for (const [adId, cId] of Object.entries(adToCreativeId)) {
    if (!creativeToAdIds[cId]) creativeToAdIds[cId] = [];
    creativeToAdIds[cId].push(adId);
  }

  // Collect copy inputs: key = "type::text", value = set of ad IDs
  const copyMap: Record<string, Set<string>> = {};

  for (let i = 0; i < creativeIds.length; i += 50) {
    const chunk = creativeIds.slice(i, i + 50);
    try {
      const cRes = await fetch(
        `${META_API_BASE}/?ids=${chunk.join(',')}` +
        `&fields=asset_feed_spec,object_story_spec` +
        `&access_token=${accessToken}`
      );
      if (cRes.ok) {
        const cData = await cRes.json();
        for (const [cId, cInfo] of Object.entries(cData as Record<string, any>)) {
          const relatedAdIds = creativeToAdIds[cId] || [];
          const assetFeed = (cInfo as any).asset_feed_spec;
          const storySpec = (cInfo as any).object_story_spec;

          // Extract from asset_feed_spec (Advantage+ / flexible creatives)
          if (assetFeed) {
            // Bodies (primary text)
            if (assetFeed.bodies && Array.isArray(assetFeed.bodies)) {
              for (const body of assetFeed.bodies) {
                const text = body.text?.trim();
                if (text) {
                  const key = `body::${text}`;
                  if (!copyMap[key]) copyMap[key] = new Set();
                  relatedAdIds.forEach((id) => copyMap[key].add(id));
                }
              }
            }
            // Titles (headlines)
            if (assetFeed.titles && Array.isArray(assetFeed.titles)) {
              for (const title of assetFeed.titles) {
                const text = title.text?.trim();
                if (text) {
                  const key = `headline::${text}`;
                  if (!copyMap[key]) copyMap[key] = new Set();
                  relatedAdIds.forEach((id) => copyMap[key].add(id));
                }
              }
            }
            // Descriptions
            if (assetFeed.descriptions && Array.isArray(assetFeed.descriptions)) {
              for (const desc of assetFeed.descriptions) {
                const text = desc.text?.trim();
                if (text) {
                  const key = `description::${text}`;
                  if (!copyMap[key]) copyMap[key] = new Set();
                  relatedAdIds.forEach((id) => copyMap[key].add(id));
                }
              }
            }
            // Call to action types
            if (assetFeed.call_to_action_types && Array.isArray(assetFeed.call_to_action_types)) {
              for (const cta of assetFeed.call_to_action_types) {
                const text = (typeof cta === 'string' ? cta : cta?.type || '').trim();
                if (text) {
                  const key = `cta::${text}`;
                  if (!copyMap[key]) copyMap[key] = new Set();
                  relatedAdIds.forEach((id) => copyMap[key].add(id));
                }
              }
            }
            // Also check for call_to_actions array (alternative format)
            if (assetFeed.call_to_actions && Array.isArray(assetFeed.call_to_actions)) {
              for (const cta of assetFeed.call_to_actions) {
                const text = (cta.type || '').trim();
                if (text) {
                  const key = `cta::${text}`;
                  if (!copyMap[key]) copyMap[key] = new Set();
                  relatedAdIds.forEach((id) => copyMap[key].add(id));
                }
              }
            }
            // Link URLs as description fallback
            if (assetFeed.link_urls && Array.isArray(assetFeed.link_urls)) {
              for (const linkObj of assetFeed.link_urls) {
                const displayUrl = linkObj.display_url?.trim();
                if (displayUrl) {
                  const key = `description::${displayUrl}`;
                  if (!copyMap[key]) copyMap[key] = new Set();
                  relatedAdIds.forEach((id) => copyMap[key].add(id));
                }
              }
            }
          }

          // Extract from object_story_spec (standard creatives)
          if (storySpec) {
            const linkData = storySpec.link_data;
            const videoData = storySpec.video_data;
            const spec = linkData || videoData;
            if (spec) {
              // Message / body text
              if (spec.message?.trim()) {
                const key = `body::${spec.message.trim()}`;
                if (!copyMap[key]) copyMap[key] = new Set();
                relatedAdIds.forEach((id) => copyMap[key].add(id));
              }
              // Name / headline
              if (spec.name?.trim()) {
                const key = `headline::${spec.name.trim()}`;
                if (!copyMap[key]) copyMap[key] = new Set();
                relatedAdIds.forEach((id) => copyMap[key].add(id));
              }
              // Title / headline (alias)
              if (spec.title?.trim() && spec.title !== spec.name) {
                const key = `headline::${spec.title.trim()}`;
                if (!copyMap[key]) copyMap[key] = new Set();
                relatedAdIds.forEach((id) => copyMap[key].add(id));
              }
              // Description
              if (spec.description?.trim()) {
                const key = `description::${spec.description.trim()}`;
                if (!copyMap[key]) copyMap[key] = new Set();
                relatedAdIds.forEach((id) => copyMap[key].add(id));
              }
              // CTA
              const ctaType = spec.call_to_action?.type?.trim();
              if (ctaType) {
                const key = `cta::${ctaType}`;
                if (!copyMap[key]) copyMap[key] = new Set();
                relatedAdIds.forEach((id) => copyMap[key].add(id));
              }
            }
          }
        }
      }
    } catch { /* continue */ }
  }

  // Step 4: Aggregate metrics per unique copy input
  const results: CopyInput[] = [];

  for (const [key, adIdSet] of Object.entries(copyMap)) {
    const [type, ...textParts] = key.split('::');
    const text = textParts.join('::'); // Rejoin in case text had :: in it
    const adIdArr = [...adIdSet];

    let totalSpend = 0, totalPV = 0, totalPurchases = 0;
    let totalImpressions = 0, totalClicks = 0, totalReach = 0;
    let totalATC = 0, totalIC = 0;
    let weightedCTR = 0, weightedLinkCTR = 0, weightedThumbstop = 0;
    const adNames: string[] = [];

    for (const adId of adIdArr) {
      const m = adMetrics[adId];
      if (!m) continue;
      adNames.push(m.ad_name);
      totalSpend += m.spend;
      totalPV += m.purchase_value;
      totalPurchases += m.purchases;
      totalImpressions += m.impressions;
      totalClicks += m.clicks;
      totalReach += m.reach;
      totalATC += m.add_to_cart;
      totalIC += m.initiate_checkout;
      // Weight CTR/thumbstop by impressions
      weightedCTR += m.ctr * m.impressions;
      weightedLinkCTR += m.link_ctr * m.impressions;
      weightedThumbstop += m.thumbstop_rate * m.impressions;
    }

    const roas = totalSpend > 0 ? totalPV / totalSpend : 0;
    const cpa = totalPurchases > 0 ? totalSpend / totalPurchases : 0;
    const ctr = totalImpressions > 0 ? weightedCTR / totalImpressions : 0;
    const linkCtr = totalImpressions > 0 ? weightedLinkCTR / totalImpressions : 0;
    const cpm = totalImpressions > 0 ? (totalSpend / totalImpressions) * 1000 : 0;
    const cpc = totalClicks > 0 ? totalSpend / totalClicks : 0;
    const thumbstop = totalImpressions > 0 ? weightedThumbstop / totalImpressions : 0;
    const freq = totalReach > 0 ? totalImpressions / totalReach : 0;

    results.push({
      type: type as CopyInput['type'],
      text,
      ad_ids: adIdArr,
      ad_names: adNames,
      spend: totalSpend,
      purchase_value: totalPV,
      roas,
      cpa,
      purchases: totalPurchases,
      impressions: totalImpressions,
      clicks: totalClicks,
      ctr,
      link_ctr: linkCtr,
      cpm,
      cpc,
      add_to_cart: totalATC,
      initiate_checkout: totalIC,
      thumbstop_rate: thumbstop,
      reach: totalReach,
      frequency: freq,
      ad_count: adIdArr.length,
    });
  }

  // Sort by spend descending by default
  results.sort((a, b) => b.spend - a.spend);

  return results;
}
