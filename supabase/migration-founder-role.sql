-- Migration: Add 'founder' to user_role enum
-- Run in Supabase SQL editor

-- Add founder to the role enum
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'founder';

-- Example: Set a user as founder for a brand
-- UPDATE users_profile
-- SET role = 'founder', brand_id = (SELECT id FROM brands WHERE name ILIKE '%nimi%')
-- WHERE email = 'stern@nimiskincare.com';
