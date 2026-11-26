-- Day plan columns for the BFCM Surf tracker, plus one note per shop hour.
-- Idempotent. Safe to run more than once.
--
-- The app writes through service-role routes. These policies cover a
-- signed-in browser that talks to the tables directly.
-- Channel plan columns stay nullable. A missing plan is not zero.
--
-- Admins read and write every brand.
-- Founders and strategists read their own brand.
-- Founders write their own hour notes. Strategists do not write.
-- Channel plan columns are enforced as admin-only in the API. The table
-- policies match the existing bfcm_goals write rules so a founder can still
-- save the original revenue, spend, and aMER fields.

ALTER TABLE public.bfcm_goals
  ADD COLUMN IF NOT EXISTS meta_spend_budget numeric,
  ADD COLUMN IF NOT EXISTS google_spend_budget numeric,
  ADD COLUMN IF NOT EXISTS blended_roas_target numeric,
  ADD COLUMN IF NOT EXISTS meta_roas_target numeric,
  ADD COLUMN IF NOT EXISTS google_roas_target numeric;

ALTER TABLE public.bfcm_goals
  DROP CONSTRAINT IF EXISTS bfcm_goals_plan_nonnegative;

ALTER TABLE public.bfcm_goals
  ADD CONSTRAINT bfcm_goals_plan_nonnegative CHECK (
    (meta_spend_budget IS NULL OR meta_spend_budget >= 0)
    AND (google_spend_budget IS NULL OR google_spend_budget >= 0)
    AND (blended_roas_target IS NULL OR blended_roas_target >= 0)
    AND (meta_roas_target IS NULL OR meta_roas_target >= 0)
    AND (google_roas_target IS NULL OR google_roas_target >= 0)
  );

CREATE TABLE IF NOT EXISTS public.bfcm_hour_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  date date NOT NULL,
  hour smallint NOT NULL,
  note text NOT NULL,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bfcm_hour_notes_hour_check CHECK (hour >= 0 AND hour <= 23),
  CONSTRAINT bfcm_hour_notes_brand_date_hour_key UNIQUE (brand_id, date, hour)
);

CREATE INDEX IF NOT EXISTS bfcm_hour_notes_brand_date_idx
  ON public.bfcm_hour_notes (brand_id, date);

ALTER TABLE public.bfcm_hour_notes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.bfcm_hour_notes FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.bfcm_hour_notes TO authenticated;
GRANT ALL ON TABLE public.bfcm_hour_notes TO service_role;

DROP POLICY IF EXISTS "admins read bfcm hour notes" ON public.bfcm_hour_notes;
CREATE POLICY "admins read bfcm hour notes"
  ON public.bfcm_hour_notes
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users_profile
      WHERE users_profile.id = (SELECT auth.uid())
        AND users_profile.role = 'admin'
    )
  );

DROP POLICY IF EXISTS "brand readers read own bfcm hour notes" ON public.bfcm_hour_notes;
CREATE POLICY "brand readers read own bfcm hour notes"
  ON public.bfcm_hour_notes
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users_profile
      WHERE users_profile.id = (SELECT auth.uid())
        AND users_profile.role IN ('founder', 'strategist')
        AND users_profile.brand_id = bfcm_hour_notes.brand_id
    )
  );

DROP POLICY IF EXISTS "admins write bfcm hour notes" ON public.bfcm_hour_notes;
CREATE POLICY "admins write bfcm hour notes"
  ON public.bfcm_hour_notes
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users_profile
      WHERE users_profile.id = (SELECT auth.uid())
        AND users_profile.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users_profile
      WHERE users_profile.id = (SELECT auth.uid())
        AND users_profile.role = 'admin'
    )
  );

DROP POLICY IF EXISTS "founders write own bfcm hour notes" ON public.bfcm_hour_notes;
CREATE POLICY "founders write own bfcm hour notes"
  ON public.bfcm_hour_notes
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users_profile
      WHERE users_profile.id = (SELECT auth.uid())
        AND users_profile.role = 'founder'
        AND users_profile.brand_id = bfcm_hour_notes.brand_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users_profile
      WHERE users_profile.id = (SELECT auth.uid())
        AND users_profile.role = 'founder'
        AND users_profile.brand_id = bfcm_hour_notes.brand_id
    )
  );
