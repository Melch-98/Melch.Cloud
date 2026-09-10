-- Tag daily_pnl rows with the reporting (Shopify settlement) currency
-- that revenue + converted ad spend amounts are denominated in.
-- Existing rows stay NULL until next sync; UI falls back to shop_info / orders.

ALTER TABLE daily_pnl
  ADD COLUMN IF NOT EXISTS currency text;

COMMENT ON COLUMN daily_pnl.currency IS
  'ISO-4217 reporting currency for this row (Shopify/store settlement). Spend fields are converted into this currency at sync time when native Meta/Google currency differs.';
