-- Optional JSON metadata on brand_integrations (e.g. trybe_brand_id / trybe_program_id)
ALTER TABLE brand_integrations
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN brand_integrations.metadata IS
  'Provider-specific non-secret config. For trybe: trybe_brand_id, trybe_program_id, trybe_program_name';
