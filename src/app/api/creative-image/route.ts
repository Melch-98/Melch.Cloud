import { NextRequest, NextResponse } from 'next/server';
import { put, list } from '@vercel/blob';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Cache creative images from Meta CDN into Vercel Blob Storage.
// Meta's thumbnail_url returns 64x64 blurry images for Advantage+/flexible creatives.
// This endpoint downloads the full-res image and caches it permanently on our CDN.

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const sourceUrl = searchParams.get('url');
  const creativeId = searchParams.get('cid');

  if (!sourceUrl || !creativeId) {
    return NextResponse.json(
      { error: 'Missing required params: url, cid' },
      { status: 400 }
    );
  }

  const blobPath = `creatives/${creativeId}`;

  try {
    // Check if already cached
    const existing = await list({ prefix: blobPath, limit: 1 });
    if (existing.blobs.length > 0) {
      return NextResponse.json({ url: existing.blobs[0].url });
    }

    // Download from Meta
    const metaRes = await fetch(sourceUrl, {
      headers: { 'User-Agent': 'melch-cloud/1.0' },
      redirect: 'follow',
    });

    if (!metaRes.ok) {
      return NextResponse.json(
        { error: `Meta fetch failed: ${metaRes.status}` },
        { status: 502 }
      );
    }

    const contentType = metaRes.headers.get('content-type') || 'image/jpeg';
    const buffer = Buffer.from(await metaRes.arrayBuffer());

    // Determine extension from content type
    const ext = contentType.includes('png') ? '.png' :
                contentType.includes('webp') ? '.webp' :
                contentType.includes('gif') ? '.gif' : '.jpg';

    // Upload to Vercel Blob
    const blob = await put(`${blobPath}${ext}`, buffer, {
      access: 'public',
      contentType,
      addRandomSuffix: false,
    });

    return NextResponse.json({ url: blob.url });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
