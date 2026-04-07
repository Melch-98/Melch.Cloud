-- ============================================================================
-- MIGRATION: Add batch-level status pipeline to submissions
-- Pipeline: new → building → ready → launched
-- ============================================================================

-- Create the batch status enum
DO $$ BEGIN
  CREATE TYPE batch_status AS ENUM ('new', 'building', 'ready', 'launched');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Add batch_status column (defaults to 'new' for new submissions)
ALTER TABLE submissions
  ADD COLUMN IF NOT EXISTS batch_status batch_status DEFAULT 'new';

-- Add launched_at timestamp
ALTER TABLE submissions
  ADD COLUMN IF NOT EXISTS launched_at timestamptz;

-- Update existing rows to 'new' if null
UPDATE submissions SET batch_status = 'new' WHERE batch_status IS NULL;

-- Index for fast pipeline queries
CREATE INDEX IF NOT EXISTS idx_submissions_batch_status ON submissions(batch_status);
