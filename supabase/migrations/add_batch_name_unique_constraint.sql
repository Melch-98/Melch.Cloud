-- Add unique constraint to prevent duplicate batch names.
-- This is the DB-level safety net: even if a race condition in the API
-- generates the same name twice, the second INSERT will fail and can be retried.
ALTER TABLE submissions
  ADD CONSTRAINT submissions_batch_name_unique UNIQUE (batch_name);
