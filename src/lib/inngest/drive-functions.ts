import { inngest } from './client';
import { createServiceClient } from '@/lib/supabase-server';
import { createDriveFolder, uploadFileToDrive } from '@/lib/google-drive';

/**
 * On submission.created:
 *   1. Load the submission + files + brand
 *   2. If brand has no drive_folder_id → mark skipped
 *   3. Create a child folder named after the batch
 *   4. Download each file from Supabase Storage and upload to Drive
 *   5. Save the Drive folder URL on the submission
 *
 * Idempotent: if drive_sync_status is already `synced`, no-op.
 * Retries are handled by Inngest.
 */
export const handleSubmissionCreated = inngest.createFunction(
  {
    id: 'submission-drive-sync',
    name: 'Sync submission batch to Google Drive',
    retries: 3,
  },
  { event: 'submission/created' },
  async ({ event, step }) => {
    const { submission_id } = event.data;
    const supabase = createServiceClient();

    // 1. Load submission + brand + files
    const submission = await step.run('load-submission', async () => {
      const { data, error } = await supabase
        .from('submissions')
        .select(
          `id, batch_name, brand_id, drive_sync_status,
           brands:brand_id (id, name, drive_folder_id),
           submission_files (id, file_name, file_url, file_type)`
        )
        .eq('id', submission_id)
        .single();

      if (error) throw new Error(`Load submission failed: ${error.message}`);
      if (!data) throw new Error(`Submission ${submission_id} not found`);
      return data as any;
    });

    // Already synced — bail
    if (submission.drive_sync_status === 'synced') {
      return { skipped: true, reason: 'already synced' };
    }

    const brandFolderId: string | null = submission.brands?.drive_folder_id || null;

    // No Drive folder configured for this brand → skip
    if (!brandFolderId) {
      await step.run('mark-skipped', async () => {
        await supabase
          .from('submissions')
          .update({
            drive_sync_status: 'skipped',
            drive_sync_error: 'Brand has no drive_folder_id configured',
          })
          .eq('id', submission_id);
      });
      return { skipped: true, reason: 'no brand drive_folder_id' };
    }

    // 2. Mark as syncing
    await step.run('mark-syncing', async () => {
      await supabase
        .from('submissions')
        .update({ drive_sync_status: 'syncing', drive_sync_error: null })
        .eq('id', submission_id);
    });

    try {
      // 3. Create batch folder in Drive
      const folder = await step.run('create-drive-folder', async () => {
        return await createDriveFolder(brandFolderId, submission.batch_name);
      });

      // 4. Upload each file
      const files = submission.submission_files || [];
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        await step.run(`upload-file-${i}`, async () => {
          // Download from Supabase Storage
          const { data: blob, error: dlError } = await supabase.storage
            .from('creatives')
            .download(f.file_url);
          if (dlError || !blob) {
            throw new Error(`Storage download failed for ${f.file_name}: ${dlError?.message || 'no data'}`);
          }
          const buffer = Buffer.from(await blob.arrayBuffer());
          await uploadFileToDrive({
            folderId: folder.id,
            fileName: f.file_name,
            mimeType: f.file_type || 'application/octet-stream',
            buffer,
          });
        });
      }

      // 5. Mark synced + save folder URL
      await step.run('mark-synced', async () => {
        await supabase
          .from('submissions')
          .update({
            drive_folder_id: folder.id,
            drive_folder_url: folder.url,
            drive_sync_status: 'synced',
            drive_synced_at: new Date().toISOString(),
            drive_sync_error: null,
          })
          .eq('id', submission_id);
      });

      return { synced: true, folder_id: folder.id, folder_url: folder.url, file_count: files.length };
    } catch (err) {
      // Mark failed — Inngest retries will re-enter the function
      await step.run('mark-failed', async () => {
        await supabase
          .from('submissions')
          .update({
            drive_sync_status: 'failed',
            drive_sync_error: err instanceof Error ? err.message : String(err),
          })
          .eq('id', submission_id);
      });
      throw err;
    }
  }
);

export const driveFunctions = [handleSubmissionCreated];
