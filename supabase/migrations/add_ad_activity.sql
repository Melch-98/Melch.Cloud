-- Live ad-account activity (Meta /activities + Google Ads change_event).
-- Idempotent. Safe to run more than once.
--
-- Apply this in the Supabase SQL editor after the app code is deployed.
-- Do NOT drop ad_snapshots or ad_changelog here. The new feed does not read
-- them. They are safe to drop in a later migration once nothing else selects
-- them (src/app/api/ad-media/route.ts still queries ad_snapshots).
--
-- Service role writes these rows. Admins can read every brand. Founders can
-- read their own brand. The browser cannot insert.

CREATE TABLE IF NOT EXISTS public.ad_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('meta', 'google')),
  -- platform + ad account + native id, or a hash of the event when the
  -- platform has no stable id (Meta activities).
  event_key text NOT NULL,
  occurred_at timestamptz NOT NULL,
  actor text,
  tool text,
  object_type text,
  object_id text,
  object_name text,
  campaign_name text,
  change_type text NOT NULL CHECK (
    change_type IN (
      'budget',
      'bid_or_target',
      'status',
      'created',
      'removed',
      'creative',
      'targeting',
      'name',
      'other'
    )
  ),
  old_value text,
  new_value text,
  summary text,
  is_system boolean NOT NULL DEFAULT false,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ad_activity_event_key_key UNIQUE (event_key)
);

CREATE INDEX IF NOT EXISTS ad_activity_brand_occurred_idx
  ON public.ad_activity (brand_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS public.ad_activity_sync (
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('meta', 'google')),
  account_id text,
  last_success_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  last_manual_refresh_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (brand_id, platform)
);

ALTER TABLE public.ad_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_activity_sync ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.ad_activity FROM anon, authenticated;
REVOKE ALL ON TABLE public.ad_activity_sync FROM anon, authenticated;
GRANT SELECT ON TABLE public.ad_activity TO authenticated;
GRANT SELECT ON TABLE public.ad_activity_sync TO authenticated;

DROP POLICY IF EXISTS "admins read ad activity" ON public.ad_activity;
CREATE POLICY "admins read ad activity"
  ON public.ad_activity
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users_profile
      WHERE users_profile.id = auth.uid()
        AND users_profile.role = 'admin'
    )
  );

DROP POLICY IF EXISTS "founders read own brand ad activity" ON public.ad_activity;
CREATE POLICY "founders read own brand ad activity"
  ON public.ad_activity
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users_profile
      WHERE users_profile.id = auth.uid()
        AND users_profile.role = 'founder'
        AND users_profile.brand_id = ad_activity.brand_id
    )
  );

DROP POLICY IF EXISTS "admins read ad activity sync" ON public.ad_activity_sync;
CREATE POLICY "admins read ad activity sync"
  ON public.ad_activity_sync
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users_profile
      WHERE users_profile.id = auth.uid()
        AND users_profile.role = 'admin'
    )
  );

DROP POLICY IF EXISTS "founders read own brand ad activity sync" ON public.ad_activity_sync;
CREATE POLICY "founders read own brand ad activity sync"
  ON public.ad_activity_sync
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users_profile
      WHERE users_profile.id = auth.uid()
        AND users_profile.role = 'founder'
        AND users_profile.brand_id = ad_activity_sync.brand_id
    )
  );
