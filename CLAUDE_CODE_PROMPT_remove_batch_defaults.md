# Claude Code Prompt: Remove Batch Defaults Bar & Clean Up File Cards

## Context

The upload form at `/upload` currently has a "Batch defaults" bar that appears when 2+ files are added. It has Product, Type, Copy template, Creator, and @handle fields plus an "Apply to all" button that pushes those defaults to every file card that doesn't already have a value set.

We're removing this entire section. Each file card already has its own Product, Type, Hook/Angle, Copy, Creator, and @handle fields — the batch defaults bar is redundant and confusing. Strategists should just fill in each card directly.

**Important:** The batch defaults bar contains a "Sync products from Shopify" button (the refresh icon next to the product dropdown). This functionality must be preserved — move it to a small sync button near the "Files" header so it's still accessible.

## Files to modify

1. `src/components/SubmissionForm.tsx`
2. `src/components/FileCard.tsx`

## Changes to `src/components/SubmissionForm.tsx`

### 1. Remove the `BatchDefaults` interface (lines 44-51)

Delete this entire interface:
```typescript
interface BatchDefaults {
  productId: string;
  productName: string;
  creativeType: string;
  copyTemplate: string;
  creatorName: string;
  creatorHandle: string;
}
```

### 2. Remove `tagDefaults` from `BatchFormState` (line 57)

Remove the `tagDefaults: BatchDefaults;` property from the `BatchFormState` interface.

### 3. Remove `tagDefaults` from `createEmptyBatch` (line 90)

Remove the line:
```typescript
tagDefaults: { productId: '', productName: '', creativeType: '', copyTemplate: '', creatorName: '', creatorHandle: '' },
```

### 4. Remove unused imports

Remove these icons from the lucide-react import since they were only used in the batch defaults bar or are no longer needed:
- `AtSign`
- `Users`

Keep `RefreshCw`, `Check` — they're used for the sync button we're relocating.

### 5. Delete the entire Batch Defaults Bar section (lines ~879-1079)

Delete everything between the comments `{/* ─── Batch Defaults Bar (2+ files only) ─── */}` and `{/* ─── File Cards with Inline Tags ─── */}`.

This is the entire block starting with:
```typescript
{batch.files.length >= 2 && (
  <div
    className="flex flex-wrap items-center gap-2.5 px-3.5 py-2 rounded-xl"
    ...
```

And ending with the closing `)}` of that conditional.

### 6. Add a sync button near the "Files" header

Right now there's a `Files` label and a file count near the top of each batch (around line 855-860). The area looks like:

```typescript
<p className="text-sm font-medium text-gray-200">Files</p>
<span className="text-xs text-gray-500">{batch.files.length} files selected</span>
```

Add a small sync products button next to this, something like:

```typescript
<div className="flex items-center gap-2 mb-1">
  <p className="text-sm font-medium text-gray-200">Files</p>
  <span className="text-xs text-gray-500">{batch.files.length} file{batch.files.length !== 1 ? 's' : ''} selected</span>
  <button
    type="button"
    onClick={handleSyncProducts}
    disabled={syncingProducts}
    title="Sync products from Shopify"
    className="ml-auto p-1 rounded-md transition-all hover:bg-[rgba(200,184,154,0.12)]"
    style={{ color: syncSuccess ? '#7FD48F' : '#C8B89A' }}
  >
    {syncSuccess ? (
      <Check className="w-3 h-3" />
    ) : (
      <RefreshCw className={`w-3 h-3 ${syncingProducts ? 'animate-spin' : ''}`} />
    )}
  </button>
</div>
```

Also, if `brandProducts.length <= 1`, show a small hint below the files header:
```typescript
{brandProducts.length <= 1 && (
  <p className="text-[11px] text-gray-500 italic mb-1">
    No products yet —{' '}
    <button
      type="button"
      onClick={handleSyncProducts}
      disabled={syncingProducts}
      className="text-[#C8B89A] hover:underline"
    >
      {syncingProducts ? 'syncing...' : 'sync from Shopify'}
    </button>
  </p>
)}
```

## Changes to `src/components/FileCard.tsx`

### 1. Clean up the card layout

The current FileCard has 3 rows:
- **Row 1**: Filename + meta + delete button
- **Row 2**: Product, Type, Hook/Angle, Copy (all inline with `flex-wrap gap-1`)
- **Row 3**: Creator name, @handle (separate row below)

Merge rows 2 and 3 into a single organized layout. Since we're now the only place to set these fields, they deserve slightly more breathing room.

Replace the current bottom rows (everything after the filename/meta/delete top row) with:

```tsx
{/* Tag row 1: Product + Type + Hook */}
<div className="flex flex-wrap gap-1.5">
  <select
    value={productId}
    onChange={(e) => {
      const pid = e.target.value;
      const pname = products.find((p) => p.shopify_product_id === pid)?.title || '';
      onProductChange(index, pid, pname);
    }}
    className="flex-1 min-w-[130px] max-w-[220px] px-2 py-1 rounded-md text-[11px] text-[#F5F5F8] focus:outline-none focus:border-[#C8B89A]/40 transition-all"
    style={{ ...selectStyle, height: 28 }}
  >
    <option value="">Product...</option>
    <ProductOptions products={products} />
  </select>

  <select
    value={creativeType}
    onChange={(e) => onCreativeTypeChange(index, e.target.value)}
    className="flex-1 min-w-[110px] max-w-[180px] px-2 py-1 rounded-md text-[11px] text-[#F5F5F8] focus:outline-none focus:border-[#C8B89A]/40 transition-all"
    style={{ ...selectStyle, height: 28 }}
  >
    <option value="">Type...</option>
    {CREATIVE_TYPE_GROUPS.map((group) => (
      <optgroup key={group.label} label={group.label}>
        {group.types.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </optgroup>
    ))}
  </select>

  <input
    type="text"
    placeholder="Hook / angle..."
    value={hookAngle}
    onChange={(e) => onHookAngleChange(index, e.target.value)}
    className="flex-1 min-w-[90px] max-w-[160px] px-2 py-1 rounded-md text-[11px] text-[#F5F5F8] placeholder-gray-600 focus:outline-none focus:border-[#C8B89A]/40 transition-all"
    style={{ ...selectStyle, height: 28 }}
  />
</div>

{/* Tag row 2: Copy + Creator + Handle */}
<div className="flex flex-wrap gap-1.5">
  {!isCarousel && (
    <select
      value={copyTemplate}
      onChange={(e) => onCopyTemplateChange(index, e.target.value)}
      className="flex-1 min-w-[110px] max-w-[180px] px-2 py-1 rounded-md text-[11px] text-[#F5F5F8] focus:outline-none focus:border-[#C8B89A]/40 transition-all"
      style={{ ...selectStyle, height: 28 }}
    >
      <option value="">Copy...</option>
      {copyTemplateOptions.map((tpl) => (
        <option key={tpl.id} value={tpl.title}>
          {tpl.title}
        </option>
      ))}
    </select>
  )}

  <input
    type="text"
    placeholder="Creator name..."
    value={creatorName}
    onChange={(e) => onCreatorNameChange(index, e.target.value)}
    className="flex-1 min-w-[110px] max-w-[180px] px-2 py-1 rounded-md text-[11px] text-[#F5F5F8] placeholder-gray-600 focus:outline-none focus:border-[#C8B89A]/40 transition-all"
    style={{ ...selectStyle, height: 28 }}
  />

  {isWhitelist && (
    <input
      type="text"
      placeholder="@handle"
      value={creatorHandle}
      onChange={(e) => onCreatorHandleChange(index, e.target.value)}
      className="flex-1 min-w-[100px] max-w-[150px] px-2 py-1 rounded-md text-[11px] text-[#F5F5F8] placeholder-gray-600 focus:outline-none focus:border-[#C8B89A]/40 transition-all"
      style={{ ...selectStyle, height: 28 }}
    />
  )}
</div>
```

Key changes from the current layout:
- Slightly larger height (28px instead of 26px) for better touch targets
- `gap-1.5` instead of `gap-1` for breathing room
- `max-w` constraints on each field to prevent any single one from stretching too wide
- `px-2 py-1` instead of `px-1.5 py-0.5` for slightly more padding
- Copy template and Creator are now on the same row (row 2) since they're both "context about the creative" vs row 1 which is "what is this creative"
- Creator name always shows (not just for whitelist) — it's useful metadata regardless

### 2. Update the container

Change the main container div gap from `gap-2` to `gap-2.5` for slightly more vertical spacing between the tag rows:

```tsx
<div className="flex-1 min-w-0 flex flex-col gap-2.5">
```

## What NOT to change

- Don't modify any database tables or columns
- Don't change the `handleSubmit` logic — it already reads everything from `fileContexts` per-file
- Don't change `validateBatch` — it already validates per-file
- Don't change the batch-level derivation logic in handleSubmit (the most-common-value pattern for creator_name, copy_title, etc. on the submissions table)
- Don't change `FileUploader`, `creative-types.ts`, or any other files
- Don't change the carousel per-card details section
- Don't remove the `handleSyncProducts` function or `syncingProducts`/`syncSuccess` state — just relocate the button

## Verification

After changes:
1. The batch defaults bar and "Apply to all" button should be completely gone
2. Each file card should still have: Product, Type, Hook/Angle, Copy (non-carousel), Creator name, @handle (whitelist only)
3. The sync products button should appear near the "Files" header
4. The form should still submit correctly with per-file tags
5. No TypeScript errors — the `BatchDefaults` interface and `tagDefaults` should be fully removed from all references
