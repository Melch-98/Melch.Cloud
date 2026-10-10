-- Shared BFCM goals. One row per brand per calendar day.
-- Idempotent. Safe to run more than once.
--
-- Apply this in the Supabase SQL editor. The app reads and writes through
-- service-role API routes; these policies cover direct browser access.
--
-- Admins can read and write every brand.
-- Founders and strategists can read their own brand.
-- Founders can write their own brand. Strategists cannot write.

CREATE TABLE IF NOT EXISTS public.bfcm_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  date date NOT NULL,
  revenue_goal numeric,
  spend_budget numeric,
  amer_target numeric,
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bfcm_goals_brand_date_key UNIQUE (brand_id, date)
);

CREATE INDEX IF NOT EXISTS bfcm_goals_brand_date_idx
  ON public.bfcm_goals (brand_id, date);

ALTER TABLE public.bfcm_goals ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.bfcm_goals FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.bfcm_goals TO authenticated;
GRANT ALL ON TABLE public.bfcm_goals TO service_role;

DROP POLICY IF EXISTS "admins read bfcm goals" ON public.bfcm_goals;
CREATE POLICY "admins read bfcm goals"
  ON public.bfcm_goals
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users_profile
      WHERE users_profile.id = auth.uid()
        AND users_profile.role = 'admin'
    )
  );

DROP POLICY IF EXISTS "brand readers read own bfcm goals" ON public.bfcm_goals;
CREATE POLICY "brand readers read own bfcm goals"
  ON public.bfcm_goals
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users_profile
      WHERE users_profile.id = auth.uid()
        AND users_profile.role IN ('founder', 'strategist')
        AND users_profile.brand_id = bfcm_goals.brand_id
    )
  );

DROP POLICY IF EXISTS "admins write bfcm goals" ON public.bfcm_goals;
CREATE POLICY "admins write bfcm goals"
  ON public.bfcm_goals
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

DROP POLICY IF EXISTS "founders write own bfcm goals" ON public.bfcm_goals;
CREATE POLICY "founders write own bfcm goals"
  ON public.bfcm_goals
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users_profile
      WHERE users_profile.id = auth.uid()
        AND users_profile.role = 'founder'
        AND users_profile.brand_id = bfcm_goals.brand_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users_profile
      WHERE users_profile.id = auth.uid()
        AND users_profile.role = 'founder'
        AND users_profile.brand_id = bfcm_goals.brand_id
    )
  );
