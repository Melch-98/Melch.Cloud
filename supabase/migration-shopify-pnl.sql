-- Migration: Shopify integration + Daily P&L raw data
-- Run this against your Supabase SQL editor

-- ============================================================================
-- 1. Add Shopify fields to brands table
-- ============================================================================

ALTER TABLE brands
  ADD COLUMN IF NOT EXISTS shopify_store_domain text,
  ADD COLUMN IF NOT EXISTS shopify_access_token text,
  ADD COLUMN IF NOT EXISTS shopify_gross_margin_pct numeric DEFAULT 62;

-- ============================================================================
-- 2. Daily P&L raw data table — one row per brand per day
--    Stores raw Shopify inputs; all derived metrics calculated at render time
-- ============================================================================

CREATE TABLE IF NOT EXISTS daily_pnl (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  date date NOT NULL,

  -- Shopify order data
  nc_orders integer DEFAULT 0,       -- New customer orders
  nc_revenue numeric DEFAULT 0,      -- NC gross revenue
  rc_orders integer DEFAULT 0,       -- Returning customer orders
  rc_revenue numeric DEFAULT 0,      -- RC gross revenue
  gross_sales numeric DEFAULT 0,     -- Total gross sales
  discounts numeric DEFAULT 0,       -- Stored negative (e.g. -1420)
  refunds numeric DEFAULT 0,         -- Stored negative (e.g. -218)
  taxes numeric DEFAULT 0,           -- Tax collected (positive)
  shipping numeric DEFAULT 0,        -- Shipping revenue (positive)

  -- Ad spend (synced separately or entered manually)
  meta_spend numeric DEFAULT 0,
  google_spend numeric DEFAULT 0,
  other_spend numeric DEFAULT 0,

  -- Sync metadata
  synced_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),

  -- One row per brand per day
  UNIQUE(brand_id, date)
);

-- Index for fast brand + date range queries
CREATE INDEX IF NOT EXISTS idx_daily_pnl_brand_date ON daily_pnl(brand_id, date DESC);

-- ============================================================================
-- 3. RLS policies — admin can read/write all, strategist reads own brand
-- ============================================================================

ALTER TABLE daily_pnl ENABLE ROW LEVEL SECURITY;

-- Admin full access
CREATE POLICY "Admin full access to daily_pnl"
ON daily_pnl FOR ALL
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

-- Strategists can read their brand's data
CREATE POLICY "Strategists can read own brand daily_pnl"
ON daily_pnl FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM users_profile
    WHERE id = auth.uid()
      AND role = 'strategist'
      AND brand_id = daily_pnl.brand_id
  )
);
