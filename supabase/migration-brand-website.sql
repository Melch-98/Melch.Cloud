-- Add website_url to brands so we can pull client favicons
ALTER TABLE brands ADD COLUMN IF NOT EXISTS website_url text;

-- Backfill example (adjust per your actual brands):
-- UPDATE brands SET website_url = 'https://jonesroadbeauty.com' WHERE slug = 'jones-road';
