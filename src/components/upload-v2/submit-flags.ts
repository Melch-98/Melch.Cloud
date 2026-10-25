import { weekFolderStorageLabel } from '@/components/upload-v2/model';

/**
 * submissions.week_folder is added by supabase/migrations/add_submissions_week_folder.sql.
 * Leave this false until that migration is applied.
 * Submit must not check whether the column exists. Flip this constant on after the migration.
 */
export const SUBMIT_WRITES_WEEK_FOLDER = false;

/** Extra insert columns for the submission row. Empty while the flag is off. */
export function weekFolderInsert(
  uploadedAt: Date,
  enabled: boolean = SUBMIT_WRITES_WEEK_FOLDER,
): { week_folder: string } | Record<string, never> {
  if (!enabled) return {};
  return { week_folder: weekFolderStorageLabel(uploadedAt) };
}
