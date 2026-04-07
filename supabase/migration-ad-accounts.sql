-- Migration: Add ad account IDs to brands table
-- Run in Supabase SQL editor

ALTER TABLE brands
  ADD COLUMN IF NOT EXISTS meta_ad_account_id text,
  ADD COLUMN IF NOT EXISTS google_ads_customer_id text;

-- Set Tallow Twins ad accounts
UPDATE brands
SET meta_ad_account_id = 'act_736883766717486',
    google_ads_customer_id = '6996956911'
WHERE name ILIKE '%tallow%';
