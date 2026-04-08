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
 * Service-role retry for stuck submissions. Same logic as sync-drive
 * but doesn't require a user session — protected by SUPABASE_SERVICE_ROLE_KEY
 * as a shared secret so only someone with admin access can trigger it.
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
       submission_files (id, file_name, file_url, file_type)`
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

  await supabase
    .from('submissions')
    .update({ drive_sync_status: 'syncing', drive_sync_error: null })
    .eq('id', sub.id);

  try {
    await ensureDropboxFolder(brand.dropbox_folder_path);
    await ensureDropboxFolder(batchPath);

    const files = sub.submission_files || [];
    const uploaded: Array<{ name: string; path: string }> = [];
    for (const f of files) {
      const { data: blob, error: dlError } = await supabase.storage
        .from('creatives')
        .download(f.file_url);
      if (dlError || !blob) {
        throw new Error(`Storage download failed for ${f.file_name}: ${dlError?.message || 'no data'}`);
      }
      const buffer = Buffer.from(await blob.arrayBuffer());
      const filePath = `${batchPath}/${sanitizeDropboxPathSegment(f.file_name)}`;
      const result = await uploadToDropbox({ path: filePath, buffer });
      uploaded.push({ name: f.file_name, path: result.path });
    }

    let folderUrl: string | null = null;
    try {
      folderUrl = await getDropboxFolderLink(batchPath);
    } catch {}

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
    });
  } catch (err: any) {
    const message =
      err instanceof DropboxNotConnectedError
        ? 'Dropbox is not connected.'
        : err?.message || String(err);

    await supabase
      .from('submissions')
      .update({ drive_sync_status: 'failed', drive_sync_error: message })
      .eq('id', sub.id);

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
