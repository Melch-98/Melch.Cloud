// ─── /api/notify ──────────────────────────────────────────────
// Sends creative-upload notifications to Slack + email.
// Email goes through the central email module. Slack stays inline.

import { NextResponse } from 'next/server';
import type { CreativeUploadBatch, CreativeUploadData } from '@/lib/email/templates/creative-upload';
import { deliverCreativeUploadNotice } from '@/lib/creative-upload-notify';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const raw = await request.json();

    const data: CreativeUploadData = {
      brandName: raw.brandName || 'Unknown brand',
      batchCount: raw.batchCount ?? (raw.batches?.length || 1),
      totalFiles:
        raw.totalFiles ??
        (raw.batches?.reduce(
          (s: number, b: CreativeUploadBatch) => s + (b.fileCount || 0),
          0
        ) || 0),
      batches: Array.isArray(raw.batches) ? raw.batches : [],
    };

    const result = await deliverCreativeUploadNotice(data);
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error('Notification error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
