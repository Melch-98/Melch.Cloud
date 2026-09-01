-- ============================================================================
-- MIGRATION: Add Dropbox sync tracking columns.
--
-- These columns are written by the Dropbox sync pipeline
-- (/api/submissions/sync-drive, /api/admin/retry-sync, /api/cron/sync-pending)
-- but were never added to the schema, so a fresh database would fail at runtime.
-- All statements are idempotent (IF NOT EXISTS) for safe re-runs.
-- ============================================================================

-- Submissions: batch-level Dropbox sync status
ALTER TABLE submissions
  ADD COLUMN IF NOT EXISTS drive_sync_status text,
  ADD COLUMN IF NOT EXISTS drive_folder_url text,
  ADD COLUMN IF NOT EXISTS drive_folder_id text,
  ADD COLUMN IF NOT EXISTS drive_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS drive_sync_error text;

-- Backfill any existing rows so the cron's status filter picks them up
UPDATE submissions
  SET drive_sync_status = 'pending'
  WHERE drive_sync_status IS NULL;

-- Submission files: per-file Dropbox sync tracking
ALTER TABLE submission_files
  ADD COLUMN IF NOT EXISTS dropbox_path text,
  ADD COLUMN IF NOT EXISTS dropbox_job_id text;

-- Indexes for the cron's status query
CREATE INDEX IF NOT EXISTS idx_submissions_drive_sync_status
  ON submissions (drive_sync_status);
CREATE INDEX IF NOT EXISTS idx_submission_files_dropbox_path
  ON submission_files (dropbox_path);
