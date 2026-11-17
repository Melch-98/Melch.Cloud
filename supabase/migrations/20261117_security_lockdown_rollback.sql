-- Rollback for 20261117_security_lockdown.sql.
-- Do not apply this in the same pass as the forward file.
-- Restores the previous grants and policies. Does not remove tables, columns, or rows.

DROP POLICY IF EXISTS creatives_select ON storage.objects;
DROP POLICY IF EXISTS creatives_insert ON storage.objects;
DROP POLICY IF EXISTS creatives_update ON storage.objects;
DROP POLICY IF EXISTS creatives_delete ON storage.objects;

CREATE POLICY auth_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'creatives');

CREATE POLICY auth_upload ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'creatives');

CREATE POLICY auth_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'creatives')
  WITH CHECK (bucket_id = 'creatives');

CREATE POLICY auth_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'creatives');

DROP FUNCTION IF EXISTS public.can_access_creatives_object(text);

GRANT EXECUTE ON FUNCTION public.kick_pending_dropbox_syncs() TO PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public.file_tracker TO anon, authenticated;

ALTER VIEW public.file_tracker RESET (security_invoker);

GRANT SELECT ON TABLE public.brands TO anon, authenticated;

DROP POLICY IF EXISTS "Anon read brands" ON public.brands;
CREATE POLICY "Anon read brands" ON public.brands
  FOR SELECT TO anon
  USING (true);

GRANT INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public TO anon;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLES TO anon;

DO $default$
BEGIN
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLES TO anon';
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'could not restore supabase_admin default privileges';
END
$default$;
