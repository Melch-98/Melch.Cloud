import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createDriveFolder, uploadFileToDrive, getDriveClient } from '@/lib/google-drive';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * TEMPORARY DEBUG ENDPOINT
 * GET /api/admin/test-drive-sync
 *
 * Runs the Drive sync logic synchronously against the two known stuck TLW
 * submissions and returns a detailed JSON report. No auth — limited to two
 * hardcoded submission IDs so it can't be abused. Delete after debugging.
 */

const STUCK_SUBMISSION_IDS = [
  '73f63dfd-b368-4c8f-8a4d-8286d6be2c66', // TLW_260408_0001
  '6b6fc13d-fed6-4a07-8fa6-9177f4a288d3', // TLW_260408_0002
];

type StepResult = {
  step: string;
  ok: boolean;
  data?: unknown;
  error?: string;
  stack?: string;
};

async function runForSubmission(submissionId: string, supabase: ReturnType<typeof createClient>) {
  const steps: StepResult[] = [];
  const record = (step: string, ok: boolean, data?: unknown, err?: unknown): StepResult => {
    const r: StepResult = { step, ok };
    if (data !== undefined) r.data = data;
    if (err) {
      r.error = err instanceof Error ? err.message : String(err);
      if (err instanceof Error && err.stack) r.stack = err.stack.split('\n').slice(0, 6).join('\n');
    }
    steps.push(r);
    return r;
  };

  try {
    // 1. Load submission + brand + files
    const { data: sub, error: loadErr } = await supabase
      .from('submissions')
      .select(
        `id, batch_name, brand_id,
         brands:brand_id (id, name, drive_folder_id),
         submission_files (id, file_name, file_url, file_type)`
      )
      .eq('id', submissionId)
      .single();

    if (loadErr || !sub) {
      record('load-submission', false, null, loadErr || new Error('not found'));
      return { submissionId, ok: false, steps };
    }
    const subAny = sub as any;
    record('load-submission', true, {
      batch_name: subAny.batch_name,
      file_count: subAny.submission_files?.length || 0,
      brand: subAny.brands?.name,
      drive_folder_id: subAny.brands?.drive_folder_id,
    });

    const brandFolderId = subAny.brands?.drive_folder_id;
    if (!brandFolderId) {
      record('check-brand-folder', false, null, new Error('brand has no drive_folder_id'));
      return { submissionId, ok: false, steps };
    }

    // 2. Verify Drive client / service account email
    try {
      const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '';
      const parsed = JSON.parse(raw);
      const topKeys = Object.keys(parsed);
      record('parse-credentials', true, {
        top_level_keys: topKeys,
        client_email: parsed.client_email || '(missing)',
        private_key_length: parsed.private_key ? parsed.private_key.length : 0,
        private_key_starts_with: parsed.private_key ? parsed.private_key.slice(0, 30) : null,
        private_key_has_literal_backslash_n: parsed.private_key ? parsed.private_key.includes('\\n') : null,
        private_key_has_real_newlines: parsed.private_key ? parsed.private_key.includes('\n') : null,
        type: parsed.type,
        project_id: parsed.project_id,
      });
    } catch (e) {
      record('parse-credentials', false, null, e);
      return { submissionId, ok: false, steps };
    }

    // 3. Probe parent folder existence + permission
    try {
      const drive = getDriveClient();
      const meta = await drive.files.get({
        fileId: brandFolderId,
        fields: 'id, name, mimeType, capabilities, driveId',
        supportsAllDrives: true,
      });
      record('probe-parent-folder', true, {
        name: meta.data.name,
        mimeType: meta.data.mimeType,
        canAddChildren: meta.data.capabilities?.canAddChildren,
        driveId: meta.data.driveId,
      });
    } catch (e) {
      record('probe-parent-folder', false, null, e);
      return { submissionId, ok: false, steps };
    }

    // 4. Create batch folder
    let folder: { id: string; url: string };
    try {
      folder = await createDriveFolder(brandFolderId, subAny.batch_name);
      record('create-drive-folder', true, folder);
    } catch (e) {
      record('create-drive-folder', false, null, e);
      return { submissionId, ok: false, steps };
    }

    // 5. Upload files
    const files = subAny.submission_files || [];
    for (const f of files) {
      try {
        const { data: blob, error: dlErr } = await supabase.storage
          .from('creatives')
          .download(f.file_url);
        if (dlErr || !blob) {
          record(`download-${f.file_name}`, false, null, dlErr || new Error('no blob'));
          continue;
        }
        const buf = Buffer.from(await blob.arrayBuffer());
        const up = await uploadFileToDrive({
          folderId: folder.id,
          fileName: f.file_name,
          mimeType: f.file_type || 'application/octet-stream',
          buffer: buf,
        });
        record(`upload-${f.file_name}`, true, { id: up.id, size: buf.length });
      } catch (e) {
        record(`upload-${f.file_name}`, false, null, e);
      }
    }

    // 6. Mark synced
    const allUploadsOk = steps
      .filter((s) => s.step.startsWith('upload-'))
      .every((s) => s.ok);
    if (allUploadsOk) {
      await supabase
        .from('submissions')
        .update({
          drive_folder_id: folder.id,
          drive_folder_url: folder.url,
          drive_sync_status: 'synced',
          drive_synced_at: new Date().toISOString(),
          drive_sync_error: null,
        })
        .eq('id', submissionId);
      record('mark-synced', true, { folder_url: folder.url });
    }

    return { submissionId, ok: allUploadsOk, steps };
  } catch (e) {
    record('uncaught', false, null, e);
    return { submissionId, ok: false, steps };
  }
}

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const results = [];
  for (const id of STUCK_SUBMISSION_IDS) {
    results.push(await runForSubmission(id, supabase));
  }

  return NextResponse.json({
    env: {
      has_google_json: !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON,
      has_supabase_url: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
      has_service_role: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    },
    results,
  });
}
