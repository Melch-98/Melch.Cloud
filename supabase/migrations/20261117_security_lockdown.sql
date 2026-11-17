ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLES FROM anon;

DO $default$
BEGIN
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLES FROM anon';
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'could not change supabase_admin default privileges';
END
$default$;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM anon;

DROP POLICY IF EXISTS "Anon read brands" ON public.brands;

REVOKE SELECT ON TABLE public.brands FROM PUBLIC, anon, authenticated;

GRANT SELECT (
  id,
  name,
  slug,
  created_at,
  website_url,
  meta_ad_account_id,
  shopify_store_domain,
  gross_margin_pct,
  google_ads_customer_id,
  drive_folder_id,
  dropbox_folder_path,
  archived_at,
  target_roas,
  roas_floor,
  nc_share_pct,
  ltv_3m_mult,
  ltv_6m_mult,
  ltv_12m_mult,
  payment_processing_pct,
  returns_rate_pct,
  shipping_cost_per_order,
  creative_cost_static,
  creative_cost_video,
  file_naming_pattern
) ON TABLE public.brands TO authenticated;

ALTER VIEW public.file_tracker SET (security_invoker = true);

REVOKE ALL ON TABLE public.file_tracker FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.file_tracker TO authenticated;

REVOKE ALL ON FUNCTION public.kick_pending_dropbox_syncs() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kick_pending_dropbox_syncs() TO postgres;

CREATE OR REPLACE FUNCTION public.can_access_creatives_object(object_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT public.current_user_is_admin()), false)
    OR (
      (SELECT public.current_user_brand_id()) IS NOT NULL
      AND split_part(object_name, '/', 1) = (SELECT public.current_user_brand_id())::text
    );
$$;

REVOKE ALL ON FUNCTION public.can_access_creatives_object(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_creatives_object(text) TO authenticated;

DROP POLICY IF EXISTS auth_select ON storage.objects;
DROP POLICY IF EXISTS auth_upload ON storage.objects;
DROP POLICY IF EXISTS auth_update ON storage.objects;
DROP POLICY IF EXISTS auth_delete ON storage.objects;

CREATE POLICY creatives_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'creatives'
    AND public.can_access_creatives_object(name)
  );

CREATE POLICY creatives_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'creatives'
    AND public.can_access_creatives_object(name)
  );

CREATE POLICY creatives_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'creatives'
    AND public.can_access_creatives_object(name)
  )
  WITH CHECK (
    bucket_id = 'creatives'
    AND public.can_access_creatives_object(name)
  );

CREATE POLICY creatives_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'creatives'
    AND COALESCE((SELECT public.current_user_is_admin()), false)
  );
