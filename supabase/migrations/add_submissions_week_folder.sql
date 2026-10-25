-- Upload week folder on a creative batch. Additive and nullable.
-- Existing rows stay null. Live /upload does not read or write this column.
-- /upload-v2 writes it only after this migration is applied, and only when
-- SUBMIT_WRITES_WEEK_FOLDER in src/components/upload-v2/submit-flags.ts is true.
-- Do not infer the column from a failed insert. Format is the ISO week-year
-- and week, for example 2026/Week 43. 2025-12-29 is 2026/Week 1.

ALTER TABLE submissions
  ADD COLUMN IF NOT EXISTS week_folder text;
