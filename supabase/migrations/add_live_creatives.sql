-- Live Meta creatives tagged by the landing-page product. No AI.
-- One row per brand, platform, ad, and asset.
-- Flexible / Advantage+ ads: one row per image hash or video id.
-- Catalog / DPA ads: asset_key = catalog:{ad_id}.
--
-- product_* is the URL mapping. manual_product_* is the override.
-- The cron refreshes the URL mapping and never writes manual_product_*.
-- When manual_product_key is set, that override is the product.
--
-- Apply this in the Supabase SQL editor. The app reads and writes through
-- service-role API routes; these policies cover direct browser access.
--
-- Admins can read and write every brand.
-- Founders and strategists can read their own brand.
-- Founders can write their own brand. Strategists cannot write.

CREATE TABLE IF NOT EXISTS public.live_creatives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  platform text NOT NULL DEFAULT 'meta',
  ad_id text NOT NULL,
  asset_key text NOT NULL,
  creative_id text,
  format text,
  landing_url text,
  landing_url_normalized text,
  product_key text,
  product_label text,
  product_kind text,
  ad_name text,
  asset_name text,
  thumbnail_url text,
  first_seen timestamptz,
  last_active timestamptz,
  product_source text,
  manual_product_key text,
  manual_product_label text,
  manual_product_kind text,
  card_products jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT live_creatives_identity UNIQUE (brand_id, platform, ad_id, asset_key),
  CONSTRAINT live_creatives_platform_check CHECK (platform = 'meta'),
  CONSTRAINT live_creatives_product_kind_check CHECK (
    product_kind IS NULL OR product_kind IN ('product', 'homepage', 'collection', 'shop_all', 'other', 'none')
  ),
  CONSTRAINT live_creatives_manual_kind_check CHECK (
    manual_product_kind IS NULL OR manual_product_kind IN ('product', 'homepage', 'collection', 'shop_all', 'other', 'none')
  ),
  CONSTRAINT live_creatives_product_source_check CHECK (
    product_source IS NULL OR product_source IN ('url', 'manual')
  )
);

CREATE INDEX IF NOT EXISTS live_creatives_brand_ad_idx
  ON public.live_creatives (brand_id, ad_id);

CREATE INDEX IF NOT EXISTS live_creatives_brand_last_active_idx
  ON public.live_creatives (brand_id, last_active DESC);

ALTER TABLE public.live_creatives ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.live_creatives FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.live_creatives TO authenticated;
GRANT ALL ON TABLE public.live_creatives TO service_role;

DROP POLICY IF EXISTS "admins read live creatives" ON public.live_creatives;
CREATE POLICY "admins read live creatives"
  ON public.live_creatives
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users_profile
      WHERE users_profile.id = auth.uid()
        AND users_profile.role = 'admin'
    )
  );

DROP POLICY IF EXISTS "brand readers read own live creatives" ON public.live_creatives;
CREATE POLICY "brand readers read own live creatives"
  ON public.live_creatives
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users_profile
      WHERE users_profile.id = auth.uid()
        AND users_profile.role IN ('founder', 'strategist')
        AND users_profile.brand_id = live_creatives.brand_id
    )
  );

DROP POLICY IF EXISTS "admins write live creatives" ON public.live_creatives;
CREATE POLICY "admins write live creatives"
  ON public.live_creatives
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users_profile
      WHERE users_profile.id = auth.uid()
        AND users_profile.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users_profile
      WHERE users_profile.id = auth.uid()
        AND users_profile.role = 'admin'
    )
  );

DROP POLICY IF EXISTS "founders write own live creatives" ON public.live_creatives;
CREATE POLICY "founders write own live creatives"
  ON public.live_creatives
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users_profile
      WHERE users_profile.id = auth.uid()
        AND users_profile.role = 'founder'
        AND users_profile.brand_id = live_creatives.brand_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users_profile
      WHERE users_profile.id = auth.uid()
        AND users_profile.role = 'founder'
        AND users_profile.brand_id = live_creatives.brand_id
    )
  );
