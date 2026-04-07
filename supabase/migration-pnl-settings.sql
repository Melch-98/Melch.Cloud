-- Migration: P&L monthly settings (other spend, off-shopify, gross margin)
-- Run this against your Supabase SQL editor

CREATE TABLE IF NOT EXISTS pnl_monthly_settings (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  month text NOT NULL,             -- e.g. '2026-04'

  -- Inputs
  other_spend numeric DEFAULT 0,
  other_spend_locked boolean DEFAULT false,
  off_shopify_revenue numeric DEFAULT 0,
  off_shopify_locked boolean DEFAULT false,
  gross_margin_pct numeric DEFAULT 62,

  -- Metadata
  updated_at timestamptz DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id),

  UNIQUE(brand_id, month)
);

CREATE INDEX IF NOT EXISTS idx_pnl_settings_brand_month
  ON pnl_monthly_settings(brand_id, month);

ALTER TABLE pnl_monthly_settings ENABLE ROW LEVEL SECURITY;

-- Admin full access
CREATE POLICY "Admin full access to pnl_monthly_settings"
ON pnl_monthly_settings FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM users_profile
    WHERE id = auth.uid() AND role = 'admin'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM users_profile
    WHERE id = auth.uid() AND role = 'admin'
  )
);

-- Founders can read/write their own brand
CREATE POLICY "Founders can manage own brand pnl_settings"
ON pnl_monthly_settings FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM users_profile
    WHERE id = auth.uid()
      AND role = 'founder'
      AND brand_id = pnl_monthly_settings.brand_id
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM users_profile
    WHERE id = auth.uid()
      AND role = 'founder'
      AND brand_id = pnl_monthly_settings.brand_id
  )
);

-- Strategists can read their brand
CREATE POLICY "Strategists can read own brand pnl_settings"
ON pnl_monthly_settings FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM users_profile
    WHERE id = auth.uid()
      AND role = 'strategist'
      AND brand_id = pnl_monthly_settings.brand_id
  )
);
