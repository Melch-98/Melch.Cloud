-- ─── Add Meta Ad Account mapping to brands ─────────────────────
-- Links each brand to its Meta ad account for scoped analytics.

ALTER TABLE brands
  ADD COLUMN IF NOT EXISTS meta_ad_account_id TEXT DEFAULT NULL;

COMMENT ON COLUMN brands.meta_ad_account_id IS 'Meta Ads account ID (e.g. act_123456789). Set by admin to scope analytics per brand.';
