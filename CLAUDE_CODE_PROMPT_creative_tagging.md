# Claude Code Prompt: Creative Tagging System (Phase 1 — Schema + Upload Form)

## Context

Melch.Cloud is a multi-brand DTC marketing platform built with Next.js + Supabase (project: `txetdixzcftzetqiuzan`). Brands include Tallow Twins, FOND, Organic Jaguar, Nimi Skincare, etc. The creative queue system lets users upload ad creatives (images/videos) organized into batches.

**Problem:** Creatives are uploaded with almost no metadata — just a file name, MIME type, dimensions, and aspect ratio. There's no way to tag which product a creative is for, what type of creative it is (UGC, product shot, before & after, etc.), or its production quality level. This makes it impossible to do gap analysis, search, or organize creatives strategically.

**Goal:** Add a per-file creative tagging system that works across all brands. Products come from each brand's Shopify store (already synced to the `shopify_products` table). Creative types are universal DTC categories defined in code. The tagging happens during the upload flow in `SubmissionForm.tsx`.

---

## Part 1: Database Schema Changes

### 1A. Product source — use existing `shopify_products` table

**DO NOT create a new `brand_products` table.** The `shopify_products` table already exists with the right schema:

```
shopify_products:
  shop_domain, brand_id, shopify_product_id, title, handle, status,
  product_type, vendor, tags, variants, images, ...
```

The product dropdown in the upload form will query this table:

```sql
SELECT shopify_product_id, title, product_type
FROM shopify_products
WHERE brand_id = $1 AND status = 'active'
ORDER BY product_type, title
```

**Important:** Currently only demo data exists in this table. Part 2 (below) adds a product sync to populate it for real brands.

### 1B. Add tagging columns to `submission_files`

Add these nullable columns to the existing `submission_files` table:

```sql
ALTER TABLE submission_files
  ADD COLUMN IF NOT EXISTS product_id TEXT,        -- shopify_product_id from shopify_products
  ADD COLUMN IF NOT EXISTS product_name TEXT,       -- denormalized product title for display
  ADD COLUMN IF NOT EXISTS creative_type TEXT,      -- value from creative type taxonomy
  ADD COLUMN IF NOT EXISTS fidelity TEXT CHECK (fidelity IS NULL OR fidelity IN ('high_def', 'lofi', 'other')),
  ADD COLUMN IF NOT EXISTS hook_angle TEXT,         -- the headline/hook concept (free text)
  ADD COLUMN IF NOT EXISTS creative_concept TEXT,   -- groups variants of the same creative idea
  ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_submission_files_product ON submission_files(product_id);
CREATE INDEX IF NOT EXISTS idx_submission_files_creative_type ON submission_files(creative_type);
CREATE INDEX IF NOT EXISTS idx_submission_files_tags ON submission_files USING gin(tags);
```

Notes:
- `product_id` stores the Shopify product ID (string like "gid://shopify/Product/123"), NOT a UUID reference. This avoids FK dependency on the sync table.
- `product_name` is denormalized so we can display it without joining. Set it when the user selects a product.
- All columns nullable — existing data continues to work.

---

## Part 2: Sync Shopify Products for Real Brands

### 2A. Add product fetch to `src/app/api/shopify-sync/route.ts`

The existing POST handler in this file already fetches Shopify orders for each brand. Add a product sync step that runs alongside the order sync.

Each brand row in the `brands` table has `shopify_store_domain`, `shopify_client_id`, and `shopify_client_secret`. Use these to fetch products from the Shopify REST API:

```
GET https://{shopify_store_domain}/admin/api/2024-01/products.json?limit=250&status=active
```

Auth: Use the same credential pattern as the existing `shopifyFetch()` helper in this file (Basic auth with client_id:client_secret, or the access_token from `shopify_stores` if available).

For each product in the response, upsert into `shopify_products`:

```sql
INSERT INTO shopify_products (
  shop_domain, brand_id, shopify_product_id, title, handle, status,
  product_type, vendor, tags, variants, images,
  shopify_created_at, shopify_updated_at, raw, updated_at
) VALUES ($1, $2, $3, ...)
ON CONFLICT (shop_domain, shopify_product_id)
DO UPDATE SET
  title = EXCLUDED.title,
  handle = EXCLUDED.handle,
  status = EXCLUDED.status,
  product_type = EXCLUDED.product_type,
  vendor = EXCLUDED.vendor,
  tags = EXCLUDED.tags,
  variants = EXCLUDED.variants,
  images = EXCLUDED.images,
  shopify_updated_at = EXCLUDED.shopify_updated_at,
  raw = EXCLUDED.raw,
  updated_at = now();
```

Handle pagination (Shopify returns max 250 products per page with Link header pagination).

### 2B. Create API endpoint for product list

Create `src/app/api/brand-products/route.ts`:

**GET** `?brand_id=<uuid>` — returns active products from `shopify_products`, grouped by `product_type`. Always includes a synthetic "Brand / General" option at the top for creatives that aren't product-specific.

```typescript
// GET handler
export async function GET(request: NextRequest) {
  const brandId = request.nextUrl.searchParams.get('brand_id');
  if (!brandId) return NextResponse.json({ error: 'brand_id required' }, { status: 400 });

  const { data: products } = await supabase
    .from('shopify_products')
    .select('shopify_product_id, title, product_type, handle')
    .eq('brand_id', brandId)
    .eq('status', 'active')
    .order('product_type')
    .order('title');

  // Prepend the "Brand / General" option
  const result = [
    { shopify_product_id: '__brand_general__', title: 'Brand / General', product_type: '', handle: '' },
    ...(products || []),
  ];

  return NextResponse.json({ products: result });
}
```

---

## Part 3: Creative Type Taxonomy

Create `src/lib/creative-types.ts` — universal DTC creative categories. These are the same for every brand. Organized by fidelity + format for grouped dropdown rendering.

```typescript
// src/lib/creative-types.ts

export interface CreativeTypeOption {
  value: string;
  label: string;
  fidelity: 'high_def' | 'lofi' | 'other';
  format: 'static' | 'video';
}

export interface CreativeTypeGroup {
  label: string;
  fidelity: 'high_def' | 'lofi' | 'other';
  format: 'static' | 'video';
  types: CreativeTypeOption[];
}

export const CREATIVE_TYPE_GROUPS: CreativeTypeGroup[] = [
  {
    label: 'High Def — Static',
    fidelity: 'high_def',
    format: 'static',
    types: [
      { value: 'ecom_product_shots', label: 'ECom Product Shots', fidelity: 'high_def', format: 'static' },
      { value: 'campaign_product_shots', label: 'Campaign Product Shots', fidelity: 'high_def', format: 'static' },
      { value: 'campaign_model_shots', label: 'Campaign Model Shots', fidelity: 'high_def', format: 'static' },
      { value: 'before_afters_hd', label: 'Before & Afters', fidelity: 'high_def', format: 'static' },
      { value: 'skin_tone_shots', label: 'Skin Tone Shots', fidelity: 'high_def', format: 'static' },
      { value: 'swatches_textures', label: 'Swatches / Textures', fidelity: 'high_def', format: 'static' },
      { value: 'ingredient_callouts', label: 'Ingredient Callouts', fidelity: 'high_def', format: 'static' },
      { value: 'lifestyle_flat_lay', label: 'Lifestyle Flat Lay', fidelity: 'high_def', format: 'static' },
    ],
  },
  {
    label: 'High Def — Video',
    fidelity: 'high_def',
    format: 'video',
    types: [
      { value: 'beauty_hero_shots', label: 'Beauty / Hero Shots', fidelity: 'high_def', format: 'video' },
      { value: 'application_demo', label: 'Application Demo', fidelity: 'high_def', format: 'video' },
      { value: 'model_interactions', label: 'Model Interactions', fidelity: 'high_def', format: 'video' },
      { value: 'ai_graphic_content', label: 'AI Graphic Content', fidelity: 'high_def', format: 'video' },
      { value: 'product_reveal', label: 'Product Reveal', fidelity: 'high_def', format: 'video' },
    ],
  },
  {
    label: 'Lofi — Static',
    fidelity: 'lofi',
    format: 'static',
    types: [
      { value: 'irl_lifestyle', label: 'IRL (Lifestyle Setting)', fidelity: 'lofi', format: 'static' },
      { value: 'creator_imagery', label: 'Creator Imagery', fidelity: 'lofi', format: 'static' },
      { value: 'lofi_swatches', label: 'Swatches', fidelity: 'lofi', format: 'static' },
      { value: 'before_afters_lofi', label: 'Before & Afters', fidelity: 'lofi', format: 'static' },
      { value: 'review_screenshot', label: 'Review Screenshot', fidelity: 'lofi', format: 'static' },
    ],
  },
  {
    label: 'Lofi — Video',
    fidelity: 'lofi',
    format: 'video',
    types: [
      { value: 'product_love_testimonial', label: 'Product Love Testimonials', fidelity: 'lofi', format: 'video' },
      { value: 'product_try_on', label: 'Product Try Ons', fidelity: 'lofi', format: 'video' },
      { value: 'full_routine_makeover', label: 'Full Routine / Makeover', fidelity: 'lofi', format: 'video' },
      { value: 'humor', label: 'Humor', fidelity: 'lofi', format: 'video' },
      { value: 'founder_story', label: 'Founder Story', fidelity: 'lofi', format: 'video' },
      { value: 'behind_the_scenes', label: 'Behind the Scenes', fidelity: 'lofi', format: 'video' },
      { value: 'grwm', label: 'GRWM (Get Ready With Me)', fidelity: 'lofi', format: 'video' },
      { value: 'problem_solution', label: 'Problem → Solution', fidelity: 'lofi', format: 'video' },
      { value: 'myth_busting', label: 'Myth Busting', fidelity: 'lofi', format: 'video' },
    ],
  },
  {
    label: 'Other Formats — Static',
    fidelity: 'other',
    format: 'static',
    types: [
      { value: 'alarm_app_mockup', label: 'Alarm App Mockup', fidelity: 'other', format: 'static' },
      { value: 'app_mockup', label: 'App Mockup', fidelity: 'other', format: 'static' },
      { value: 'billboard_mockup', label: 'Billboard Mockup', fidelity: 'other', format: 'static' },
      { value: 'branded_asset', label: 'Branded Asset', fidelity: 'other', format: 'static' },
      { value: 'calendar_app_mockup', label: 'Calendar App Mockup', fidelity: 'other', format: 'static' },
      { value: 'comparison_chart', label: 'Comparison Chart', fidelity: 'other', format: 'static' },
      { value: 'cartoon_illustration', label: 'Cartoon / Illustration', fidelity: 'other', format: 'static' },
      { value: 'meme', label: 'Meme', fidelity: 'other', format: 'static' },
      { value: 'text_overlay_quote', label: 'Text Overlay / Quote', fidelity: 'other', format: 'static' },
    ],
  },
  {
    label: 'Other Formats — Video',
    fidelity: 'other',
    format: 'video',
    types: [
      { value: 'animation', label: 'Animation', fidelity: 'other', format: 'video' },
      { value: 'asmr', label: 'ASMR', fidelity: 'other', format: 'video' },
      { value: 'case_study', label: 'Case Study', fidelity: 'other', format: 'video' },
      { value: 'celebrity_influencer', label: 'Celebrity / Influencer', fidelity: 'other', format: 'video' },
      { value: 'educational_howto', label: 'Educational / How-To', fidelity: 'other', format: 'video' },
      { value: 'slideshow', label: 'Slideshow', fidelity: 'other', format: 'video' },
      { value: 'unboxing', label: 'Unboxing', fidelity: 'other', format: 'video' },
      { value: 'voiceover_story', label: 'Voiceover Story', fidelity: 'other', format: 'video' },
    ],
  },
];

// Flat lookup helper
export const CREATIVE_TYPES_MAP = new Map<string, CreativeTypeOption>(
  CREATIVE_TYPE_GROUPS.flatMap(g => g.types.map(t => [t.value, t]))
);

export function getCreativeTypeLabel(value: string): string {
  return CREATIVE_TYPES_MAP.get(value)?.label ?? value;
}
```

---

## Part 4: Upload Form — Add Per-File Tagging

### 4A. Overview of changes to `src/components/SubmissionForm.tsx`

The current form has:
- Batch card (collapsible) with batch-level fields (creative_type as UGC/Static/Video/Other, creator name, landing page URL, copy template)
- FileUploader for drag-and-drop
- Per-file details only visible in carousel mode

**What to add:**

1. After files are uploaded into a batch, show a **per-file tag row** for EVERY file (not just carousel). Each file gets:
   - Thumbnail (already exists)
   - File name (already exists)
   - **Product** dropdown — populated from `/api/brand-products?brand_id=X`. Shows "Brand / General" first, then products grouped by `product_type`.
   - **Creative type** dropdown — grouped `<optgroup>` from `CREATIVE_TYPE_GROUPS`
   - **Hook / angle** — short text input for the headline concept

2. Add a **"batch defaults" bar** above the file list. Two dropdowns (Product, Creative Type) + an "Apply to all" button. This sets the values on all files in the batch that don't already have values. Avoids repetitive clicking when a whole batch is the same product/type.

3. **Fidelity is auto-set** from the creative type selection — no separate dropdown needed. When a creative type is selected, look up its fidelity from `CREATIVE_TYPES_MAP`.

### 4B. State changes

Update the `fileContexts` state to include new fields per file:

```typescript
interface FileContext {
  // existing...
  copyHeadline: string;
  copyBody: string;
  // NEW:
  productId: string;       // shopify_product_id or '__brand_general__'
  productName: string;      // denormalized title for display + DB storage
  creativeType: string;     // value from CREATIVE_TYPE_GROUPS
  hookAngle: string;        // free text
}
```

Add batch defaults:

```typescript
const [batchDefaults, setBatchDefaults] = useState<{
  productId: string;
  productName: string;
  creativeType: string;
}>({ productId: '', productName: '', creativeType: '' });
```

### 4C. Fetch products on brand selection

```typescript
const [brandProducts, setBrandProducts] = useState<any[]>([]);

useEffect(() => {
  if (selectedBrandId) {
    fetch(`/api/brand-products?brand_id=${selectedBrandId}`)
      .then(r => r.json())
      .then(data => setBrandProducts(data.products || []));
  }
}, [selectedBrandId]);
```

### 4D. Per-file tag row layout

Below each file thumbnail, render a compact row. On mobile it can stack, on desktop it's inline:

```
[Thumbnail] filename.mp4
Product: [select ▼]  |  Type: [select ▼]  |  Hook: [text input]
```

Product `<select>` grouped by `product_type`:
```html
<option value="">— Select product —</option>
<option value="__brand_general__">Brand / General</option>
<optgroup label="Face">
  <option value="gid://shopify/Product/123">For the Face (Gentle)</option>
  ...
</optgroup>
<optgroup label="Body">
  <option value="gid://shopify/Product/456">Magnesium Balm</option>
  ...
</optgroup>
```

Creative type `<select>` grouped by fidelity+format:
```html
<option value="">— Select type —</option>
<optgroup label="High Def — Static">
  <option value="ecom_product_shots">ECom Product Shots</option>
  ...
</optgroup>
<optgroup label="Lofi — Video">
  <option value="product_love_testimonial">Product Love Testimonials</option>
  ...
</optgroup>
```

### 4E. Batch defaults bar

Above the file list in each batch card, render:

```
Set defaults:  Product [select ▼]  Type [select ▼]  [Apply to all]
```

The "Apply to all" button iterates through all files in this batch and sets `productId`, `productName`, and `creativeType` on any file that doesn't already have a value.

### 4F. Submission payload update

In the `handleSubmit` function, when constructing `submission_files` rows for the Supabase insert, add:

```typescript
{
  // existing fields...
  submission_id: submissionId,
  file_name: file.name,
  file_type: file.type,
  file_size: file.size,
  file_url: storageUrl,
  media_format: fileContext.mediaFormat,
  aspect_ratio: fileContext.aspectRatio,
  width: fileContext.width,
  height: fileContext.height,
  // NEW fields:
  product_id: fileContext.productId || null,
  product_name: fileContext.productName || null,
  creative_type: fileContext.creativeType || null,
  fidelity: fileContext.creativeType
    ? (CREATIVE_TYPES_MAP.get(fileContext.creativeType)?.fidelity ?? null)
    : null,
  hook_angle: fileContext.hookAngle || null,
}
```

---

## Part 5: Pipeline View — Show Tags on Cards

### 5A. Update batch card display

In `src/app/submissions/page.tsx`, when fetching submission files, include the new columns. When rendering file rows inside an expanded batch card, show tags as small chips:

- Product → orange chip showing `product_name`
- Creative type → blue chip showing the label (use `getCreativeTypeLabel()`)
- Hook angle → gray italic text beneath

### 5B. Add filter bar at top of pipeline page

Above the kanban columns, add a filter row:

```
Filter:  [Product ▼]  [Creative Type ▼]  [Search... 🔍]
```

- Product filter: populated from `shopify_products` for the selected brand, plus "Brand / General"
- Creative type filter: from `CREATIVE_TYPE_GROUPS` (flat list)
- Search: matches against `file_name`, `hook_angle`, `product_name`

When filters are active, query `submission_files` with the filter conditions, then group by `submission_id` to show matching batches. Show a "Clear filters" button when any filter is active.

---

## Part 6: Backfill Products for Existing Brands (Post-Deploy)

### Problem

Three brands have Shopify credentials configured but zero products in `shopify_products`:

| Brand | shopify_store_domain | Products synced? |
|-------|---------------------|------------------|
| FOND | fondbonebrothtonics.myshopify.com | ❌ 0 products |
| Nimi Skincare | bs-capital-merch.myshopify.com | ❌ 0 products |
| Tallow Twins | 1a616b.myshopify.com | ❌ 0 products |
| Organic Jaguar | (no Shopify configured) | N/A |
| Melch Demo | melch-demo.myshopify.com | ✅ demo data only |

The product sync added in Part 2A only runs when someone triggers the `POST /api/shopify-sync` endpoint. Without an explicit backfill, the product dropdowns will be empty for these brands until someone happens to trigger a sync.

### 6A. Create a one-time backfill endpoint

Create `src/app/api/sync-products/route.ts` — a standalone endpoint that ONLY syncs products (not orders or ad spend). This is lighter-weight and can be called from an admin UI or manually after deployment.

```typescript
// POST /api/sync-products
// Optional body: { brand_id?: string }
// If brand_id provided, sync just that brand. Otherwise sync ALL brands with Shopify credentials.

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const targetBrandId = body.brand_id;

  // Query brands that have Shopify configured
  let query = supabase
    .from('brands')
    .select('id, name, shopify_store_domain, shopify_client_id, shopify_client_secret')
    .not('shopify_store_domain', 'is', null)
    .not('shopify_client_id', 'is', null)
    .not('shopify_client_secret', 'is', null);

  if (targetBrandId) {
    query = query.eq('id', targetBrandId);
  }

  const { data: brands } = await query;

  const results = [];

  for (const brand of (brands || [])) {
    try {
      // Fetch products from Shopify REST API
      // Use same auth pattern as shopify-sync route
      const auth = Buffer.from(
        `${brand.shopify_client_id}:${brand.shopify_client_secret}`
      ).toString('base64');

      let allProducts: any[] = [];
      let url = `https://${brand.shopify_store_domain}/admin/api/2024-01/products.json?limit=250&status=active`;

      while (url) {
        const res = await fetch(url, {
          headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
        });

        if (!res.ok) {
          results.push({ brand: brand.name, error: `HTTP ${res.status}`, products: 0 });
          break;
        }

        const data = await res.json();
        allProducts = allProducts.concat(data.products || []);

        // Handle Shopify Link header pagination
        const linkHeader = res.headers.get('link');
        const nextMatch = linkHeader?.match(/<([^>]+)>;\s*rel="next"/);
        url = nextMatch ? nextMatch[1] : '';
      }

      // Upsert each product
      for (const product of allProducts) {
        await supabase.from('shopify_products').upsert({
          shop_domain: brand.shopify_store_domain,
          brand_id: brand.id,
          shopify_product_id: `gid://shopify/Product/${product.id}`,
          title: product.title,
          handle: product.handle,
          status: product.status,
          product_type: product.product_type || '',
          vendor: product.vendor || '',
          tags: product.tags ? product.tags.split(', ') : [],
          variants: product.variants || [],
          images: product.images || [],
          shopify_created_at: product.created_at,
          shopify_updated_at: product.updated_at,
          raw: product,
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'shop_domain,shopify_product_id',
        });
      }

      results.push({ brand: brand.name, products: allProducts.length, error: null });
    } catch (err: any) {
      results.push({ brand: brand.name, error: err.message, products: 0 });
    }
  }

  return NextResponse.json({ results });
}
```

### 6B. Deployment step

After deploying the code changes, trigger the product backfill:

```bash
# From local or via curl after deploy:
curl -X POST https://your-domain.com/api/sync-products \
  -H "Content-Type: application/json" \
  -d '{}'
```

This will sync products for all brands with Shopify credentials in one shot. Future syncs happen automatically whenever the regular `shopify-sync` endpoint runs (including via the ad spend cron once it's deployed).

### 6C. Optional: Admin UI "Sync Products" button

In the brand settings page, add a "Sync Products Now" button that calls `POST /api/sync-products` with `{ brand_id: selectedBrandId }`. This gives users a manual trigger if a brand adds new products to Shopify and wants them to appear in the creative tagging dropdown immediately.

---

## Implementation Order

1. **Run SQL migration** — add columns to `submission_files` (Part 1B)
2. **Add product sync** to shopify-sync route (Part 2A)
3. **Create** `src/app/api/sync-products/route.ts` — standalone backfill endpoint (Part 6A)
4. **Create** `src/lib/creative-types.ts` (Part 3)
5. **Create** `src/app/api/brand-products/route.ts` (Part 2B)
6. **Update** `src/lib/types.ts` — add new fields to `SubmissionFile` interface
7. **Update** `src/components/SubmissionForm.tsx` — per-file tagging UI (Part 4)
8. **Update** `src/app/submissions/page.tsx` — tag chips + filters (Part 5)
9. **Post-deploy:** call `POST /api/sync-products` to backfill all brands (Part 6B)

## Important Notes

- All new columns are nullable — zero risk to existing data.
- `product_id` is a TEXT column storing Shopify product ID, NOT a UUID FK. This avoids coupling to the sync table's lifecycle.
- `product_name` is intentionally denormalized — we store the name at upload time so it displays correctly even if the Shopify product changes later.
- Fidelity is derived from creative type, not a separate input.
- **Do NOT touch** batch naming logic, Dropbox sync flow, or the existing `creative_type` field on the `submissions` table (that's the batch-level UGC/Static/Video/Other field — leave it as is).
- The `tags` JSONB column is for future use (free-form tags). Not exposed in the form yet.
- If `shopify_products` has no data for a brand (Shopify not connected), the product dropdown just shows "Brand / General" as the only option. The form still works.

## Files to create/modify

1. **Create** `src/lib/creative-types.ts`
2. **Create** `src/app/api/brand-products/route.ts`
3. **Create** `src/app/api/sync-products/route.ts` — standalone product backfill endpoint
4. **Modify** `src/app/api/shopify-sync/route.ts` — add product fetch alongside order sync
5. **Modify** `src/lib/types.ts` — update `SubmissionFile` type
6. **Modify** `src/components/SubmissionForm.tsx` — per-file tagging UI
7. **Modify** `src/app/submissions/page.tsx` — tag chips + filter bar
