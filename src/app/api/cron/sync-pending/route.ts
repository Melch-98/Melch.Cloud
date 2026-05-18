import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import {
  ensureDropboxFolder,
  uploadToDropbox,
  getDropboxFolderLink,
  sanitizeDropboxPathSegment,
  DropboxNotConnectedError,
} from '@/lib/dropbox';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * GET /api/cron/sync-pending
 *
 * Vercel Cron job that picks up ALL non-synced submissions and processes them
 * one batch at a time. Each file is tracked individually via
 * `submission_files.dropbox_path`, so if the function times out mid-batch,
 * the next run picks up where it left off.
 *
 * Also callable manually via POST (with auth) for immediate bulk retry.
 *
 * Statuses handled:
 *   - pending   → never attempted or initial fire-and-forget failed silently
 *   - syncing   → stuck mid-sync (function timed out, status never updated)
 *   - partial   → some files synced before timeout/error
 *   - failed    → explicit failure, worth retrying
 *
 * Skips: synced (done), null (pre-pipeline submissions)
 */
async function runSync() {
  const supabase = createServiceClient();

  // Find all submissions that need syncing, ordered oldest-first
  const { data: stuck, error: queryError } = await supabase
    .from('submissions')
    .select('id, batch_name, brand_id, drive_sync_status, created_at')
    .in('drive_sync_status', ['pending', 'syncing', 'partial', 'failed'])
    .order('created_at', { ascending: true })
    .limit(50);

  if (queryError) {
    return NextResponse.json(
      { error: `Query failed: ${queryError.message}` },
      { status: 500 }
    );
  }

  if (!stuck || stuck.length === 0) {
    return NextResponse.json({ ok: true, message: 'No pending batches', processed: 0 });
  }

  const results: Array<{
    id: string;
    batch_name: string;
    status: string;
    uploaded: number;
    skipped: number;
    total: number;
    error?: string;
  }> = [];

  // Track time — leave 30s buffer before Vercel kills us at 300s
  const startTime = Date.now();
  const TIME_LIMIT_MS = 270_000; // 270s = 4.5 minutes

  for (const sub of stuck) {
    // Check if we're running low on time
    if (Date.now() - startTime > TIME_LIMIT_MS) {
      results.push({
        id: sub.id,
        batch_name: sub.batch_name,
        status: 'skipped_time_limit',
        uploaded: 0,
        skipped: 0,
        total: 0,
      });
      continue; // Don't break — record all remaining as skipped
    }

    try {
      const result = await syncOneBatch(supabase, sub.id);
      results.push({
        id: sub.id,
        batch_name: sub.batch_name,
        ...result,
      });
    } catch (err: any) {
      results.push({
        id: sub.id,
        batch_name: sub.batch_name,
        status: 'error',
        uploaded: 0,
        skipped: 0,
        total: 0,
        error: err?.message || String(err),
      });
    }

    // If this batch used most of our time, stop processing more
    if (Date.now() - startTime > TIME_LIMIT_MS) {
      break;
    }
  }

  const totalUploaded = results.reduce((s, r) => s + r.uploaded, 0);
  return NextResponse.json({
    ok: true,
    processed: results.length,
    totalPending: stuck.length,
    totalUploaded,
    results,
  });
}

/**
 * Sync a single batch — same resumable logic as sync-drive/retry-sync.
 */
async function syncOneBatch(
  supabase: ReturnType<typeof createServiceClient>,
  submissionId: string
): Promise<{ status: string; uploaded: number; skipped: number; total: number; error?: string }> {
  // Load full submission data
  const { data: submission, error: subError } = await supabase
    .from('submissions')
    .select(
      `id, batch_name, brand_id, drive_sync_status,
       brands:brand_id (id, name, dropbox_folder_path),
       submission_files (id, file_name, file_url, file_type, file_size, dropbox_path)`
    )
    .eq('id', submissionId)
    .single();

  if (subError || !submission) {
    return { status: 'not_found', uploaded: 0, skipped: 0, total: 0 };
  }

  const sub = submission as any;

  if (sub.drive_sync_status === 'synced') {
    return { status: 'already_synced', uploaded: 0, skipped: 0, total: 0 };
  }

  const brand = sub.brands;
  const brandName = brand?.name || 'Unknown Brand';
  const brandPath =
    brand?.dropbox_folder_path || `/${sanitizeDropboxPathSegment(brandName)}`;
  const batchSegment = sanitizeDropboxPathSegment(sub.batch_name);
  const batchPath = `${brandPath}/${batchSegment}`;

  const allFiles: any[] = sub.submission_files || [];
  const pendingFiles = allFiles.filter((f: any) => !f.dropbox_path);

  // All files already have dropbox_path — just finalize the submission row
  if (pendingFiles.length === 0) {
    let folderUrl: string | null = null;
    try {
      folderUrl = await getDropboxFolderLink(batchPath);
    } catch { /* non-fatal */ }

    await supabase
      .from('submissions')
      .update({
        drive_sync_status: 'synced',
        drive_folder_url: folderUrl,
        drive_folder_id: batchPath,
        drive_synced_at: new Date().toISOString(),
        drive_sync_error: null,
      })
      .eq('id', submissionId);

    return { status: 'synced', uploaded: 0, skipped: allFiles.length, total: allFiles.length };
  }

  // Mark as syncing
  await supabase
    .from('submissions')
    .update({ drive_sync_status: 'syncing', drive_sync_error: null })
    .eq('id', submissionId);

  try {
    await ensureDropboxFolder(brandPath);
    await ensureDropboxFolder(batchPath);

    let uploadedCount = 0;
    for (const f of pendingFiles) {
      const { data: blob, error: dlError } = await supabase.storage
        .from('creatives')
        .download(f.file_url);

      if (dlError || !blob) {
        throw new Error(
          `Storage download failed for ${f.file_name}: ${dlError?.message || 'no data'}`
        );
      }

      const buffer = Buffer.from(await blob.arrayBuffer());
      const filePath = `${batchPath}/${sanitizeDropboxPathSegment(f.file_name)}`;
      const result = await uploadToDropbox({ path: filePath, buffer });

      // Mark THIS file as synced immediately
      await supabase
        .from('submission_files')
        .update({ dropbox_path: result.path })
        .eq('id', f.id);

      uploadedCount++;
    }

    // All files done — finalize
    let folderUrl: string | null = null;
    try {
      folderUrl = await getDropboxFolderLink(batchPath);
    } catch { /* non-fatal */ }

    await supabase
      .from('submissions')
      .update({
        drive_sync_status: 'synced',
        drive_folder_url: folderUrl,
        drive_folder_id: batchPath,
        drive_synced_at: new Date().toISOString(),
        drive_sync_error: null,
      })
      .eq('id', submissionId);

    return {
      status: 'synced',
      uploaded: uploadedCount,
      skipped: allFiles.length - pendingFiles.length,
      total: allFiles.length,
    };
  } catch (err: any) {
    const message =
      err instanceof DropboxNotConnectedError
        ? 'Dropbox not connected'
        : err?.message || String(err);

    // Count how many were synced before failure
    const { count } = await supabase
      .from('submission_files')
      .select('id', { count: 'exact', head: true })
      .eq('submission_id', submissionId)
      .not('dropbox_path', 'is', null);

    const syncedCount = count || 0;
    const totalCount = allFiles.length;
    const partial = syncedCount > 0 && syncedCount < totalCount;

    await supabase
      .from('submissions')
      .update({
        drive_sync_status: partial ? 'partial' : 'failed',
        drive_sync_error: partial
          ? `${message} (${syncedCount}/${totalCount} synced — will retry)`
          : message,
      })
      .eq('id', submissionId);

    return {
      status: partial ? 'partial' : 'failed',
      uploaded: syncedCount,
      skipped: 0,
      total: totalCount,
      error: message,
    };
  }
}

// GET — Vercel cron calls this
export async function GET(req: NextRequest) {
  // Verify cron secret (Vercel sends this header for cron jobs)
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  // Allow if CRON_SECRET matches, or if no CRON_SECRET is set (dev mode)
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return runSync();
}

// POST — manual trigger from admin UI
export async function POST(req: NextRequest) {
  // For manual triggers, accept either CRON_SECRET or a valid admin session
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    return runSync();
  }

  // Check for admin session
  const supabase = createServiceClient();
  const token = authHeader?.replace('Bearer ', '');
  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from('users_profile')
    .select('role')
    .eq('id', user.id)
    .single();

  if (!profile || profile.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden — admin only' }, { status: 403 });
  }

  return runSync();
}
