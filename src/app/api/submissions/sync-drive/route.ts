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
 * POST /api/submissions/sync-drive
 * Body: { submission_id: string }
 *
 * Pushes submission files from Supabase Storage into the brand's Dropbox folder.
 *
 * **Resumable**: each file is tracked individually via `submission_files.dropbox_path`.
 * Files that already have a dropbox_path are skipped. If the function times out
 * mid-batch, a retry will pick up where it left off.
 *
 * Route name kept for compatibility with existing SubmissionForm calls, but
 * the destination is now Dropbox (not Google Drive).
 */
export async function POST(req: NextRequest) {
  let body: { submission_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const submissionId = body.submission_id;
  if (!submissionId) {
    return NextResponse.json({ error: 'submission_id required' }, { status: 400 });
  }

  const supabase = createServiceClient();

  // Load submission + brand + files (include dropbox_path for resume check)
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
    return NextResponse.json({ error: 'Submission not found' }, { status: 404 });
  }

  const sub = submission as any;

  if (sub.drive_sync_status === 'synced') {
    return NextResponse.json({ ok: true, skipped: 'already_synced' });
  }

  const brand = sub.brands;
  const brandName = brand?.name || 'Unknown Brand';
  const brandPath =
    brand?.dropbox_folder_path || `/${sanitizeDropboxPathSegment(brandName)}`;
  const batchSegment = sanitizeDropboxPathSegment(sub.batch_name);
  const batchPath = `${brandPath}/${batchSegment}`;

  const allFiles: any[] = sub.submission_files || [];
  const pendingFiles = allFiles.filter((f: any) => !f.dropbox_path);

  // If all files already synced (e.g. previous partial run finished them all),
  // just finalize the submission row.
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

    return NextResponse.json({
      ok: true,
      folder_path: batchPath,
      folder_url: folderUrl,
      uploaded: 0,
      skipped: allFiles.length,
      message: 'All files were already synced, finalized submission.',
    });
  }

  // Mark syncing
  await supabase
    .from('submissions')
    .update({ drive_sync_status: 'syncing', drive_sync_error: null })
    .eq('id', submissionId);

  try {
    // Ensure brand folder + batch folder exist
    await ensureDropboxFolder(brandPath);
    await ensureDropboxFolder(batchPath);

    // Upload each PENDING file, marking it individually as we go.
    // If the function times out, already-synced files won't be re-uploaded.
    const uploaded: Array<{ name: string; path: string }> = [];
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

      // Mark THIS file as synced immediately so it's skipped on retry
      await supabase
        .from('submission_files')
        .update({ dropbox_path: result.path })
        .eq('id', f.id);

      uploaded.push({ name: f.file_name, path: result.path });
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

    return NextResponse.json({
      ok: true,
      folder_path: batchPath,
      folder_url: folderUrl,
      uploaded: uploaded.length,
      skipped: allFiles.length - pendingFiles.length,
    });
  } catch (err: any) {
    const message =
      err instanceof DropboxNotConnectedError
        ? 'Dropbox is not connected. Visit /admin/dropbox to connect.'
        : err?.message || String(err);

    // Count how many we managed to sync before failure
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
          ? `${message} (${syncedCount}/${totalCount} files synced — retry to continue)`
          : message,
      })
      .eq('id', submissionId);

    return NextResponse.json(
      {
        error: message,
        synced: syncedCount,
        total: totalCount,
        retryable: partial,
      },
      { status: 500 }
    );
  }
}
