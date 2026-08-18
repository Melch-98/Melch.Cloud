-- Fix: founders could not see the Efficiency Curve page (empty state).
-- daily_pnl RLS only granted admin + strategist; the founder role was missing,
-- so founder users saw "No spend data available" despite having data.
-- Run against the Supabase SQL editor (or via supabase db push).

CREATE POLICY "Founders can read own brand daily_pnl"
ON daily_pnl FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM users_profile
    WHERE id = auth.uid()
      AND role = 'founder'
      AND brand_id = daily_pnl.brand_id
  )
);
