-- Fix infinite recursion in RLS policies
-- The issue: policies on users_profile query users_profile to check admin role = infinite loop

-- Step 1: Create a security definer function that bypasses RLS to check admin role
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM users_profile
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

-- Step 2: Fix users_profile policies
DROP POLICY IF EXISTS "Users can read own profile" ON users_profile;
DROP POLICY IF EXISTS "Admins can read all profiles" ON users_profile;

CREATE POLICY "Users can read own profile"
ON users_profile FOR SELECT
TO authenticated
USING (auth.uid() = id);

CREATE POLICY "Admins can read all profiles"
ON users_profile FOR SELECT
TO authenticated
USING (public.is_admin());

-- Step 3: Fix submissions policies
DROP POLICY IF EXISTS "Users can insert submissions for their brand" ON submissions;
DROP POLICY IF EXISTS "Users can read submissions from their brand" ON submissions;
DROP POLICY IF EXISTS "Admins can read all submissions" ON submissions;
DROP POLICY IF EXISTS "Admins can update all submissions" ON submissions;

CREATE POLICY "Users can insert submissions for their brand"
ON submissions FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid() AND
  brand_id IN (SELECT brand_id FROM users_profile WHERE id = auth.uid())
);

CREATE POLICY "Users can read submissions from their brand"
ON submissions FOR SELECT
TO authenticated
USING (
  brand_id IN (SELECT brand_id FROM users_profile WHERE id = auth.uid())
);

CREATE POLICY "Admins can read all submissions"
ON submissions FOR SELECT
TO authenticated
USING (public.is_admin());

CREATE POLICY "Admins can update all submissions"
ON submissions FOR UPDATE
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- Step 4: Fix submission_files policies
DROP POLICY IF EXISTS "Users can insert files for their brand's submissions" ON submission_files;
DROP POLICY IF EXISTS "Users can read files from their brand's submissions" ON submission_files;
DROP POLICY IF EXISTS "Admins can read all submission files" ON submission_files;
DROP POLICY IF EXISTS "Admins can update all submission files" ON submission_files;

CREATE POLICY "Users can insert files for their submissions"
ON submission_files FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM submissions s
    WHERE s.id = submission_id AND s.user_id = auth.uid()
  )
);

CREATE POLICY "Users can read files from their brand"
ON submission_files FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM submissions s
    JOIN users_profile up ON s.brand_id = up.brand_id
    WHERE s.id = submission_id AND up.id = auth.uid()
  )
);

CREATE POLICY "Admins can read all submission files"
ON submission_files FOR SELECT
TO authenticated
USING (public.is_admin());

CREATE POLICY "Admins can update all submission files"
ON submission_files FOR UPDATE
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- Step 5: Fix status_log policies
DROP POLICY IF EXISTS "Admins can read all status logs" ON status_log;
DROP POLICY IF EXISTS "Users can read status logs for their brand" ON status_log;

CREATE POLICY "Admins can read all status logs"
ON status_log FOR SELECT
TO authenticated
USING (public.is_admin());

CREATE POLICY "Users can read status logs for their brand"
ON status_log FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM submission_files sf
    JOIN submissions s ON sf.submission_id = s.id
    JOIN users_profile up ON s.brand_id = up.brand_id
    WHERE sf.id = status_log.file_id AND up.id = auth.uid()
  )
);
