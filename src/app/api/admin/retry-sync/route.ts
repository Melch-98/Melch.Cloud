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
 * POST /api/admin/retry-sync
 * Body: { submission_id: string, secret: string }
 *
 * Service-role retry for stuck submissions. Resumable — skips files that
 * already have a dropbox_path set from a previous partial run.
 */
export async function POST(req: NextRequest) {
  let body: { submission_id?: string; secret?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (body.secret !== process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!body.submission_id) {
    return NextResponse.json({ error: 'submission_id required' }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data: submission, error: subError } = await supabase
    .from('submissions')
    .select(
      `id, batch_name, brand_id,
       brands:brand_id (id, name, dropbox_folder_path),
       submission_files (id, file_name, file_url, file_type, file_size, dropbox_path)`
    )
    .eq('id', body.submission_id)
    .single();

  if (subError || !submission) {
    return NextResponse.json({ error: 'Submission not found' }, { status: 404 });
  }
  const sub = submission as any;

  const brand = sub.brands;
  if (!brand?.dropbox_folder_path) {
    return NextResponse.json(
      { error: `Brand ${brand?.name || sub.brand_id} has no dropbox_folder_path set` },
      { status: 400 }
    );
  }

  const batchSegment = sanitizeDropboxPathSegment(sub.batch_name);
  const batchPath = `${brand.dropbox_folder_path}/${batchSegment}`;

  const allFiles: any[] = sub.submission_files || [];
  const pendingFiles = allFiles.filter((f: any) => !f.dropbox_path);

  // If all files already synced, just finalize
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
      .eq('id', sub.id);

    return NextResponse.json({
      ok: true,
      batch: sub.batch_name,
      folder_path: batchPath,
      folder_url: folderUrl,
      uploaded: 0,
      skipped: allFiles.length,
      message: 'All files already synced, finalized.',
    });
  }

  await supabase
    .from('submissions')
    .update({ drive_sync_status: 'syncing', drive_sync_error: null })
    .eq('id', sub.id);

  try {
    await ensureDropboxFolder(brand.dropbox_folder_path);
    await ensureDropboxFolder(batchPath);

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

      // Mark this file as synced immediately
      await supabase
        .from('submission_files')
        .update({ dropbox_path: result.path })
        .eq('id', f.id);

      uploaded.push({ name: f.file_name, path: result.path });
    }

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
      .eq('id', sub.id);

    return NextResponse.json({
      ok: true,
      batch: sub.batch_name,
      folder_path: batchPath,
      folder_url: folderUrl,
      uploaded: uploaded.length,
      skipped: allFiles.length - pendingFiles.length,
    });
  } catch (err: any) {
    const message =
      err instanceof DropboxNotConnectedError
        ? 'Dropbox is not connected.'
        : err?.message || String(err);

    const { count } = await supabase
      .from('submission_files')
      .select('id', { count: 'exact', head: true })
      .eq('submission_id', sub.id)
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
      .eq('id', sub.id);

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
