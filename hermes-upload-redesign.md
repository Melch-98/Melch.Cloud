# Hermes Prompt: Rebuild Creative Upload Page

## Context

The `/upload` page needs a full layout and UX redesign. The current implementation is a single-column vertically scrolling form with tiny 80x80 thumbnails and cramped inline tagging fields. We want a cleaner two-column layout inspired by our Blip upload tool, while keeping all existing tagging/submission functionality intact.

**Reference layout (Blip):** Two-column — copy/metadata on the left, asset preview grid on the right. Clean card-based copy variations. Large thumbnails. Everything visible without endless scrolling.

## Files to modify

- `src/components/SubmissionForm.tsx` (1231 lines — the core form, major rewrite)
- `src/components/FileCard.tsx` (387 lines — per-file card, major rewrite)
- `src/components/FileUploader.tsx` (172 lines — drop zone, minor tweaks)
- `src/app/upload/page.tsx` (103 lines — page wrapper, minor tweaks)

**Do NOT modify:**
- `src/lib/creative-types.ts` (keep all 40 creative types and groups as-is)
- `src/lib/types.ts` (keep all type definitions as-is)
- Any API routes — the submission payload/API contract must stay identical
- `src/components/Navbar.tsx`

## Design system

All styling uses Tailwind CSS utility classes + inline `style` objects. Dark theme only:
- Background: `#0A0A0A` (page), `#0D0D0D` (sidebar), `#111111` (cards)
- Text: `#F5F5F8` (primary), `#ABABAB` (secondary), `gray-500` (tertiary)
- Accent: `#C8B89A` (gold — buttons, highlights, active states)
- Borders: `rgba(255,255,255,0.06)` to `rgba(255,255,255,0.12)`
- Interactive hover: `rgba(200,184,154,0.1)` backgrounds
- Border radius: `rounded-xl` for cards, `rounded-lg` for inputs/buttons

## Requirements

### 1. Two-column layout

Replace the single-column `max-w-4xl` layout with a two-column split:

```
┌─────────────────────────────┬──────────────────────────────┐
│  LEFT COLUMN (55%)          │  RIGHT COLUMN (45%)          │
│                             │                              │
│  Batch header + toggles     │  FileUploader drop zone      │
│  Copy template selector     │  Asset thumbnail grid        │
│  Primary text variations    │   (3 columns, ~160px each)   │
│  Headlines                  │                              │
│  Descriptions               │  Selected asset detail panel │
│  Creator info               │   (shows when asset clicked) │
│                             │                              │
│                             │  Creative Matrix mini-summary│
└─────────────────────────────┴──────────────────────────────┘
┌──────────────────────────────────────────────────────────────┐
│  STICKY FOOTER — batch stats + Submit All Batches button     │
└──────────────────────────────────────────────────────────────┘
```

Use `grid grid-cols-12 gap-6` with left column `col-span-7` and right column `col-span-5`. Both columns should scroll independently (each with `overflow-y-auto` and `max-h-[calc(100vh-160px)]` to account for navbar + footer). Use `sticky top-0` on the right column header.

On screens below `lg` breakpoint, stack to single column (right column on top for mobile — assets first).

### 2. Asset thumbnail grid (right column)

Replace the tiny 80x80 inline thumbnails with a proper grid:

- 3-column grid of asset cards, each ~160px tall
- Each card shows:
  - Large thumbnail filling the card (use `object-cover`)
  - File format badge in top-left corner (e.g., "MP4", "PNG", "JPG") — small pill, semi-transparent black background
  - Aspect ratio badge in bottom-right (e.g., "9:16", "1:1") — same style
  - Play icon overlay for videos (centered, semi-transparent)
  - Thin gold border (`border-2 border-[#C8B89A]`) when selected
  - Subtle hover effect: `opacity-80` -> `opacity-100` + slight scale
- Clicking an asset selects it and opens the **asset detail panel** below the grid
- Multi-select support: hold Shift to select multiple assets for bulk tagging
- Drag-and-drop reordering within the grid (for carousel order)
- Duplicate warning: yellow border + small warning icon overlay when `dupeWarning` is set

Keep the existing video thumbnail extraction logic (canvas frame grab at 0.5s) from the current FileCard.

### 3. Asset detail panel (right column, below grid)

When an asset is selected, show a detail panel below the grid (slides in with a smooth transition):

```
┌──────────────────────────────────────────────┐
│  [large preview ~240px]  │  filename.mp4      │
│                          │  1080x1920 • 9:16  │
│                          │  2.4 MB • VIDEO     │
├──────────────────────────┴───────────────────┤
│  CREATIVE TYPE                                │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐     │
│  │ High Def │ │  Lo-Fi   │ │  Other   │     │
│  │  Static  │ │  Video   │ │ Formats  │     │
│  └──────────┘ └──────────┘ └──────────┘     │
│  (show subtypes as pills when group selected) │
│                                               │
│  PRODUCT         [dropdown ▾]                 │
│  HOOK / ANGLE    [text input]                 │
│  COPY TEMPLATE   [dropdown ▾]                 │
│  CREATOR         [name]  [@handle]            │
└───────────────────────────────────────────────┘
```

**Creative type selector redesign:** Replace the cramped `<select>` dropdown with a two-step visual selector:

1. First, show 6 group buttons as a 3x2 grid of pills/cards:
   - "High Def Static", "High Def Video", "Lofi Static", "Lofi Video", "Other Static", "Other Video"
   - Each pill shows a small icon and the group name
   - Auto-filter: if the file is a video, dim/disable the static groups and vice versa (but don't prevent selection — sometimes people miscategorize)

2. When a group is clicked, expand to show the subtypes within that group as smaller clickable pills below. Use `CREATIVE_TYPE_GROUPS` from `src/lib/creative-types.ts` for the data.

3. Selected type shows with gold background/border. The group pill stays highlighted.

**Bulk tagging:** When multiple assets are selected (via Shift+click), show a "Tagging X assets" header in the panel. Any field changed applies to all selected assets. Show a visual indicator of which fields differ across the selection (e.g., "Mixed" label on the product dropdown if different products are selected).

### 4. Copy section (left column)

Restructure the copy fields to look like Blip's layout:

- **Copy template selector** at top — full-width dropdown, styled as a card
- **Primary text** — show each variation as a distinct card with:
  - The text content (editable textarea)
  - A delete button (trash icon) on the right
  - "Add variation" button below as a dashed-border card
- **Headlines** — same card-per-entry pattern as primary text
- **Descriptions** — same pattern
- Show character counts on textareas (Meta has limits: primary text ~125 chars before truncation, headline 40 chars, description 30 chars)

For carousel mode: primary text stays in the left column (it's batch-level), but per-card headlines/descriptions appear in the asset detail panel when a specific asset is selected.

### 5. Creative matrix mini-summary

Add a collapsible section at the bottom of the right column (above the sticky footer) that shows a mini creative matrix for the current brand:

- Query `submission_files` joined with `submissions` for the selected brand to get counts by `creative_type` and `fidelity`
- Show a simple heatmap grid:
  - Rows: product names (top 5 products by creative count)
  - Columns: creative type groups (High Def Static, High Def Video, Lofi Static, Lofi Video, Other Static, Other Video)
  - Cells: count of existing creatives, color-coded (0 = red/empty, 1-3 = yellow, 4+ = green)
- Mark cells that will be filled by the current upload batch with a `+N` indicator
- Collapsed by default, expand with a "Creative Coverage" toggle button
- This is read-only / informational — no interaction needed

Create an API route at `src/app/api/creative-matrix-summary/route.ts` to serve this data:
```sql
SELECT 
  sf.creative_type,
  sf.fidelity,
  sf.product_name,
  COUNT(*) as count
FROM submission_files sf
JOIN submissions s ON sf.submission_id = s.id
WHERE s.brand_id = $1
GROUP BY sf.creative_type, sf.fidelity, sf.product_name
```

### 6. Batch management

Keep multi-batch support but simplify the UI:

- Batch tabs along the top of the left column (horizontal tab bar, not collapsible accordions)
- Each tab shows: batch name + file count badge
- "+" button to add a new batch
- Active tab has gold underline
- Batch toggles (Carousel, Flexible, Whitelist) move into the batch tab bar area as small icon toggles

### 7. Sticky footer

Keep the existing sticky footer but clean it up:
- Left side: batch count + total file count + total file size
- Right side: "Submit All Batches" button (gold background, same style as current)
- Add a progress bar during upload (currently just a spinner)

### 8. Preserve ALL existing functionality

This is critical. Every feature that exists today must continue to work:

- File upload to Supabase Storage at `{brandId}/{batchName}/{fileName}`
- `submissions` + `submission_files` row creation with all metadata fields
- Dropbox sync trigger via `/api/submissions/sync-drive`
- Notification via `/api/notify`
- Duplicate filename detection and warnings
- Brand product fetching from `shopify_products` + "Sync from Shopify" button
- Copy template fetching from `/api/copy-templates`
- Batch name generation from `/api/batch-name`
- Carousel mode (per-card headlines/descriptions)
- Flexible ad mode
- Whitelist mode (creator handle required)
- All `FileContext` fields must still be captured and submitted
- Permission checks (can_upload)
- Admin redirect

### 9. Animations and transitions

- Asset detail panel: slide in from bottom with `transition-all duration-200`
- Creative type group expansion: `max-h` transition
- Batch tab switching: no animation needed (instant)
- Thumbnail hover: `transition-transform duration-150 hover:scale-[1.02]`
- Selected state: `transition-colors duration-150`

## Implementation approach

1. Start with the layout restructure of `SubmissionForm.tsx` — two columns, batch tabs
2. Rebuild `FileCard.tsx` as two components: `AssetThumbnail` (grid card) and `AssetDetailPanel` (tagging panel)
3. Update `FileUploader.tsx` to fit in the right column header
4. Build the creative type visual selector as a new component `CreativeTypeSelector.tsx`
5. Build the creative matrix summary component + API route
6. Test all submission flows still work (standard upload, carousel, flexible, whitelist)
7. Verify mobile responsiveness

## Testing checklist

After implementation, verify:
- [ ] Upload 5 static images — thumbnails render correctly in grid
- [ ] Upload 2 videos — frame extraction works, play icon shows
- [ ] Click an asset — detail panel opens with correct metadata
- [ ] Tag creative type using new visual selector — saves to FileContext
- [ ] Select product from dropdown — saves to FileContext  
- [ ] Shift+click 3 assets — bulk tagging panel shows, changes apply to all 3
- [ ] Switch to carousel mode — per-card headlines appear in detail panel
- [ ] Enable whitelist — @handle field appears
- [ ] Submit batch — verify `submissions` and `submission_files` rows created correctly in Supabase
- [ ] Verify Dropbox sync triggers
- [ ] Verify duplicate filename detection still works
- [ ] Test on mobile viewport — single column layout
- [ ] Creative matrix summary loads and shows correct counts
