-- Creative auto-tag + Dropbox rename.
-- Apply this on production Supabase before or with the deploy that reads these columns.
-- Existing rows are left as they are. There is no backfill.

ALTER TABLE submission_files
  ADD COLUMN IF NOT EXISTS original_file_name text;

ALTER TABLE submission_files
  ADD COLUMN IF NOT EXISTS auto_tags jsonb;

ALTER TABLE submission_files
  ADD COLUMN IF NOT EXISTS tag_source text;

ALTER TABLE brands
  ADD COLUMN IF NOT EXISTS file_naming_pattern text;

COMMENT ON COLUMN submission_files.original_file_name IS
  'Filename as uploaded. file_name is the name used in Dropbox.';

COMMENT ON COLUMN submission_files.auto_tags IS
  'Auto-tag model output and confidences. name_edited is true when someone typed their own file name. Preview frames are removed after tagging.';

COMMENT ON COLUMN submission_files.tag_source IS
  'ai, user, mixed, pending, fallback, or failed.';

COMMENT ON COLUMN brands.file_naming_pattern IS
  'Optional Dropbox filename pattern. Tokens: {Brand} {Product} {HookSlug} {Type} {CreatorOrUGC} {AspectOrLength}. Empty tokens are omitted. Null uses the default.';
