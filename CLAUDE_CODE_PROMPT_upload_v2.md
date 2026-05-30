# Claude Code Prompt: Fix Product Dropdown, Fix Overlap, Move Copy Template Per-File

## Context

Three issues with the upload form at `src/components/SubmissionForm.tsx` and `src/components/FileCard.tsx`:

1. **Product dropdown is empty** — The direct Supabase query works correctly, but the browser client's session isn't loaded from cookies before the query fires. The `createBrowserClient` from `@supabase/ssr` needs `getSession()` called first to load auth cookies into memory.

2. **Batch defaults bar overlap** — The "Product..." and "Type..." dropdowns in the batch defaults bar overlap each other on narrow viewports because both use `flex-1`.

3. **Copy template should be per-file** — Currently the copy template is a batch-level field. It should move to the per-file FileCard (alongside product, type, hook/angle). The `submission_files` table already has a `copy_title` column, so no database changes needed.

---

## Change 1: Fix product dropdown — add getSession() before query

### In `src/components/SubmissionForm.tsx` — the fetchProducts useEffect (~line 236)

**Current code:**
```typescript
useEffect(() => {
    const fetchProducts = async () => {
      if (!selectedBrandId) {
        setBrandProducts([]);
        return;
      }
      try {
        const supabase = createClient();
        const { data: products, error } = await supabase
```

**Replace with:**
```typescript
useEffect(() => {
    const fetchProducts = async () => {
      if (!selectedBrandId) {
        setBrandProducts([]);
        return;
      }
      try {
        const supabase = createClient();
        // Must load session from cookies before making authenticated queries
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;

        const { data: products, error } = await supabase
```

Everything else in the useEffect stays the same. Just add those two lines between `createClient()` and the `.from()` query.

### In the handleSyncProducts callback (~line 207, the refresh portion)

The refresh query after syncing also needs this. Find the refresh block:

**Current code:**
```typescript
      // Refresh the product list directly from Supabase
      const refreshSupabase = createClient();
      const { data: refreshedProducts } = await refreshSupabase
```

**Replace with:**
```typescript
      // Refresh the product list directly from Supabase
      const refreshSupabase = createClient();
      await refreshSupabase.auth.getSession(); // ensure auth loaded

      const { data: refreshedProducts } = await refreshSupabase
```

---

## Change 2: Fix batch defaults bar overlap

### In `src/components/SubmissionForm.tsx` — the batch defaults bar (~line 912)

The bar uses `flex flex-wrap` with both dropdowns having `flex-1 min-w-[120px]`. Fix the layout so they don't overlap.

**Current product select wrapper (~line 925):**
```tsx
<div className="flex items-center gap-1 flex-1 min-w-[120px]">
```

**Replace with:**
```tsx
<div className="flex items-center gap-1 flex-1 min-w-[140px] max-w-[250px]">
```

**Current type select (~line 991):**
```tsx
<select
  value={batch.tagDefaults.creativeType}
  onChange={(e) =>
    updateBatch(batch.id, {
      tagDefaults: { ...batch.tagDefaults, creativeType: e.target.value },
    })
  }
  className="flex-1 min-w-[120px] px-2.5 py-1.5 rounded-lg text-[13px] text-[#F5F5F8] focus:outline-none focus:border-[#C8B89A]/40 transition-all"
  style={inputStyle}
>
```

**Replace with:**
```tsx
<select
  value={batch.tagDefaults.creativeType}
  onChange={(e) =>
    updateBatch(batch.id, {
      tagDefaults: { ...batch.tagDefaults, creativeType: e.target.value },
    })
  }
  className="flex-1 min-w-[110px] max-w-[180px] px-2.5 py-1.5 rounded-lg text-[13px] text-[#F5F5F8] focus:outline-none focus:border-[#C8B89A]/40 transition-all"
  style={inputStyle}
>
```

Also add a copy template select to the batch defaults bar. After the creative type `</select>` and before the "Apply to all" button, add a new copy template select for batch defaults:

```tsx
{!batch.isCarousel && (
  <select
    value={batch.tagDefaults.copyTemplate || ''}
    onChange={(e) =>
      updateBatch(batch.id, {
        tagDefaults: { ...batch.tagDefaults, copyTemplate: e.target.value },
      })
    }
    className="flex-1 min-w-[120px] max-w-[200px] px-2.5 py-1.5 rounded-lg text-[13px] text-[#F5F5F8] focus:outline-none focus:border-[#C8B89A]/40 transition-all"
    style={inputStyle}
  >
    <option value="">Copy template...</option>
    {copyTemplateOptions.map((tpl) => (
      <option key={tpl.id} value={tpl.title}>
        {tpl.title}
      </option>
    ))}
  </select>
)}
```

### Update the BatchDefaults interface to include copyTemplate

**Current (~line 44):**
```typescript
interface BatchDefaults {
  productId: string;
  productName: string;
  creativeType: string;
}
```

**Replace with:**
```typescript
interface BatchDefaults {
  productId: string;
  productName: string;
  creativeType: string;
  copyTemplate: string;
}
```

### Update createEmptyBatch tagDefaults to include copyTemplate

In `createEmptyBatch` (~line 70), the `tagDefaults` object needs the new field:

**Current:**
```typescript
tagDefaults: { productId: '', productName: '', creativeType: '' },
```

**Replace with:**
```typescript
tagDefaults: { productId: '', productName: '', creativeType: '', copyTemplate: '' },
```

### Update the "Apply to all" button logic to include copyTemplate

In the Apply to all button's onClick handler (~line 1013), update the condition and apply logic:

**Current:**
```typescript
onClick={() => {
  const d = batch.tagDefaults;
  if (!d.productId && !d.creativeType) return;
  const updated = { ...batch.fileContexts };
  for (let i = 0; i < batch.files.length; i++) {
    const existing = updated[i] || {} as any;
    if (d.productId && !existing.productId) {
      existing.productId = d.productId;
      existing.productName = d.productName;
    }
    if (d.creativeType && !existing.creativeType) {
      existing.creativeType = d.creativeType;
    }
    updated[i] = existing;
  }
  updateBatch(batch.id, { fileContexts: updated });
}}
```

**Replace with:**
```typescript
onClick={() => {
  const d = batch.tagDefaults;
  if (!d.productId && !d.creativeType && !d.copyTemplate) return;
  const updated = { ...batch.fileContexts };
  for (let i = 0; i < batch.files.length; i++) {
    const existing = updated[i] || {} as any;
    if (d.productId && !existing.productId) {
      existing.productId = d.productId;
      existing.productName = d.productName;
    }
    if (d.creativeType && !existing.creativeType) {
      existing.creativeType = d.creativeType;
    }
    if (d.copyTemplate && !existing.copyTemplate) {
      existing.copyTemplate = d.copyTemplate;
    }
    updated[i] = existing;
  }
  updateBatch(batch.id, { fileContexts: updated });
}}
```

---

## Change 3: Move copy template from batch-level to per-file

### 3a. Remove the batch-level Copy Template field from the form

Delete the entire "Copy Template to Use" `<Field>` block in the form fields section (~lines 835-867):

```tsx
// DELETE THIS ENTIRE BLOCK:
{!batch.isCarousel && (
  <Field label="Copy Template to Use">
    {copyTemplateOptions.length > 0 ? (
      <select
        value={batch.copyTemplate}
        onChange={(e) =>
          updateBatch(batch.id, { copyTemplate: e.target.value })
        }
        className={`${selectClass} ${inputFocusStyle}`}
        style={inputStyle}
      >
        <option value="">Select a template…</option>
        {copyTemplateOptions.map((tpl) => (
          <option key={tpl.id} value={tpl.title}>
            {tpl.title}
          </option>
        ))}
      </select>
    ) : (
      <input
        type="text"
        value={batch.copyTemplate}
        onChange={(e) =>
          updateBatch(batch.id, { copyTemplate: e.target.value })
        }
        className={`${inputClass} ${inputFocusStyle}`}
        style={inputStyle}
        placeholder="No templates yet — type a name"
      />
    )}
  </Field>
)}
```

### 3b. Add copyTemplate to FileCard props and rendering

**In `src/components/FileCard.tsx`:**

Update the `FileCardProps` interface to add copy template fields:

**Current:**
```typescript
interface FileCardProps {
  file: File;
  index: number;
  mediaInfo?: FileMediaInfo;
  productId: string;
  productName: string;
  creativeType: string;
  hookAngle: string;
  products: Product[];
  onRemove: (index: number) => void;
  onProductChange: (index: number, productId: string, productName: string) => void;
  onCreativeTypeChange: (index: number, value: string) => void;
  onHookAngleChange: (index: number, value: string) => void;
}
```

**Replace with:**
```typescript
interface CopyTemplateOption {
  id: string;
  title: string;
}

interface FileCardProps {
  file: File;
  index: number;
  mediaInfo?: FileMediaInfo;
  productId: string;
  productName: string;
  creativeType: string;
  hookAngle: string;
  copyTemplate: string;
  products: Product[];
  copyTemplateOptions: CopyTemplateOption[];
  isCarousel: boolean;
  onRemove: (index: number) => void;
  onProductChange: (index: number, productId: string, productName: string) => void;
  onCreativeTypeChange: (index: number, value: string) => void;
  onHookAngleChange: (index: number, value: string) => void;
  onCopyTemplateChange: (index: number, value: string) => void;
}
```

Update the component destructuring to include the new props:

**Current:**
```typescript
const FileCard: React.FC<FileCardProps> = ({
  file,
  index,
  mediaInfo,
  productId,
  productName,
  creativeType,
  hookAngle,
  products,
  onRemove,
  onProductChange,
  onCreativeTypeChange,
  onHookAngleChange,
}) => {
```

**Replace with:**
```typescript
const FileCard: React.FC<FileCardProps> = ({
  file,
  index,
  mediaInfo,
  productId,
  productName,
  creativeType,
  hookAngle,
  copyTemplate,
  products,
  copyTemplateOptions,
  isCarousel,
  onRemove,
  onProductChange,
  onCreativeTypeChange,
  onHookAngleChange,
  onCopyTemplateChange,
}) => {
```

In the bottom tag row, after the hook/angle `<input>` and before the closing `</div>` of the flex wrapper, add a copy template select (only when not carousel):

**After the hook/angle input (line ~298), before `</div>`:**

```tsx
{!isCarousel && (
  <select
    value={copyTemplate}
    onChange={(e) => onCopyTemplateChange(index, e.target.value)}
    className="flex-1 min-w-[100px] px-1.5 py-0.5 rounded-md text-[11px] text-[#F5F5F8] focus:outline-none focus:border-[#C8B89A]/40 transition-all"
    style={{ ...selectStyle, height: 26 }}
  >
    <option value="">Copy...</option>
    {copyTemplateOptions.map((tpl) => (
      <option key={tpl.id} value={tpl.title}>
        {tpl.title}
      </option>
    ))}
  </select>
)}
```

### 3c. Pass copyTemplate props from SubmissionForm to FileCard

In `src/components/SubmissionForm.tsx`, update the `<FileCard>` rendering (~line 1062) to pass the new props:

**Current:**
```tsx
<FileCard
  key={`${file.name}-${fileIndex}`}
  file={file}
  index={fileIndex}
  mediaInfo={batch.fileMediaInfo[fileIndex]}
  productId={(batch.fileContexts[fileIndex] as any)?.productId || ''}
  productName={(batch.fileContexts[fileIndex] as any)?.productName || ''}
  creativeType={(batch.fileContexts[fileIndex] as any)?.creativeType || ''}
  hookAngle={(batch.fileContexts[fileIndex] as any)?.hookAngle || ''}
  products={brandProducts}
```

**Replace with:**
```tsx
<FileCard
  key={`${file.name}-${fileIndex}`}
  file={file}
  index={fileIndex}
  mediaInfo={batch.fileMediaInfo[fileIndex]}
  productId={(batch.fileContexts[fileIndex] as any)?.productId || ''}
  productName={(batch.fileContexts[fileIndex] as any)?.productName || ''}
  creativeType={(batch.fileContexts[fileIndex] as any)?.creativeType || ''}
  hookAngle={(batch.fileContexts[fileIndex] as any)?.hookAngle || ''}
  copyTemplate={(batch.fileContexts[fileIndex] as any)?.copyTemplate || ''}
  products={brandProducts}
  copyTemplateOptions={copyTemplateOptions}
  isCarousel={batch.isCarousel}
```

After the existing `onHookAngleChange` handler, add the `onCopyTemplateChange` handler:

```tsx
onCopyTemplateChange={(idx, val) => {
  const context = batch.fileContexts[idx] || {} as any;
  updateBatch(batch.id, {
    fileContexts: {
      ...batch.fileContexts,
      [idx]: { ...context, copyTemplate: val },
    },
  });
}}
```

### 3d. Update submission insert to write copy_title per-file

In the `handleSubmit` function, update the `submission_files` insert (~line 513) to include `copy_title`:

**Current file insert object:**
```typescript
const { error: fileError } = await supabase.from('submission_files').insert({
  submission_id: submission.id,
  file_name: batch.files[i].name,
  file_type: batch.files[i].type || 'application/octet-stream',
  file_size: batch.files[i].size || 0,
  file_url: uploadedFiles[i].path,
  media_format: mediaInfo?.format || null,
  aspect_ratio: mediaInfo?.aspectRatio || null,
  width: mediaInfo?.width || null,
  height: mediaInfo?.height || null,
  landing_page_url: fileContext?.landingPageUrl || null,
  copy_headline: fileContext?.copyHeadline || null,
  copy_body: fileContext?.copyBody || null,
  copy_cta: fileContext?.copyCta || null,
  product_id: (fileContext as any)?.productId || null,
  product_name: (fileContext as any)?.productName || null,
  creative_type: (fileContext as any)?.creativeType || null,
  fidelity: (fileContext as any)?.creativeType
    ? (CREATIVE_TYPES_MAP.get((fileContext as any).creativeType)?.fidelity ?? null)
    : null,
  hook_angle: (fileContext as any)?.hookAngle || null,
});
```

**Add this line after `hook_angle`:**
```typescript
  copy_title: (fileContext as any)?.copyTemplate || null,
```

### 3e. Derive batch-level copy_title from per-file values

In the `submissions` insert object (~line 472), update `copy_title` to derive from file-level values instead of `batch.copyTemplate`:

**Current:**
```typescript
copy_title: batch.copyTemplate || null,
```

**Replace with:**
```typescript
copy_title: (() => {
  // Derive from per-file copy templates — use the most common, or null
  const templates = Object.values(batch.fileContexts)
    .map((c: any) => c?.copyTemplate)
    .filter(Boolean);
  if (templates.length === 0) return null;
  const counts: Record<string, number> = {};
  for (const t of templates) counts[t] = (counts[t] || 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
})(),
```

---

## Files to modify

1. `src/components/SubmissionForm.tsx` — Fix product auth, fix batch defaults overlap, add copy template to batch defaults + apply-to-all, remove batch-level copy template field, pass new props to FileCard, update submission insert
2. `src/components/FileCard.tsx` — Add copyTemplate prop + select dropdown

## What NOT to change

- Don't modify the `submissions` or `submission_files` database tables (both already have the needed columns)
- Don't change the FileCard thumbnail logic
- Don't change the carousel per-card details section (headline + description)
- Don't change the file uploader component
- Don't change the Dropbox sync or notification logic
- Don't change the ad-lab page (it still assigns copy_title at batch level — that's fine)
- Don't change the submissions page or admin page displays
- Don't change the export route
- Don't remove `copyTemplate` or `landingPageUrl` from the BatchFormData interface
- Don't change the `/api/copy-templates` or `/api/sync-products` or `/api/brand-products` routes
