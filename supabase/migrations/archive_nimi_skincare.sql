-- Archive Nimi Skincare (churned client)
-- Mark as archived so it no longer appears in brand selectors
-- and is excluded from active brand queries.

UPDATE brands
SET archived_at = NOW()
WHERE slug = 'nimi-skincare'
  AND archived_at IS NULL;
