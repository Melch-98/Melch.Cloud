-- Archive FOND Regenerative / FOND Bone Broth (churned client)
-- Mark as archived so it no longer appears in brand selectors
-- and is excluded from active brand queries.

UPDATE brands
SET archived_at = NOW()
WHERE slug = 'fond-regenerative'
  AND archived_at IS NULL;
