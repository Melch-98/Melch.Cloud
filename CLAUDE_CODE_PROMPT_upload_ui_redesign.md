# Claude Code Prompt: Upload Form UI Redesign — Inline File Cards with Tagging

## Context

Melch.Cloud's upload form (`src/components/SubmissionForm.tsx`) was recently updated to add creative tagging (product, creative type, hook/angle). The tagging works functionally, but the UI has a problem: the tags live in a **separate "Creative Tags" section** below the file list. This means users see files in one spot and their tag dropdowns in another, scanning back and forth matching filenames. It also makes the form unnecessarily tall.

**Goal:** Merge the file list and creative tags into a single set of rich file cards. Each card shows a thumbnail + filename + tag dropdowns together. Remove the separate "Creative Tags" section entirely.

---

## What to change

### 1. Redesign the file card layout

Currently each file is a slim row: `[icon] filename [VIDEO badge] [9:16 badge] [✕]`

Replace with a richer card:

```
┌──────────────────────────────────────────────────────┐
│ ┌──────────┐  filename.mp4                      [✕]  │
│ │          │  Video · 182.4 MB                       │
│ │ THUMBNAIL│                                         │
│ │  80×80   │  [Product ▼]  [Type ▼]  [Hook/angle___] │
│ └──────────┘                                         │
└──────────────────────────────────────────────────────┘
```

Each file card should be:
- `background: white` (or your card background token)
- `border: 0.5px solid` border color
- `border-radius: 8-12px`
- `padding: 12px`
- `margin-bottom: 8px`
- Flex row layout: thumbnail on left, content on right

### 2. Thumbnail implementation

**For images (JPEG, PNG, WebP, etc.):**
- Use `URL.createObjectURL(file)` to generate a preview from the File object
- Display as an `<img>` tag, 80×80px, `object-fit: cover`, rounded corners (8px)
- Clean up object URLs on unmount with `URL.revokeObjectURL()`

**For videos (MP4, MOV, etc.):**
- Use a `<video>` element with `preload="metadata"` to load a poster frame
- On `loadeddata` event, draw the first frame to a hidden `<canvas>`, then use `canvas.toDataURL()` as the thumbnail image
- Overlay a small play icon badge (top-left corner): semi-transparent black pill with `▶` and duration if available
- Fallback: if frame extraction fails, show a dark placeholder with a centered play icon

**For both:**
- Show aspect ratio badge (bottom-right corner): small pill like "9:16", "1:1", "16:9" — derived from the existing `aspectRatio` value in fileContext
- Thumbnail container: `width: 80px; height: 80px; border-radius: 8px; overflow: hidden; flex-shrink: 0; position: relative;`

### 3. Card content area (right side of thumbnail)

**Top row** — filename + delete button:
```
filename.mp4                                    [✕]
Video · 182.4 MB
```
- Filename: `font-size: 13px; font-weight: 500;` with `text-overflow: ellipsis` for long names
- File info: `font-size: 11px; color: muted;` — show media type + file size
- Delete button: positioned at top-right of the content area, icon-only (`✕`), subtle/muted color

**Bottom row** — inline tag dropdowns:
```
[Product ▼]  [Type ▼]  [Hook / angle___________]
```
- Three inputs in a flex row with `gap: 6px; flex-wrap: wrap;`
- Product select: `flex: 1; min-width: 120px; font-size: 12px; height: 30px;`
- Creative type select: same sizing
- Hook/angle text input: same sizing
- These are the SAME inputs that currently exist in the "Creative Tags" section — just moved into the card. The state management (`fileContexts`, `productId`, `productName`, `creativeType`, `hookAngle`) stays exactly the same.

### 4. Move "batch defaults" bar above file cards

Currently the "SET DEFAULTS" section is inside the Creative Tags area. Move it to a compact bar directly above the file cards (but below the drag-and-drop zone, or above it — wherever makes sense in the batch card flow).

Layout:
```
Batch defaults  [Product ▼]  [Type ▼]  [Apply to all]
```

- Single-line horizontal flex with `align-items: center; gap: 8-10px;`
- Background: subtle surface color (secondary background)
- Border-radius: 8-12px
- Padding: `8px 14px`
- Label "Batch defaults": `font-size: 12px; color: muted;`
- Selects: `height: 32px; font-size: 13px;`
- "Apply to all" button: small, compact
- Only show this bar when there are 2+ files (no point in "apply to all" for a single file)

### 5. Remove the separate "Creative Tags" section

Delete the entire `Creative Tags` heading and the separate per-file tag rows that currently render below the file list. All of that UI now lives inside the file cards themselves. This includes:
- The "Creative Tags" `<h3>` or section header
- The "SET DEFAULTS" bar (moved, not deleted)
- The per-file rows that show `[filename] [Product ▼] [Type ▼] [Hook / angle]`

### 6. Move the drop zone

Currently the drag-and-drop zone ("Drag files here or click to browse") sits above the file list. Keep it there, but make sure it appears ABOVE the batch defaults bar and file cards. The visual order within a batch card should be:

```
1. Batch header (BATCH 1 · TLW_260530_0001)
2. Format toggles (Carousel Ad | Flexible Ad | Whitelist)
3. Batch fields (batch name, creative type, creator name, landing page, copy template)
4. Drag-and-drop zone
5. Batch defaults bar (if 2+ files)
6. File cards with inline tags
```

### 7. Responsive behavior

On narrow viewports (< 500px), the tag dropdowns inside each card should wrap below the thumbnail instead of sitting beside it:

```
┌─────────────────────────┐
│ ┌──────────┐            │
│ │ THUMBNAIL│  filename  │
│ │  80×80   │  Video·46M │
│ └──────────┘        [✕] │
│ [Product ▼]             │
│ [Type ▼]                │
│ [Hook / angle_________] │
└─────────────────────────┘
```

Use `flex-wrap: wrap` on the outer card flex container so it naturally reflows.

---

## What NOT to change

- **State management** — keep the existing `fileContexts` state, `batchDefaults` state, product fetching via `/api/brand-products`, creative type imports from `src/lib/creative-types.ts`. This is purely a UI rearrangement.
- **Submission payload** — the `handleSubmit` function stays the same. Same fields get sent to Supabase.
- **Batch-level fields** — batch name, creative type (UGC/Static/Video/Other), creator name, landing page URL, copy template. Leave these where they are.
- **FileUploader component** — the drag-and-drop component itself. Just make sure the file cards render below it.
- **Carousel/flexible ad toggles** — keep as-is.
- **The existing VIDEO / 9:16 badges on the old file rows** — these are replaced by the thumbnail badges (aspect ratio on the thumbnail, media type in the text).

---

## Implementation notes

- The product `<select>` should use `<optgroup>` labels grouped by `product_type` (same as the current implementation in Creative Tags)
- The creative type `<select>` should use `<optgroup>` labels grouped by fidelity+format (same as current)
- When a product is selected, update both `productId` and `productName` in the fileContext (same as current)
- When a creative type is selected, the `fidelity` is auto-derived from `CREATIVE_TYPES_MAP` (same as current)
- For the video thumbnail extraction, wrap it in a try/catch — CORS or codec issues can prevent frame extraction. Fall back to a dark placeholder with a play icon.
- Object URLs from `URL.createObjectURL()` must be revoked when the component unmounts or when a file is removed. Use a cleanup effect.
- Keep the file size display human-readable (KB/MB/GB)

## Files to modify

1. **`src/components/SubmissionForm.tsx`** — main changes (card layout, thumbnail generation, move tags inline, remove Creative Tags section, move batch defaults bar)
2. Possibly extract a new **`src/components/FileCard.tsx`** component if SubmissionForm is getting too large — each file card with thumbnail + tags as a self-contained component that receives the fileContext and product list as props
