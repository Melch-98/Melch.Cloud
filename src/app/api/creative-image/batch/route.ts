import { NextRequest, NextResponse } from 'next/server';
import { put, list } from '@vercel/blob';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Batch cache creative images from Meta into Vercel Blob.
// Accepts array of { cid, url } objects. Returns { cid: blobUrl } map.
// Skips already-cached images. Downloads new ones in parallel.

interface CacheRequest {
  cid: string;
  url: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const items: CacheRequest[] = body.items;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'Missing items array' }, { status: 400 });
    }

    // Check what's already cached
    const existing = await list({ prefix: 'creatives/', limit: 1000 });
    const cachedMap: Record<string, string> = {};
    for (const blob of existing.blobs) {
      // Extract creative ID from path like "creatives/12345.jpg"
      const match = blob.pathname.match(/creatives\/([^.]+)/);
      if (match) cachedMap[match[1]] = blob.url;
    }

    const results: Record<string, string> = {};
    const toDownload: CacheRequest[] = [];

    for (const item of items) {
      if (cachedMap[item.cid]) {
        results[item.cid] = cachedMap[item.cid];
      } else if (item.url && !item.url.includes('p64x64')) {
        toDownload.push(item);
      }
    }

    // Download and cache new images in parallel (max 10 concurrent)
    const CONCURRENCY = 10;
    for (let i = 0; i < toDownload.length; i += CONCURRENCY) {
      const batch = toDownload.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.allSettled(
        batch.map(async (item) => {
          try {
            const res = await fetch(item.url, {
              headers: { 'User-Agent': 'melch-cloud/1.0' },
              redirect: 'follow',
            });
            if (!res.ok) return { cid: item.cid, url: '' };

            const contentType = res.headers.get('content-type') || 'image/jpeg';
            const buffer = Buffer.from(await res.arrayBuffer());

            const ext = contentType.includes('png') ? '.png' :
                        contentType.includes('webp') ? '.webp' :
                        contentType.includes('gif') ? '.gif' : '.jpg';

            const blob = await put(`creatives/${item.cid}${ext}`, buffer, {
              access: 'public',
              contentType,
              addRandomSuffix: false,
            });

            return { cid: item.cid, url: blob.url };
          } catch {
            return { cid: item.cid, url: '' };
          }
        })
      );

      for (const result of batchResults) {
        if (result.status === 'fulfilled' && result.value.url) {
          results[result.value.cid] = result.value.url;
        }
      }
    }

    return NextResponse.json({ cached: results });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
