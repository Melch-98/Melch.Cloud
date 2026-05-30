# Claude Code Prompt: Fix shopify_product_id BIGINT Bug in Sync Routes

## Context

The `shopify_products` table has a `shopify_product_id` column of type **BIGINT** (not TEXT). Two API routes currently insert the value with a `gid://shopify/Product/` prefix, which causes `invalid input syntax for type bigint` errors and silently fails every sync. This is a live bug — the sync button in the upload form and the scheduled shopify-sync both fail because of it.

## What to fix

### 1. `src/app/api/sync-products/route.ts` — Line 112

**Current (broken):**
```typescript
shopify_product_id: `gid://shopify/Product/${product.id}`,
```

**Fix:**
```typescript
shopify_product_id: product.id,
```

That's it — `product.id` from Shopify's REST API is already a plain numeric ID (e.g. `9302960865580`). Just pass it through directly.

### 2. `src/app/api/shopify-sync/route.ts` — Line 621

**Current (broken):**
```typescript
shopify_product_id: `gid://shopify/Product/${p.id}`,
```

**Fix:**
```typescript
shopify_product_id: p.id,
```

Same fix — remove the `gid://shopify/Product/` prefix.

## What NOT to change

- Don't change the `shopify_products` table schema — the BIGINT column is correct
- Don't change the `brand-products` API route — it already returns `shopify_product_id` correctly
- Don't change the SubmissionForm component — it already handles the product ID values correctly
- Don't change any other fields in the upsert objects — only `shopify_product_id` is affected
- Don't touch the `tags` field handling — the `split(', ')` approach works with the text[] column

## Verification

After making the change, you can verify by checking that the Shopify product ID values being upserted are plain numbers, not strings starting with `gid://`. For example, a valid value is `9302960865580`, not `gid://shopify/Product/9302960865580`.

## Files to modify

1. `src/app/api/sync-products/route.ts` — change line 112
2. `src/app/api/shopify-sync/route.ts` — change line 621
