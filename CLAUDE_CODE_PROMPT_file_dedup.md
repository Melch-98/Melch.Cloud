# Claude Code Prompt: File De-Duplication on Upload

## Context

The upload form at `/upload` needs to detect duplicate files in two places:

1. **Same batch**: If the strategist drops the same file twice into the same batch, warn them immediately
2. **Already submitted**: If the file name matches a file already in `submission_files` for this brand, warn them it's already been uploaded (show which batch it came from)

This should NOT block the upload — just show a warning badge on the FileCard so the strategist can decide to remove it or keep it. Sometimes re-uploading is intentional (re-cut of same filename, etc.).

## Files to modify

1. `src/components/SubmissionForm.tsx` — fetch existing filenames, detect dupes, pass warnings to FileCard
2. `src/components/FileCard.tsx` — display duplicate warning badge

## Changes to `src/components/SubmissionForm.tsx`

### 1. Add state for existing filenames

Add a new state variable to hold all previously submitted file names for the selected brand:

```typescript
const [existingFiles, setExistingFiles] = useState<Map<string, string>>(new Map());
// Map<file_name, batch_name>
```

### 2. Fetch existing filenames when brand is selected

Add a new `useEffect` that fetches all submitted file names for the brand. This runs once when `selectedBrandId` changes (alongside the existing product fetch):

```typescript
// Fetch existing filenames for duplicate detection
useEffect(() => {
  const fetchExistingFiles = async () => {
    if (!selectedBrandId) {
      setExistingFiles(new Map());
      return;
    }
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const { data: files } = await supabase
        .from('submission_files')
        .select('file_name, submissions!inner(batch_name, brand_id)')
        .eq('submissions.brand_id', selectedBrandId);

      const map = new Map<string, string>();
      if (files) {
        for (const f of files) {
          // Store the first batch_name we find for each filename
          const batchName = (f as any).submissions?.batch_name || 'unknown batch';
          if (!map.has(f.file_name)) {
            map.set(f.file_name, batchName);
          }
        }
      }
      setExistingFiles(map);
    } catch (err) {
      console.error('Failed to fetch existing files:', err);
    }
  };
  fetchExistingFiles();
}, [selectedBrandId]);
```

### 3. Compute duplicate warnings per file

Add a `useMemo` that computes duplicate warnings for every file in every batch:

```typescript
// Compute duplicate warnings for each file
const fileDupeWarnings = useMemo(() => {
  const warnings: Record<string, Record<number, string>> = {}; // batchId -> { fileIndex -> warning }

  for (const batch of batches) {
    const batchWarnings: Record<number, string> = {};
    const seenInBatch = new Map<string, number>(); // filename -> first index

    for (let i = 0; i < batch.files.length; i++) {
      const name = batch.files[i].name;

      // Check same-batch duplicate
      if (seenInBatch.has(name)) {
        batchWarnings[i] = `Duplicate in this batch`;
        // Also mark the first occurrence if not already marked
        const firstIdx = seenInBatch.get(name)!;
        if (!batchWarnings[firstIdx]) {
          batchWarnings[firstIdx] = `Duplicate in this batch`;
        }
      } else {
        seenInBatch.set(name, i);
      }

      // Check archive duplicate (only if not already flagged as same-batch dupe)
      if (!batchWarnings[i] && existingFiles.has(name)) {
        const priorBatch = existingFiles.get(name)!;
        batchWarnings[i] = `Already uploaded in ${priorBatch}`;
      }
    }

    warnings[batch.id] = batchWarnings;
  }
  return warnings;
}, [batches, existingFiles]);
```

### 4. Pass the warning to each FileCard

In the FileCard rendering section (where `batch.files.map(...)` is), add a new `dupeWarning` prop:

```typescript
<FileCard
  key={`${file.name}-${fileIndex}`}
  file={file}
  index={fileIndex}
  dupeWarning={fileDupeWarnings[batch.id]?.[fileIndex] || ''}
  // ... rest of existing props
/>
```

### 5. Update imports

Add `AlertTriangle` to the lucide-react imports if not already present (it may already be imported — check first and skip if so).

## Changes to `src/components/FileCard.tsx`

### 1. Add `dupeWarning` to FileCardProps

```typescript
interface FileCardProps {
  // ... existing props ...
  dupeWarning?: string;
}
```

And destructure it in the component:
```typescript
const FileCard: React.FC<FileCardProps> = ({
  // ... existing props ...
  dupeWarning = '',
}) => {
```

### 2. Add `AlertTriangle` import

Add to the lucide-react import:
```typescript
import { X, Play, AlertTriangle } from 'lucide-react';
```

### 3. Show warning badge

Add a warning row between the filename/meta row and the tag rows. Only show when `dupeWarning` is non-empty:

```tsx
{/* Duplicate warning */}
{dupeWarning && (
  <div
    className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px]"
    style={{
      backgroundColor: 'rgba(234,179,8,0.08)',
      border: '1px solid rgba(234,179,8,0.15)',
      color: '#EAB308',
    }}
  >
    <AlertTriangle className="w-3 h-3 flex-shrink-0" />
    <span>{dupeWarning}</span>
  </div>
)}
```

Place this inside the content area `<div className="flex-1 min-w-0 flex flex-col gap-2.5">`, right after the top row (filename + meta + delete) and before the tag rows.

### 4. Subtle border highlight for dupes

Optionally, add a subtle amber border to the card when it's a duplicate. Update the card container's style:

```tsx
<div
  className="flex flex-wrap gap-3 p-3 rounded-xl transition-colors"
  style={{
    backgroundColor: dupeWarning ? 'rgba(234,179,8,0.03)' : 'rgba(255,255,255,0.03)',
    border: dupeWarning
      ? '0.5px solid rgba(234,179,8,0.2)'
      : '0.5px solid rgba(255,255,255,0.08)',
  }}
>
```

## What NOT to change

- Don't block uploads — duplicates are warnings only, not errors
- Don't modify `validateBatch` — duplicates should NOT prevent submission
- Don't modify `handleSubmit` or any insert logic
- Don't modify `FileUploader.tsx` — detection happens after files are in state, not during the drop
- Don't create any new database tables or columns
- Don't add any API routes — query Supabase directly from the client

## Performance notes

- The existing files query runs once per brand selection, not per file drop — it's lightweight
- The `useMemo` recomputes whenever `batches` or `existingFiles` changes, which is fine since it's just string comparisons
- For brands with thousands of files, the query might return a lot of rows. If this becomes a problem later, we can limit to the last 90 days. For now, fetch all.

## Verification

After changes:
1. Drop the same file twice into one batch → both cards show "Duplicate in this batch" in amber
2. Drop a file that was already submitted (e.g., one of the TLW files already in the system) → card shows "Already uploaded in TLW_260530_0001" in amber
3. Duplicates should NOT block submission — just visual warnings
4. Warning should disappear if the file is removed
5. No TypeScript errors
