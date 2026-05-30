# Claude Code Prompt: Build Creative Diversity Matrix Page

## Context

Build a new page at `/analytics/creative-matrix` that shows a heatmap matrix of creative coverage across products × creative type groups. This helps strategists and admins see where they have strong creative coverage and where the gaps are.

The page pulls data from `submission_files` (which have `product_id`, `product_name`, `creative_type`, `fidelity`, `hook_angle` tags) joined with `submissions` (for `brand_id`), and cross-references with `shopify_products` (for the full product list including products with 0 creatives).

No new database tables or columns needed — everything reads from existing data.

## Page: `src/app/analytics/creative-matrix/page.tsx`

### Auth + brand selection

Follow the same pattern as other analytics pages (e.g., `src/app/analytics/efficiency/page.tsx`):

```typescript
'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Loader, Grid3X3, ChevronDown, ChevronRight, Package, AlertTriangle } from 'lucide-react';
import Navbar from '@/components/Navbar';
import { createClient } from '@/lib/supabase';
import { CREATIVE_TYPE_GROUPS, getCreativeTypeLabel } from '@/lib/creative-types';
```

- On mount, check auth via `supabase.auth.getSession()`
- Fetch user profile for role + brand_id
- If admin: show a brand selector dropdown (fetch brands from `brands` table, filter `archived_at IS NULL`)
- If strategist: auto-select their brand
- If no session: redirect to `/`

### Data fetching

Once a brand is selected, fetch two things in parallel:

**1. All tagged submission_files for the brand:**
```typescript
const { data: files } = await supabase
  .from('submission_files')
  .select(`
    id, product_id, product_name, creative_type, fidelity,
    hook_angle, media_format, status, file_name,
    submissions!inner (brand_id)
  `)
  .eq('submissions.brand_id', selectedBrandId)
  .not('creative_type', 'is', null);
```

**2. All active products for the brand (for the full product list including 0-creative products):**
```typescript
const { data: products } = await supabase
  .from('shopify_products')
  .select('shopify_product_id, title, product_type')
  .eq('brand_id', selectedBrandId)
  .eq('status', 'active')
  .order('product_type')
  .order('title');
```

**Important:** Call `await supabase.auth.getSession()` before both queries to ensure auth is loaded (same fix as the upload form product dropdown).

### Processing the data

Build the matrix data structure:

```typescript
// Define the 6 column groups from CREATIVE_TYPE_GROUPS
const COLUMN_GROUPS = [
  { key: 'hd_static', label: 'Static', parent: 'High def', fidelity: 'high_def', format: 'static' },
  { key: 'hd_video', label: 'Video', parent: 'High def', fidelity: 'high_def', format: 'video' },
  { key: 'lofi_static', label: 'Static', parent: 'Lofi', fidelity: 'lofi', format: 'static' },
  { key: 'lofi_video', label: 'Video', parent: 'Lofi', fidelity: 'lofi', format: 'video' },
  { key: 'other_static', label: 'Static', parent: 'Other', fidelity: 'other', format: 'static' },
  { key: 'other_video', label: 'Video', parent: 'Other', fidelity: 'other', format: 'video' },
];

// For each product, count creatives per column group
// Also track which specific creative_type values appear in each cell
```

For each product row:
- Count how many tagged files fall into each of the 6 column groups
- Also track the specific `creative_type` values for drill-down
- Include a "Brand / General" row for files tagged with `product_id = '__brand_general__'`

For products with 0 creatives:
- Show them collapsed at the bottom as "{N} products with no creatives" (expandable)

Sort rows by total creatives descending (most-covered products first).

### KPI cards (4 cards in a row)

```
[Tagged creatives]    [Products covered]    [Types used]        [Biggest gap]
      43                  8 / 35              12 / 44          "Lofi Video"
  of 127 total         23% coverage       6 groups used     0 across 3 products
```

- **Tagged creatives**: Count of submission_files with non-null creative_type for this brand. Sub-text: "of {total_files} total files"
- **Products covered**: Count of distinct product_names that have at least 1 tagged creative, vs total products. Sub-text: "{pct}% coverage"
- **Types used**: Count of distinct creative_type values used, vs 44 total possible. Sub-text: "{groups_used} groups represented"
- **Biggest gap**: The column group with the fewest creatives across all products. Sub-text: description

### Matrix table

**Header rows:**

```
| Product            | High def      | Lofi          | Other         | Total |
|                    | Static | Video | Static | Video | Static | Video |       |
```

Use `<colgroup>` or merged header cells for the parent group labels.

**Data rows:**

Each product row shows:
- Product name + product_type (small muted text)
- 6 colored cells (one per column group)
- Total column

**Cell rendering:**

Each cell shows a colored badge with the count:
- 0 creatives: muted/empty cell with "—"
- 1 creative: light red background (#FCEBEB text #791F1F)
- 2-3 creatives: light amber background (#FAEEDA text #633806)
- 4-5 creatives: light green background (#EAF3DE text #27500A)
- 6+ creatives: light teal background (#E1F5EE text #085041)

**Expandable rows:**

When a product row is clicked, expand it to show a detail row listing which specific creative types are present in each column group. For example:
```
  ↳ HD Static: ECom Product Shots (3), Campaign Model Shots (2)
    HD Video: Application Demo (1), Beauty Hero Shots (1)
    Lofi Static: —
    ...
```

**Total row at bottom:**

Sum of each column across all products. Same color coding.

**Empty-product rows:**

Products with 0 creatives shown collapsed:
```
27 more products with no creatives    [expand ▼]
```

When expanded, list them with all "—" cells. Sorted alphabetically.

### Styling

Follow the app's existing dark theme exactly (as seen in the upload page and other analytics pages):
- Background: dark (let Navbar handle it)
- Text: `#F5F5F8` for primary, `#ABABAB` / `gray-500` for secondary
- Borders: `rgba(255,255,255,0.08)`
- Card backgrounds: `rgba(255,255,255,0.04)` for subtle, `rgba(255,255,255,0.06)` for hover
- Accent color: `#C8B89A` (gold)
- Use the colored cell backgrounds from above — these are light-mode colors that work well as badge fills even on dark backgrounds

The cell badges should be small rounded elements (like the ones in the mockup):
```css
display: inline-flex;
align-items: center;
justify-content: center;
width: 42px;
height: 28px;
border-radius: 6px;
font-size: 12px;
font-weight: 500;
```

### Legend

Below the matrix, show a legend:
```
[gap] [1] [2-3] [4-5] [6+]
```

With the corresponding colored dots/squares.

### Empty state

When no files have been tagged yet (all creative_type values are null), show:

```
No tagged creatives yet

Upload creatives with product and type tags to start building your coverage matrix.
The upload form lets you tag each file with a product and creative type.

[Go to Upload →]
```

### Page header

```
Creative Diversity Matrix
See creative coverage across your product catalog and creative types.
Identify gaps and plan new content.
```

If admin, show a brand selector in the header area (same pattern as efficiency page).

## Nav link

### In `src/components/Navbar.tsx`

Add a new child under the Analytics nav section, after 'Ad Perspective':

```typescript
{ label: 'Creative Matrix', href: '/analytics/creative-matrix', icon: Grid3X3 },
```

Make sure `Grid3X3` is imported from `lucide-react` at the top of the file (it's already imported as `LayoutGrid` but `Grid3X3` is a better icon — check if it's available, otherwise use `LayoutGrid` or `Layers`).

The nav item should be visible to: `['admin', 'strategist']`

## Technical notes

- The page is `'use client'` — all data fetching happens client-side via the Supabase browser client
- Always call `await supabase.auth.getSession()` before any `.from()` query to ensure auth cookies are loaded
- Import `CREATIVE_TYPE_GROUPS` and `getCreativeTypeLabel` from `@/lib/creative-types` for mapping creative_type values to labels and groups
- Each `creative_type` value in the database corresponds to a type in `CREATIVE_TYPE_GROUPS` which has `fidelity` (high_def, lofi, other) and `format` (static, video) — use these to determine which column group a creative falls into
- Use `CREATIVE_TYPES_MAP` from `@/lib/creative-types` to look up the fidelity/format for each creative_type value: `CREATIVE_TYPES_MAP.get(creativeTypeValue)?.fidelity` and `.format`
- The `useMemo` hook should compute the matrix data from the raw files + products to avoid recomputation on every render

## What NOT to change

- Don't create any new database tables or columns
- Don't modify the `submission_files` or `submissions` table structure
- Don't change any existing analytics pages
- Don't change the upload form or FileCard components
- Don't modify `creative-types.ts`
- Don't add any API routes — this page queries Supabase directly from the client

## Files to create/modify

1. **CREATE** `src/app/analytics/creative-matrix/page.tsx` — the full page
2. **MODIFY** `src/components/Navbar.tsx` — add nav link under Analytics children
