import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
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
 * Synchronously pushes every submission file from Supabase Storage into the
 * brand's Dropbox folder. No Inngest, no background jobs. Returns when done.
 *
 * Route name kept for compatibility with existing SubmissionForm calls, but
 * the destination is now Dropbox (not Google Drive).
 */
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const authSupabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authError } = await authSupabase.auth.getUser(token);
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

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

  // Load submission + brand + files
  const { data: submission, error: subError } = await supabase
    .from('submissions')
    .select(
      `id, batch_name, brand_id, drive_sync_status,
       brands:brand_id (id, name, dropbox_folder_path),
       submission_files (id, file_name, file_url, file_type)`
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

  // mark syncing
  await supabase
    .from('submissions')
    .update({ drive_sync_status: 'syncing', drive_sync_error: null })
    .eq('id', submissionId);

  try {
    // Ensure brand folder + batch folder exist
    await ensureDropboxFolder(brandPath);
    await ensureDropboxFolder(batchPath);

    // Upload each file
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

    // Get a shareable link for the batch folder (best effort)
    let folderUrl: string | null = null;
    try {
      folderUrl = await getDropboxFolderLink(batchPath);
    } catch {
      // non-fatal
    }

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
    });
  } catch (err: any) {
    const message =
      err instanceof DropboxNotConnectedError
        ? 'Dropbox is not connected. Visit /admin/dropbox to connect.'
        : err?.message || String(err);

    await supabase
      .from('submissions')
      .update({
        drive_sync_status: 'failed',
        drive_sync_error: message,
      })
      .eq('id', submissionId);

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
