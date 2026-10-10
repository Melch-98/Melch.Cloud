-- Destination kinds for live_creatives. Additive.
-- Apply add_live_creatives.sql first. Existing rows stay as stored.
-- 'none' remains only when Meta has no destination at all.

ALTER TABLE public.live_creatives DROP CONSTRAINT IF EXISTS live_creatives_product_kind_check;
ALTER TABLE public.live_creatives ADD CONSTRAINT live_creatives_product_kind_check CHECK (
  product_kind IS NULL OR product_kind IN (
    'product', 'homepage', 'collection', 'shop_all', 'other',
    'lead_form', 'messages', 'call', 'ig_profile', 'meta_shop', 'app', 'catalog',
    'none'
  )
);

ALTER TABLE public.live_creatives DROP CONSTRAINT IF EXISTS live_creatives_manual_kind_check;
ALTER TABLE public.live_creatives ADD CONSTRAINT live_creatives_manual_kind_check CHECK (
  manual_product_kind IS NULL OR manual_product_kind IN (
    'product', 'homepage', 'collection', 'shop_all', 'other',
    'lead_form', 'messages', 'call', 'ig_profile', 'meta_shop', 'app', 'catalog',
    'none'
  )
);
