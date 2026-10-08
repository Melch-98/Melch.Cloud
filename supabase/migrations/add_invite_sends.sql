-- Invite delivery log.
-- One row per welcome/invite send attempt: Resend message id, or the error.
-- Idempotent. Safe to run more than once.
-- Service role writes the rows. Admins can read them. The browser cannot insert.

CREATE TABLE IF NOT EXISTS public.invite_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  email text NOT NULL,
  brand_id uuid REFERENCES public.brands(id) ON DELETE SET NULL,
  invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  link_type text,
  resend_message_id text,
  error text,
  source text NOT NULL
);

CREATE INDEX IF NOT EXISTS invite_sends_email_created_idx
  ON public.invite_sends (email, created_at DESC);

ALTER TABLE public.invite_sends ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins read invite sends" ON public.invite_sends;
CREATE POLICY "admins read invite sends"
  ON public.invite_sends
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users_profile
      WHERE users_profile.id = auth.uid()
        AND users_profile.role = 'admin'
    )
  );
