# Claude Code Prompt: Upload Form Cleanup — Remove Redundant Fields, Tighten Layout

## Context

The upload form has redundant batch-level fields that are now handled per-file. The batch-level "Creative Type" (UGC/Static/Video/Other) is redundant because each file card already has its own creative type tag. The batch-level "Landing Page URL" is redundant because the per-file product selection replaces it. This makes the form unnecessarily tall.

## Changes

### 1. Remove batch-level "Creative Type" field from the form UI

In `src/components/SubmissionForm.tsx`, delete the Creative Type `<Field>` block in the form fields grid (~lines 777-793):

```tsx
// DELETE THIS ENTIRE BLOCK:
<Field label="Creative Type" error={batch.errors.creativeType}>
  <select
    value={batch.creativeType}
    onChange={(e) =>
      updateBatch(batch.id, { creativeType: e.target.value })
    }
    className={`${selectClass} ${inputFocusStyle}`}
    style={inputStyle}
  >
    <option value="">Select type</option>
    {CREATIVE_TYPES.map((type) => (
      <option key={type} value={type}>
        {type}
      </option>
    ))}
  </select>
</Field>
```

Also remove the `CREATIVE_TYPES` array definition (around line 70):
```tsx
const CREATIVE_TYPES = ['UGC', 'Static', 'Video', 'Other'];
```

### 2. Remove batch-level "Landing Page URL" field from the form UI

Delete the Landing Page URL `<Field>` block (~lines 838-853):

```tsx
// DELETE THIS ENTIRE BLOCK:
<Field
  label="Landing Page URL"
  error={batch.errors.landingPageUrl}
>
  <input
    type="url"
    value={batch.landingPageUrl}
    onChange={(e) =>
      updateBatch(batch.id, { landingPageUrl: e.target.value })
    }
    className={`${inputClass} ${inputFocusStyle}`}
    style={inputStyle}
    placeholder="https://..."
  />
</Field>
```

### 3. Remove validation for both fields

In the `validateBatch` function, remove these checks:

```tsx
// DELETE: creative type validation (~line 379-381)
if (!batch.creativeType) {
  errors.creativeType = 'Creative type is required';
}

// DELETE: landing page validation (~line 387-389)
if (!batch.landingPageUrl.trim()) {
  errors.landingPageUrl = 'Landing page URL is required';
}
```

### 4. Set sensible defaults on submission

In `handleSubmit`, the submission insert still sends `creative_type` to the database. Change it to derive from the file-level tags or default to `'mixed'`:

**Current:**
```tsx
creative_type: batch.creativeType.toLowerCase(),
```

**Replace with:**
```tsx
creative_type: (() => {
  // Derive from file-level creative types — use the most common, or 'mixed'
  const types = Object.values(batch.fileContexts)
    .map((c: any) => c?.creativeType)
    .filter(Boolean);
  if (types.length === 0) return 'mixed';
  const counts = new Map<string, number>();
  for (const t of types) counts.set(t, (counts.get(t) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
})(),
```

For `landing_page_url`, it's already `batch.landingPageUrl || null` which will just be `null` now. That's fine — leave it as-is.

### 5. Tighten the batch fields layout

After removing Creative Type and Landing Page URL, the remaining batch fields are:
- Batch Name (always)
- Creator Name (normal + whitelist modes)
- Creator Social Handle (whitelist only)
- Primary Text (carousel only)
- Copy Template (not carousel)

Change the form fields grid from `grid-cols-2` to a more compact layout. Make "Batch Name" take full width when it's the only field on its row:

**Current:**
```tsx
<div className="grid grid-cols-2 gap-4">
```

**Replace with:**
```tsx
<div className="grid grid-cols-2 gap-3">
```

And make the Batch Name field span full width since Creative Type (its former neighbor) is gone. Add `className="col-span-2"` to the Batch Name `<Field>`:

```tsx
<Field label="Batch Name" error={batch.errors.batchName} className="col-span-2">
```

Wait — actually, pair Batch Name with Copy Template (or Creator Name) to keep the 2-column grid tight. The specifics:

- **Default mode (no toggles):** Row 1: Batch Name + Creator Name. Row 2: Copy Template (full width).
- **Whitelist mode:** Row 1: Batch Name + Creator Name. Row 2: Creator Social Handle + Copy Template.
- **Carousel mode:** Row 1: Batch Name + Primary Text. Row 2: (nothing else needed — no copy template in carousel mode).

So keep `grid-cols-2 gap-3` and the existing conditional rendering. Just remove the two deleted fields. The grid will naturally reflow.

### 6. Condense file card tags — make them a single tight row

In `src/components/FileCard.tsx`, make the tag dropdowns row more compact:

**Current bottom row:**
```tsx
<div className="flex flex-wrap gap-1.5">
  <select ... style={{ ...selectStyle, height: 30 }}>Product...</select>
  <select ... style={{ ...selectStyle, height: 30 }}>Type...</select>
  <input ... style={{ ...selectStyle, height: 30 }}>Hook / angle...</input>
</div>
```

**Change to:**
- Reduce `height` from 30 to 26
- Reduce `gap` from 1.5 to 1
- Reduce `min-w` from `min-w-[120px]` to `min-w-[100px]` for product and type selects
- Reduce hook/angle `min-w` from `min-w-[100px]` to `min-w-[80px]`
- Reduce font size from `text-xs` to `text-[11px]`
- Reduce padding from `px-2 py-1` to `px-1.5 py-0.5`

This makes each file card about 10px shorter overall.

### 7. Ensure carousel mode still works

The carousel-specific elements are NOT affected by these changes:
- ✅ "Carousel Ad" checkbox toggle — untouched
- ✅ "Primary Text" field — stays (carousel only)
- ✅ Per-card "Card Details" section (headline + description) — untouched
- ✅ Carousel per-card validation (headline required) — untouched
- ✅ `is_carousel` flag in submission insert — untouched
- ✅ File cards with product/type/hook tags — untouched
- ✅ `copy_body: batch.isCarousel ? batch.primaryText || null : null` — untouched

No carousel-specific code changes are needed.

### 8. Clean up unused state/interface

In `BatchFormData` interface, keep `creativeType` and `landingPageUrl` fields (they're still used for the submission insert — creativeType now derives from file tags, landingPageUrl sends null). Don't remove them from the interface.

In `createEmptyBatch`, keep the default values:
```tsx
creativeType: '',    // will be derived at submission time
landingPageUrl: '',  // will be null at submission time
```

## Files to modify

1. `src/components/SubmissionForm.tsx` — Remove Creative Type field, remove Landing Page URL field, remove validation for both, update submission to derive creative_type from file tags, tighten grid
2. `src/components/FileCard.tsx` — Reduce tag row sizing for more compact cards

## What NOT to change

- Don't modify the `submissions` or `submission_files` database tables
- Don't change the FileCard thumbnail logic
- Don't change the batch defaults bar
- Don't change the carousel per-card details section
- Don't change the file uploader component
- Don't change how `fileContexts` state works
- Don't remove `creativeType` or `landingPageUrl` from the TypeScript interfaces
- Don't change the Dropbox sync or notification logic
