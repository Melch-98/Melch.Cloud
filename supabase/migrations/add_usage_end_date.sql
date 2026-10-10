-- Usage-rights expiry on a creative batch, plus the Agency Tasks page
-- created for that date. Additive only. Existing rows stay null.

ALTER TABLE submissions
  ADD COLUMN IF NOT EXISTS usage_end_date date,
  ADD COLUMN IF NOT EXISTS notion_page_id text,
  ADD COLUMN IF NOT EXISTS notion_page_url text;

-- Export reads file_tracker. Append the date; do not reorder existing columns.
CREATE OR REPLACE VIEW public.file_tracker AS
 SELECT sf.id,
    sf.file_name,
    sf.file_type,
    sf.file_size,
    sf.file_url,
    s.batch_name,
    b.name AS brand_name,
    b.id AS brand_id,
    s.creator_name,
    s.creative_type,
    COALESCE(sf.landing_page_url, s.landing_page_url) AS landing_page_url,
    COALESCE(sf.copy_headline, s.copy_headline) AS copy_headline,
    COALESCE(sf.copy_body, s.copy_body) AS copy_body,
    COALESCE(sf.copy_cta, s.copy_cta) AS copy_cta,
    COALESCE(sf.copy_title, s.copy_title) AS copy_title,
    sf.status,
    sf.media_format,
    sf.aspect_ratio,
    sf.width,
    sf.height,
    s.is_carousel,
    s.is_flexible,
    s.is_whitelist,
    s.creator_social_handle,
    sf.launch_date,
    sf.launch_time,
    sf.ad_name,
    sf.notes,
    sf.created_at AS submitted_at,
    s.id AS submission_id,
    s.usage_end_date
   FROM submission_files sf
     JOIN submissions s ON sf.submission_id = s.id
     JOIN brands b ON s.brand_id = b.id;
