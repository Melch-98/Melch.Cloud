-- Migration: Switch from shopify_access_token to client_id + client_secret
-- Run this in Supabase SQL Editor

-- Drop the old column if it exists (from previous migration)
ALTER TABLE brands DROP COLUMN IF EXISTS shopify_access_token;

-- Add new client credential columns
ALTER TABLE brands
  ADD COLUMN IF NOT EXISTS shopify_client_id text,
  ADD COLUMN IF NOT EXISTS shopify_client_secret text;
