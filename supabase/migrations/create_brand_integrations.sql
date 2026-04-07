-- ─── Brand Integrations Table ───────────────────────────────────
-- Stores API keys / tokens for third-party integrations per brand.
-- Run this in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS brand_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,            -- 'klaviyo', 'mailchimp', etc.
  api_key TEXT NOT NULL,             -- encrypted at rest by Supabase
  label TEXT,                        -- optional friendly label
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(brand_id, provider)         -- one key per provider per brand
);

-- RLS
ALTER TABLE brand_integrations ENABLE ROW LEVEL SECURITY;

-- Only service-role (admin backend) can read/write integrations
CREATE POLICY "Service role full access" ON brand_integrations
  FOR ALL USING (auth.role() = 'service_role');

-- Admin users can read integrations for UI display (not the raw key)
CREATE POLICY "Admin read access" ON brand_integrations
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM users_profile
      WHERE users_profile.id = auth.uid()
        AND users_profile.role = 'admin'
    )
  );

-- Index
CREATE INDEX idx_brand_integrations_brand ON brand_integrations(brand_id);
CREATE INDEX idx_brand_integrations_provider ON brand_integrations(provider);
