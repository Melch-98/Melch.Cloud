'use client';

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  AlertCircle,
  CheckCircle,
  Loader,
  Plus,
  Trash2,
  Upload,
  Package,
  Layers,
  Shuffle,
  Users,
  Copy,
  Check,
  RefreshCw,
  FileText,
  X,
} from 'lucide-react';
import FileUploader, { FileMediaInfo } from './FileUploader';
import AssetThumbnail from './AssetThumbnail';
import AssetDetailPanel from './AssetDetailPanel';
import CreativeMatrixSummary from './CreativeMatrixSummary';
import { createClient } from '@/lib/supabase';
import { FileContext } from '@/lib/types';
import { CREATIVE_TYPES_MAP } from '@/lib/creative-types';

export interface BatchFormData {
  batchName: string;
  creativeType: string;
  creatorName: string;
  landingPageUrl: string;
  copyTemplate: string;
  primaryText: string;
  files: File[];
  isCarousel: boolean;
  isFlexible: boolean;
  isWhitelist: boolean;
  creatorSocialHandle: string;
  fileContexts: Record<number, FileContext>;
  fileMediaInfo: Record<number, FileMediaInfo>;
}

interface BatchFormState extends BatchFormData {
  id: string;
  /** UI-only: primary text variation cards. Joined into primaryText on change. */
  primaryVariations: string[];
  errors: Record<string, string>;
}

interface Brand {
  id: string;
  name: string;
  slug: string;
}

interface SubmissionFormProps {
  brands: Brand[];
  selectedBrandId?: string;
  onSubmit?: (data: BatchFormState[]) => void;
  isLoading?: boolean;
}

const createEmptyBatch = (batchName: string): BatchFormState => ({
  id: `batch-${Date.now()}-${Math.random()}`,
  batchName,
  creativeType: '',
  creatorName: '',
  landingPageUrl: '',
  copyTemplate: '',
  primaryText: '',
  primaryVariations: [''],
  files: [],
  isCarousel: false,
  isFlexible: false,
  isWhitelist: false,
  creatorSocialHandle: '',
  fileContexts: {},
  fileMediaInfo: {},
  errors: {},
});

const CopyButton: React.FC<{ text: string }> = ({ text }) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };
  return (
    <button
      type="button"
      onClick={handleCopy}
      title={copied ? 'Copied!' : 'Copy batch name'}
      className="shrink-0 p-1 rounded-md hover:bg-[rgba(200,184,154,0.12)] transition-colors"
      style={{ color: copied ? '#7FD48F' : '#C8B89A' }}
    >
      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
};

const inputClass =
  'w-full px-3.5 py-2.5 rounded-lg text-sm text-[#F5F5F8] placeholder-gray-600 focus:outline-none transition-all focus:border-[#C8B89A]/40';

const inputStyle: React.CSSProperties = {
  backgroundColor: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.08)',
};

const sectionLabelClass =
  'text-xs font-medium text-gray-500 uppercase tracking-wider mb-2 block';

const cardStyle: React.CSSProperties = {
  backgroundColor: '#111111',
  border: '1px solid rgba(255,255,255,0.06)',
};

interface CopyTemplateOption {
  id: string;
  title: string;
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return (bytes / Math.pow(k, i)).toFixed(1) + ' ' + sizes[i];
}

/** Remap an index-keyed record after files are reordered.
 *  mapping[newIndex] = oldIndex */
function remapRecord<T>(rec: Record<number, T>, mapping: number[]): Record<number, T> {
  const out: Record<number, T> = {};
  mapping.forEach((oldIdx, newIdx) => {
    if (rec[oldIdx] !== undefined) out[newIdx] = rec[oldIdx];
  });
  return out;
}

const SubmissionForm: React.FC<SubmissionFormProps> = ({
  brands,
  selectedBrandId,
  onSubmit,
  isLoading = false,
}) => {
  const [batches, setBatches] = useState<BatchFormState[]>([]);
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null);
  // Track batch IDs that successfully committed during this form session,
  // so that if a later batch fails, retrying the submit skips already-saved
  // batches instead of re-uploading and creating duplicates.
  const [savedBatchIds, setSavedBatchIds] = useState<Set<string>>(new Set());
  const [submitMessage, setSubmitMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [copyTemplateOptions, setCopyTemplateOptions] = useState<CopyTemplateOption[]>([]);
  const [brandProducts, setBrandProducts] = useState<
    { shopify_product_id: string; title: string; product_type: string; handle: string }[]
  >([]);
  const [syncingProducts, setSyncingProducts] = useState(false);
  const [syncSuccess, setSyncSuccess] = useState(false);
  const [existingFiles, setExistingFiles] = useState<Map<string, string>>(new Map());
  // Map<file_name, batch_name>

  // Asset selection within the active batch
  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const activeBatch = useMemo(
    () => batches.find((b) => b.id === activeBatchId) || batches[0] || null,
    [batches, activeBatchId]
  );

  // Reset selection when the active batch changes
  useEffect(() => {
    setSelectedIndices([]);
  }, [activeBatchId]);

  // Clamp selection when files change
  useEffect(() => {
    if (!activeBatch) return;
    setSelectedIndices((prev) => prev.filter((i) => i < activeBatch.files.length));
  }, [activeBatch]);

  const handleSyncProducts = useCallback(async () => {
    if (!selectedBrandId || syncingProducts) return;
    setSyncingProducts(true);
    setSyncSuccess(false);
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      await fetch('/api/sync-products', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ brand_id: selectedBrandId }),
      });

      // Refresh the product list directly from Supabase
      const refreshSupabase = createClient();
      await refreshSupabase.auth.getSession(); // ensure auth loaded

      const { data: refreshedProducts } = await refreshSupabase
        .from('shopify_products')
        .select('shopify_product_id, title, product_type, handle')
        .eq('brand_id', selectedBrandId)
        .eq('status', 'active')
        .order('product_type')
        .order('title');

      const refreshedResult = [
        { shopify_product_id: '__brand_general__', title: 'Brand / General', product_type: '', handle: '' },
        ...(refreshedProducts || []).map((p: any) => ({
          shopify_product_id: String(p.shopify_product_id),
          title: p.title,
          product_type: p.product_type || '',
          handle: p.handle || '',
        })),
      ];
      setBrandProducts(refreshedResult);

      setSyncSuccess(true);
      setTimeout(() => setSyncSuccess(false), 2000);
    } catch (err) {
      console.error('Product sync failed:', err);
    } finally {
      setSyncingProducts(false);
    }
  }, [selectedBrandId, syncingProducts]);

  // Fetch brand products for tagging dropdowns
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
          .from('shopify_products')
          .select('shopify_product_id, title, product_type, handle')
          .eq('brand_id', selectedBrandId)
          .eq('status', 'active')
          .order('product_type')
          .order('title');

        if (error) {
          console.error('Product fetch error:', error);
          return;
        }

        const result = [
          { shopify_product_id: '__brand_general__', title: 'Brand / General', product_type: '', handle: '' },
          ...(products || []).map((p: any) => ({
            shopify_product_id: String(p.shopify_product_id),
            title: p.title,
            product_type: p.product_type || '',
            handle: p.handle || '',
          })),
        ];
        setBrandProducts(result);
      } catch (err) {
        console.error('Product fetch failed:', err);
      }
    };
    fetchProducts();
  }, [selectedBrandId]);

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

  // Fetch copy template options for the brand
  useEffect(() => {
    const fetchCopyTemplates = async () => {
      if (!selectedBrandId) {
        setCopyTemplateOptions([]);
        return;
      }
      try {
        const supabase = createClient();
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const res = await fetch(`/api/copy-templates?brand_id=${selectedBrandId}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (res.ok) {
          const json = await res.json();
          setCopyTemplateOptions(
            (json.templates || []).map((t: { id: string; title: string }) => ({
              id: t.id,
              title: t.title,
            }))
          );
        }
      } catch {
        // silently fail — templates are optional
      }
    };
    fetchCopyTemplates();
  }, [selectedBrandId]);

  // Fetch a batch name from the server. `reserved` holds names already claimed
  // in this form session so the API skips those sequence numbers.
  const fetchBatchName = useCallback(async (reserved: string[] = []): Promise<string> => {
    if (!selectedBrandId) return 'XXX_000000_0001';
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return 'XXX_000000_0001';
    const res = await fetch('/api/batch-name', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ brand_id: selectedBrandId, reserved }),
    });
    if (!res.ok) return 'XXX_000000_0001';
    const json = await res.json();
    return json.batch_name;
  }, [selectedBrandId]);

  // Initialize first batch on mount / brand change
  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      if (!selectedBrandId) return;
      const name = await fetchBatchName();
      if (!cancelled) {
        const batch = createEmptyBatch(name);
        setBatches([batch]);
        setActiveBatchId(batch.id);
      }
    };
    init();
    return () => { cancelled = true; };
  }, [selectedBrandId, fetchBatchName]);

  // Auto-dismiss success messages
  useEffect(() => {
    if (submitMessage?.type === 'success') {
      const timer = setTimeout(() => setSubmitMessage(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [submitMessage]);

  const updateBatch = useCallback(
    (id: string, updates: Partial<BatchFormState>) => {
      setBatches((prev) =>
        prev.map((batch) =>
          batch.id === id ? { ...batch, ...updates, errors: {} } : batch
        )
      );
    },
    []
  );

  /** Apply a partial FileContext update to a set of file indices in a batch */
  const updateFileContexts = useCallback(
    (batchId: string, indices: number[], updates: Partial<FileContext>) => {
      setBatches((prev) =>
        prev.map((b) => {
          if (b.id !== batchId) return b;
          const contexts = { ...b.fileContexts };
          for (const i of indices) {
            contexts[i] = { ...(contexts[i] || {}), ...updates } as FileContext;
          }
          return { ...b, fileContexts: contexts, errors: {} };
        })
      );
    },
    []
  );

  const removeBatch = useCallback((id: string) => {
    setBatches((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.filter((batch) => batch.id !== id);
      setActiveBatchId((cur) => (cur === id ? next[0]?.id ?? null : cur));
      return next;
    });
  }, []);

  const addBatch = useCallback(async () => {
    // Pass current form batch names as reserved so the API skips them
    const reserved = batches.map((b) => b.batchName);
    const name = await fetchBatchName(reserved);
    const batch = createEmptyBatch(name);
    setBatches((prev) => [...prev, batch]);
    setActiveBatchId(batch.id);
  }, [batches, fetchBatchName]);

  /** Reorder files inside a batch (drag-and-drop in the asset grid) */
  const moveFile = useCallback((batchId: string, from: number, to: number) => {
    if (from === to) return;
    setBatches((prev) =>
      prev.map((b) => {
        if (b.id !== batchId) return b;
        const order = b.files.map((_, i) => i);
        const [moved] = order.splice(from, 1);
        order.splice(to, 0, moved);
        return {
          ...b,
          files: order.map((i) => b.files[i]),
          fileContexts: remapRecord(b.fileContexts, order),
          fileMediaInfo: remapRecord(b.fileMediaInfo, order),
        };
      })
    );
    setSelectedIndices([]);
  }, []);

  /** Remove a file and re-index contexts/media info */
  const removeFile = useCallback((batchId: string, index: number) => {
    setBatches((prev) =>
      prev.map((b) => {
        if (b.id !== batchId) return b;
        const order = b.files.map((_, i) => i).filter((i) => i !== index);
        return {
          ...b,
          files: order.map((i) => b.files[i]),
          fileContexts: remapRecord(b.fileContexts, order),
          fileMediaInfo: remapRecord(b.fileMediaInfo, order),
        };
      })
    );
    setSelectedIndices((prev) =>
      prev.filter((i) => i !== index).map((i) => (i > index ? i - 1 : i))
    );
  }, []);

  const handleAssetClick = useCallback((index: number, shiftKey: boolean) => {
    setSelectedIndices((prev) => {
      if (shiftKey) {
        // Multi-select toggle
        return prev.includes(index)
          ? prev.filter((i) => i !== index)
          : [...prev, index];
      }
      // Single select — clicking the only selected asset deselects
      if (prev.length === 1 && prev[0] === index) return [];
      return [index];
    });
  }, []);

  const validateBatch = (batch: BatchFormState): boolean => {
    const errors: Record<string, string> = {};

    if (batch.files.length === 0) {
      errors.files = 'At least one file is required';
    }

    // Whitelist requires creator name + social handle per file
    if (batch.isWhitelist) {
      for (let i = 0; i < batch.files.length; i++) {
        const ctx = batch.fileContexts[i] as any;
        if (!ctx?.creatorName?.trim()) {
          errors[`file_${i}_creator`] = 'Creator name required for whitelist';
          if (!errors.files) errors.files = 'All files need a creator name for whitelist submissions';
        }
        if (!ctx?.creatorHandle?.trim()) {
          errors[`file_${i}_handle`] = 'Handle required for whitelist';
          if (!errors.files) errors.files = 'All files need a @handle for whitelist submissions';
        }
      }
    }

    // Carousel per-card validation
    if (batch.isCarousel) {
      for (let i = 0; i < batch.files.length; i++) {
        const context = batch.fileContexts[i];
        if (!context?.copyHeadline) {
          errors[`file_${i}_headline`] = `Card ${i + 1}: headline required`;
        }
      }
    }

    setBatches((prev) =>
      prev.map((b) => (b.id === batch.id ? { ...b, errors } : b))
    );
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async () => {
    if (!selectedBrandId) {
      setSubmitMessage({ type: 'error', text: 'Please select a brand' });
      return;
    }

    // Validate all batches
    let allValid = true;
    for (const batch of batches) {
      if (!validateBatch(batch)) allValid = false;
    }
    if (!allValid) {
      setSubmitMessage({
        type: 'error',
        text: 'Please fix the highlighted errors before submitting',
      });
      return;
    }

    setIsSubmitting(true);
    setUploadProgress(null);
    setUploadPct(0);

    try {
      const supabase = createClient();
      const totalBatches = batches.length;
      const pendingBatches = batches.filter((b) => !savedBatchIds.has(b.id));
      const totalWork = pendingBatches.reduce((s, b) => s + b.files.length, 0) || 1;
      let doneWork = 0;

      for (let bIdx = 0; bIdx < batches.length; bIdx++) {
        const batch = batches[bIdx];

        // Skip batches already committed in a prior submit attempt this session.
        if (savedBatchIds.has(batch.id)) {
          setUploadProgress(`Batch ${bIdx + 1} of ${totalBatches} already saved — skipping`);
          continue;
        }

        setUploadProgress(`Uploading batch ${bIdx + 1} of ${totalBatches}...`);

        // Upload files to Supabase Storage
        const uploadedFiles = [];
        for (let fIdx = 0; fIdx < batch.files.length; fIdx++) {
          const file = batch.files[fIdx];
          setUploadProgress(
            `Batch ${bIdx + 1}/${totalBatches} — file ${fIdx + 1}/${batch.files.length} (${file.name})`
          );
          const storagePath = `${selectedBrandId}/${batch.batchName}/${file.name}`;
          const { data: uploadData, error: uploadError } = await supabase.storage
            .from('creatives')
            .upload(storagePath, file, { upsert: true });

          if (uploadError) {
            throw new Error(`Batch ${bIdx + 1} (${batch.batchName}) — file upload failed for "${file.name}": ${uploadError.message}`);
          }

          uploadedFiles.push({
            path: uploadData.path,
            name: file.name,
          });

          doneWork += 1;
          setUploadPct(Math.round((doneWork / totalWork) * 90));
        }

        setUploadProgress(`Saving batch ${bIdx + 1} of ${totalBatches}...`);

        // Create submission record
        const { data: { user } } = await supabase.auth.getUser();
        const { data: submission, error: submissionError } = await supabase
          .from('submissions')
          .insert({
            brand_id: selectedBrandId,
            user_id: user?.id,
            batch_name: batch.batchName,
            creative_type: (() => {
              // Derive from file-level creative types — use the most common, or 'mixed'
              const types = Object.values(batch.fileContexts)
                .map((c: any) => c?.creativeType)
                .filter(Boolean);
              if (types.length === 0) return 'mixed';
              const counts: Record<string, number> = {};
              for (const t of types) counts[t] = (counts[t] || 0) + 1;
              return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
            })(),
            creator_name: (() => {
              // Derive from per-file creators — use the most common, or empty
              const names = Object.values(batch.fileContexts)
                .map((c: any) => c?.creatorName)
                .filter(Boolean);
              if (names.length === 0) return '';
              const counts: Record<string, number> = {};
              for (const n of names) counts[n] = (counts[n] || 0) + 1;
              return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
            })(),
            creator_social_handle: (() => {
              const handles = Object.values(batch.fileContexts)
                .map((c: any) => c?.creatorHandle)
                .filter(Boolean);
              if (handles.length === 0) return null;
              const counts: Record<string, number> = {};
              for (const h of handles) counts[h] = (counts[h] || 0) + 1;
              return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
            })(),
            landing_page_url: batch.landingPageUrl || null,
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
            copy_headline: null,
            copy_body: batch.isCarousel ? batch.primaryText || null : null,
            copy_cta: null,
            notes: null,
            is_carousel: batch.isCarousel,
            is_flexible: batch.isFlexible,
            is_whitelist: batch.isWhitelist,
            file_count: batch.files.length,
          })
          .select()
          .single();

        if (submissionError) {
          throw new Error(`Batch ${bIdx + 1} (${batch.batchName}) — submission insert failed: ${submissionError.message}`);
        }

        // Create file records
        for (let i = 0; i < batch.files.length; i++) {
          const mediaInfo = batch.fileMediaInfo[i];
          const fileContext = batch.fileContexts[i];

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
            copy_title: (fileContext as any)?.copyTemplate || null,
            creator_name: (fileContext as any)?.creatorName || null,
            creator_social_handle: (fileContext as any)?.creatorHandle || null,
          });
          if (fileError) {
            console.error(`File insert error for ${batch.files[i].name}:`, fileError);
            throw new Error(`Batch ${bIdx + 1} (${batch.batchName}) — file record insert failed for "${batch.files[i].name}": ${fileError.message}`);
          }
        }

        // Mark batch as fully saved so a retry skips it.
        setSavedBatchIds((prev) => {
          const next = new Set(prev);
          next.add(batch.id);
          return next;
        });

        // Fire Dropbox sync. Resumable — if it times out on large files,
        // a second call picks up where it left off (already-synced files are
        // tracked per-row via submission_files.dropbox_path).
        const syncOnce = async () => {
          const res = await fetch('/api/submissions/sync-drive', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ submission_id: submission.id }),
          });
          return res.ok ? null : res.json().catch(() => null);
        };
        try {
          const result = await syncOnce();
          // If partial (some files synced, some didn't), auto-retry once
          if (result?.retryable) {
            console.info('Dropbox sync partial — auto-retrying...');
            await syncOnce();
          }
        } catch (e) {
          console.warn('Dropbox sync trigger failed (non-fatal):', e);
        }
      }

      // Call notify endpoint
      setUploadProgress('Sending notification...');
      setUploadPct(95);
      const brandName =
        brands.find((b) => b.id === selectedBrandId)?.name || 'Unknown brand';
      await fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brandName,
          brandId: selectedBrandId,
          batchCount: batches.length,
          totalFiles: batches.reduce((sum, b) => sum + b.files.length, 0),
          batches: batches.map((b) => ({
            batchName: b.batchName,
            creativeType: b.creativeType,
            creatorName: b.creatorName || 'Unknown',
            creatorSocialHandle: b.creatorSocialHandle || null,
            landingPageUrl: b.landingPageUrl || null,
            fileCount: b.files.length,
            fileNames: b.files.map((f) => f.name),
          })),
        }),
      });

      setUploadPct(100);
      setUploadProgress(null);

      // Get a fresh batch name from the server for the reset form
      const freshName = await fetchBatchName();

      setSubmitMessage({
        type: 'success',
        text: `${batches.length} batch${batches.length > 1 ? 'es' : ''} submitted — ${batches.reduce((s, b) => s + b.files.length, 0)} files uploaded`,
      });
      const fresh = createEmptyBatch(freshName);
      setBatches([fresh]);
      setActiveBatchId(fresh.id);
      setSavedBatchIds(new Set());
      setSelectedIndices([]);

      if (onSubmit) {
        onSubmit(batches);
      }
    } catch (error) {
      setUploadProgress(null);
      setSubmitMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Submission failed',
      });
    } finally {
      setIsSubmitting(false);
      setUploadPct(null);
    }
  };

  // Compute duplicate warnings for each file
  const fileDupeWarnings = useMemo(() => {
    const warnings: Record<string, Record<number, string>> = {};

    for (const batch of batches) {
      const batchWarnings: Record<number, string> = {};
      const seenInBatch = new Map<string, number>();

      for (let i = 0; i < batch.files.length; i++) {
        const name = batch.files[i].name;

        // Check same-batch duplicate
        if (seenInBatch.has(name)) {
          batchWarnings[i] = `Duplicate in this batch`;
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

  const stats = useMemo(() => {
    return {
      batchCount: batches.length,
      totalFiles: batches.reduce((sum, b) => sum + b.files.length, 0),
      totalSize: batches.reduce(
        (sum, b) => sum + b.files.reduce((s, f) => s + f.size, 0),
        0
      ),
    };
  }, [batches]);

  // Pending tags for the creative matrix (+N indicators)
  const pendingTags = useMemo(() => {
    const tags: { creativeType: string; productName: string }[] = [];
    for (const batch of batches) {
      for (const ctx of Object.values(batch.fileContexts)) {
        const c = ctx as any;
        if (c?.creativeType) {
          tags.push({
            creativeType: c.creativeType,
            productName: c.productName || '',
          });
        }
      }
    }
    return tags;
  }, [batches]);

  if (!activeBatch) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader className="w-6 h-6 text-[#C8B89A] animate-spin" />
      </div>
    );
  }

  const batch = activeBatch;
  const allIndices = batch.files.map((_, i) => i);
  const dupes = fileDupeWarnings[batch.id] || {};

  /** Batch-level bulk field: update batch state AND bulk-apply to all file contexts */
  const applyBatchField = (
    batchField: Partial<BatchFormState>,
    contextUpdates: Partial<FileContext>
  ) => {
    updateBatch(batch.id, batchField);
    if (allIndices.length > 0) {
      updateFileContexts(batch.id, allIndices, contextUpdates);
    }
  };

  const setPrimaryVariations = (variations: string[]) => {
    updateBatch(batch.id, {
      primaryVariations: variations,
      primaryText: variations.map((v) => v.trim()).filter(Boolean).join('\n\n'),
    });
  };

  const toggles: {
    key: 'isCarousel' | 'isFlexible' | 'isWhitelist';
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    exclusive: 'isCarousel' | 'isFlexible' | null;
  }[] = [
    { key: 'isCarousel', icon: Package, label: 'Carousel', exclusive: 'isFlexible' },
    { key: 'isFlexible', icon: Shuffle, label: 'Flexible', exclusive: 'isCarousel' },
    { key: 'isWhitelist', icon: Users, label: 'Whitelist', exclusive: null },
  ];

  return (
    <div className="pb-24">
      {/* Message Toast */}
      {submitMessage && (
        <div
          className={`fixed top-4 right-4 z-50 p-4 rounded-lg flex items-center gap-3 backdrop-blur-sm border shadow-lg animate-in slide-in-from-top-2 ${
            submitMessage.type === 'success'
              ? 'bg-green-500/20 border-green-400/30 text-green-100'
              : 'bg-red-500/20 border-red-400/30 text-red-100'
          }`}
        >
          {submitMessage.type === 'success' ? (
            <CheckCircle className="w-5 h-5 flex-shrink-0" />
          ) : (
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
          )}
          <span className="text-sm">{submitMessage.text}</span>
          <button
            onClick={() => setSubmitMessage(null)}
            className="ml-2 text-white/50 hover:text-white/80"
          >
            ×
          </button>
        </div>
      )}

      {/* ═══ Two-column layout ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* ─── LEFT COLUMN — batch tabs, copy, creator info ─── */}
        <div className="order-2 lg:order-1 lg:col-span-7 lg:overflow-y-auto lg:max-h-[calc(100vh-160px)] space-y-4 lg:pr-1">
          {/* Batch tab bar */}
          <div
            className="rounded-xl px-2 pt-1"
            style={{ backgroundColor: '#0D0D0D', border: '1px solid rgba(255,255,255,0.06)' }}
          >
            <div className="flex items-center gap-1 overflow-x-auto">
              {batches.map((b, i) => {
                const isActive = b.id === batch.id;
                const errCount = Object.keys(b.errors).length;
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setActiveBatchId(b.id)}
                    className="relative flex items-center gap-2 px-3 py-2.5 text-sm whitespace-nowrap transition-colors duration-150"
                    style={{
                      color: isActive ? '#F5F5F8' : '#ABABAB',
                      fontWeight: isActive ? 600 : 400,
                    }}
                  >
                    <span>Batch {i + 1}</span>
                    <span
                      className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                      style={{
                        backgroundColor: isActive
                          ? 'rgba(200,184,154,0.15)'
                          : 'rgba(255,255,255,0.06)',
                        color: isActive ? '#C8B89A' : '#888',
                      }}
                    >
                      {b.files.length}
                    </span>
                    {errCount > 0 && (
                      <span
                        className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                        style={{ backgroundColor: 'rgba(255,50,50,0.12)', color: '#ef4444' }}
                      >
                        {errCount}
                      </span>
                    )}
                    {batches.length > 1 && isActive && (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation();
                          removeBatch(b.id);
                        }}
                        className="p-0.5 rounded hover:bg-red-500/20"
                        title="Remove batch"
                      >
                        <Trash2 className="w-3 h-3 text-gray-500" />
                      </span>
                    )}
                    {/* Gold underline for active tab */}
                    {isActive && (
                      <span
                        className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full"
                        style={{ backgroundColor: '#C8B89A' }}
                      />
                    )}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={addBatch}
                className="p-2 rounded-lg text-[#C8B89A] hover:bg-[rgba(200,184,154,0.1)] transition-colors"
                title="Add another batch"
              >
                <Plus className="w-4 h-4" />
              </button>

              {/* Mode toggles — right side of tab bar */}
              <div className="ml-auto flex items-center gap-1 pr-1">
                {toggles.map(({ key, icon: Icon, label, exclusive }) => {
                  const checked = batch[key];
                  return (
                    <button
                      key={key}
                      type="button"
                      title={label}
                      onClick={() => {
                        const updates: Partial<BatchFormState> = { [key]: !checked };
                        if (!checked && exclusive) (updates as any)[exclusive] = false;
                        updateBatch(batch.id, updates);
                      }}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-colors duration-150"
                      style={{
                        backgroundColor: checked ? 'rgba(200,184,154,0.15)' : 'transparent',
                        border: checked
                          ? '1px solid rgba(200,184,154,0.35)'
                          : '1px solid rgba(255,255,255,0.06)',
                        color: checked ? '#C8B89A' : '#888',
                      }}
                    >
                      <Icon className="w-3 h-3" />
                      <span className="hidden xl:inline">{label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Batch name */}
          <div className="rounded-xl p-4 flex items-center justify-between gap-3" style={cardStyle}>
            <div className="min-w-0">
              <span className={sectionLabelClass} style={{ marginBottom: 4 }}>
                Batch Name
              </span>
              <p
                className="text-sm font-semibold truncate"
                style={{ color: '#C8B89A', letterSpacing: '0.03em' }}
              >
                {batch.batchName}
              </p>
            </div>
            <CopyButton text={batch.batchName} />
          </div>

          {/* Copy template selector — applies to all assets in the batch */}
          <div className="rounded-xl p-4" style={cardStyle}>
            <span className={sectionLabelClass}>Copy Template</span>
            <select
              value={batch.copyTemplate}
              onChange={(e) =>
                applyBatchField(
                  { copyTemplate: e.target.value },
                  { copyTemplate: e.target.value }
                )
              }
              className={inputClass}
              style={inputStyle}
            >
              <option value="">No template — tag per asset</option>
              {copyTemplateOptions.map((tpl) => (
                <option key={tpl.id} value={tpl.title}>
                  {tpl.title}
                </option>
              ))}
            </select>
            <p className="text-[10px] text-gray-500 mt-1.5">
              Selecting a template applies it to every asset in this batch. You can
              override per asset in the detail panel.
            </p>
          </div>

          {/* Primary text variations — batch-level (carousel) */}
          {batch.isCarousel && (
            <div className="rounded-xl p-4" style={cardStyle}>
              <span className={sectionLabelClass}>Primary Text</span>
              <div className="space-y-2">
                {batch.primaryVariations.map((text, vIdx) => (
                  <div
                    key={vIdx}
                    className="rounded-lg p-3"
                    style={{
                      backgroundColor: 'rgba(255,255,255,0.03)',
                      border: '1px solid rgba(255,255,255,0.08)',
                    }}
                  >
                    <div className="flex items-start gap-2">
                      <textarea
                        value={text}
                        rows={2}
                        placeholder={`Primary text variation ${vIdx + 1}`}
                        onChange={(e) => {
                          const next = [...batch.primaryVariations];
                          next[vIdx] = e.target.value;
                          setPrimaryVariations(next);
                        }}
                        className="flex-1 bg-transparent text-sm text-[#F5F5F8] placeholder-gray-600 focus:outline-none resize-y"
                      />
                      {batch.primaryVariations.length > 1 && (
                        <button
                          type="button"
                          onClick={() =>
                            setPrimaryVariations(
                              batch.primaryVariations.filter((_, i) => i !== vIdx)
                            )
                          }
                          className="p-1 rounded-md hover:bg-red-500/10 flex-shrink-0"
                          title="Delete variation"
                        >
                          <Trash2 className="w-3.5 h-3.5 text-gray-500" />
                        </button>
                      )}
                    </div>
                    <div className="flex justify-end">
                      <span
                        className="text-[10px]"
                        style={{ color: text.length > 125 ? '#EAB308' : '#666' }}
                      >
                        {text.length}/125
                      </span>
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setPrimaryVariations([...batch.primaryVariations, ''])}
                  className="w-full px-3 py-2.5 rounded-lg flex items-center justify-center gap-2 text-xs font-medium transition-colors"
                  style={{
                    border: '1px dashed rgba(200,184,154,0.3)',
                    color: '#C8B89A',
                    backgroundColor: 'rgba(200,184,154,0.03)',
                  }}
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add variation
                </button>
              </div>
            </div>
          )}

          {/* Carousel per-card headlines & descriptions */}
          {batch.isCarousel && batch.files.length > 0 && (
            <div className="rounded-xl p-4" style={cardStyle}>
              <span className={`${sectionLabelClass} flex items-center gap-1.5`}>
                <Layers className="w-3.5 h-3.5 text-[#C8B89A]" />
                Card Headlines &amp; Descriptions
              </span>
              <div className="space-y-2">
                {batch.files.map((file, fileIndex) => {
                  const ctx = batch.fileContexts[fileIndex] || ({} as any);
                  const headline = ctx.copyHeadline || '';
                  const body = ctx.copyBody || '';
                  return (
                    <div
                      key={fileIndex}
                      className="rounded-lg p-3"
                      style={{
                        backgroundColor: 'rgba(255,255,255,0.03)',
                        border: batch.errors[`file_${fileIndex}_headline`]
                          ? '1px solid rgba(239,68,68,0.4)'
                          : '1px solid rgba(255,255,255,0.08)',
                      }}
                    >
                      <p className="text-[10px] text-gray-500 mb-2 truncate">
                        Card {fileIndex + 1} — {file.name}
                      </p>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <input
                            type="text"
                            placeholder="Headline *"
                            value={headline}
                            onChange={(e) =>
                              updateFileContexts(batch.id, [fileIndex], {
                                copyHeadline: e.target.value,
                              })
                            }
                            className={inputClass}
                            style={inputStyle}
                          />
                          <div className="flex justify-between mt-1">
                            {batch.errors[`file_${fileIndex}_headline`] ? (
                              <p className="text-xs text-red-400">
                                {batch.errors[`file_${fileIndex}_headline`]}
                              </p>
                            ) : (
                              <span />
                            )}
                            <span
                              className="text-[10px]"
                              style={{ color: headline.length > 40 ? '#EAB308' : '#666' }}
                            >
                              {headline.length}/40
                            </span>
                          </div>
                        </div>
                        <div>
                          <input
                            type="text"
                            placeholder="Description"
                            value={body}
                            onChange={(e) =>
                              updateFileContexts(batch.id, [fileIndex], {
                                copyBody: e.target.value,
                              })
                            }
                            className={inputClass}
                            style={inputStyle}
                          />
                          <div className="flex justify-end mt-1">
                            <span
                              className="text-[10px]"
                              style={{ color: body.length > 30 ? '#EAB308' : '#666' }}
                            >
                              {body.length}/30
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Creator info — batch-level, applies to all assets */}
          <div className="rounded-xl p-4" style={cardStyle}>
            <span className={sectionLabelClass}>Creator Info</span>
            <div className="grid grid-cols-2 gap-3">
              <input
                type="text"
                placeholder="Creator name (applies to all assets)"
                value={batch.creatorName}
                onChange={(e) =>
                  applyBatchField(
                    { creatorName: e.target.value },
                    { creatorName: e.target.value }
                  )
                }
                className={inputClass}
                style={inputStyle}
              />
              {batch.isWhitelist ? (
                <input
                  type="text"
                  placeholder="@handle (required for whitelist)"
                  value={batch.creatorSocialHandle}
                  onChange={(e) =>
                    applyBatchField(
                      { creatorSocialHandle: e.target.value },
                      { creatorHandle: e.target.value }
                    )
                  }
                  className={inputClass}
                  style={inputStyle}
                />
              ) : (
                <div className="flex items-center text-[11px] text-gray-600 px-1">
                  Enable Whitelist to capture @handles
                </div>
              )}
            </div>
            <p className="text-[10px] text-gray-500 mt-1.5">
              Applies to every asset in this batch — override per asset in the detail panel.
            </p>
          </div>

          {batch.errors.files && (
            <div
              className="rounded-lg px-3 py-2 flex items-center gap-2 text-xs"
              style={{
                backgroundColor: 'rgba(255,50,50,0.06)',
                border: '1px solid rgba(255,50,50,0.2)',
                color: '#f87171',
              }}
            >
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
              {batch.errors.files}
            </div>
          )}
        </div>

        {/* ─── RIGHT COLUMN — uploader, asset grid, detail panel, matrix ─── */}
        <div className="order-1 lg:order-2 lg:col-span-5 lg:overflow-y-auto lg:max-h-[calc(100vh-160px)] space-y-4 lg:pl-1">
          {/* Uploader header — sticky */}
          <div
            className="lg:sticky lg:top-0 z-10 rounded-xl"
            style={{ backgroundColor: '#0A0A0A' }}
          >
            <div className="flex items-center gap-2 mb-2">
              <FileText className="w-4 h-4 text-[#C8B89A]" />
              <span className="text-sm font-medium text-gray-200">
                Assets — Batch {batches.findIndex((b) => b.id === batch.id) + 1}
              </span>
              {batch.files.length > 0 && (
                <span className="text-xs text-gray-500">
                  {batch.files.length} file{batch.files.length !== 1 ? 's' : ''}
                </span>
              )}
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
            <FileUploader
              files={batch.files}
              compact={batch.files.length > 0}
              onFilesChange={(files: File[]) => {
                // Seed new files' contexts with batch-level defaults
                const startIdx = batch.files.length;
                const added = files.length - batch.files.length;
                updateBatch(batch.id, { files });
                if (added > 0) {
                  const defaults: Partial<FileContext> = {};
                  if (batch.copyTemplate) defaults.copyTemplate = batch.copyTemplate;
                  if (batch.creatorName) defaults.creatorName = batch.creatorName;
                  if (batch.creatorSocialHandle)
                    defaults.creatorHandle = batch.creatorSocialHandle;
                  if (Object.keys(defaults).length > 0) {
                    const newIndices = Array.from({ length: added }, (_, i) => startIdx + i);
                    updateFileContexts(batch.id, newIndices, defaults);
                  }
                }
              }}
              onMediaInfoChange={(index: number, info: FileMediaInfo) => {
                setBatches((prev) =>
                  prev.map((b) =>
                    b.id === batch.id
                      ? {
                          ...b,
                          fileMediaInfo: {
                            ...b.fileMediaInfo,
                            [index]: info,
                          },
                        }
                      : b
                  )
                );
              }}
              mediaInfo={batch.fileMediaInfo}
              maxFileSize={2 * 1024 * 1024 * 1024}
            />
          </div>

          {/* Asset thumbnail grid */}
          {batch.files.length > 0 && (
            <>
              <div className="flex items-center justify-between">
                <p className="text-[10px] text-gray-600">
                  Click to select • Shift+click for multi-select • Drag to reorder
                </p>
                {selectedIndices.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelectedIndices([])}
                    className="text-[10px] text-[#C8B89A] hover:underline flex items-center gap-1"
                  >
                    <X className="w-3 h-3" />
                    Clear selection ({selectedIndices.length})
                  </button>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2">
                {batch.files.map((file, fileIndex) => (
                  <AssetThumbnail
                    key={`${file.name}-${fileIndex}`}
                    file={file}
                    index={fileIndex}
                    mediaInfo={batch.fileMediaInfo[fileIndex]}
                    isSelected={selectedIndices.includes(fileIndex)}
                    isTagged={Boolean((batch.fileContexts[fileIndex] as any)?.creativeType)}
                    dupeWarning={dupes[fileIndex] || ''}
                    onClick={handleAssetClick}
                    onRemove={(idx) => removeFile(batch.id, idx)}
                    onDragStart={(idx) => setDragIndex(idx)}
                    onDragOver={(e, idx) => {
                      e.preventDefault();
                      setDragOverIndex(idx);
                    }}
                    onDrop={(idx) => {
                      if (dragIndex !== null) moveFile(batch.id, dragIndex, idx);
                      setDragIndex(null);
                      setDragOverIndex(null);
                    }}
                    isDragTarget={dragOverIndex === fileIndex && dragIndex !== fileIndex}
                  />
                ))}
              </div>
            </>
          )}

          {/* Asset detail panel */}
          {selectedIndices.length > 0 && (
            <AssetDetailPanel
              files={batch.files}
              selectedIndices={selectedIndices}
              mediaInfo={batch.fileMediaInfo}
              fileContexts={batch.fileContexts}
              products={brandProducts}
              copyTemplateOptions={copyTemplateOptions}
              isCarousel={batch.isCarousel}
              isWhitelist={batch.isWhitelist}
              errors={batch.errors}
              onContextChange={(indices, updates) =>
                updateFileContexts(batch.id, indices, updates)
              }
            />
          )}

          {/* Creative matrix mini-summary */}
          <CreativeMatrixSummary brandId={selectedBrandId} pendingTags={pendingTags} />
        </div>
      </div>

      {/* ═══ Sticky Footer ═══ */}
      <div
        className="fixed bottom-0 left-0 right-0 z-40"
        style={{
          backgroundColor: 'rgba(10,10,10,0.95)',
          backdropFilter: 'blur(12px)',
          borderTop: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        {/* Upload progress bar */}
        {uploadPct !== null && (
          <div className="h-1 w-full" style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}>
            <div
              className="h-full transition-all duration-300"
              style={{
                width: `${uploadPct}%`,
                background: 'linear-gradient(90deg, #C8B89A 0%, #A89474 100%)',
              }}
            />
          </div>
        )}
        <div className="max-w-7xl mx-auto flex items-center justify-between p-4">
          <div className="flex items-center gap-5 text-sm">
            <div className="flex gap-1.5">
              <span className="text-gray-500">Batches:</span>
              <span className="text-[#F5F5F8] font-semibold">{stats.batchCount}</span>
            </div>
            <div className="flex gap-1.5">
              <span className="text-gray-500">Files:</span>
              <span className="text-[#F5F5F8] font-semibold">{stats.totalFiles}</span>
            </div>
            <div className="hidden sm:flex gap-1.5">
              <span className="text-gray-500">Size:</span>
              <span className="text-[#F5F5F8] font-semibold">
                {formatSize(stats.totalSize)}
              </span>
            </div>
            {uploadProgress && (
              <span className="text-[#C8B89A] text-xs animate-pulse ml-2 hidden md:inline">
                {uploadProgress}
              </span>
            )}
          </div>

          <button
            onClick={handleSubmit}
            disabled={isSubmitting || isLoading}
            className="px-8 py-2.5 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-[#0A0A0A] font-semibold text-sm flex items-center gap-2 transition-all"
            style={{
              background: 'linear-gradient(135deg, #C8B89A 0%, #A89474 100%)',
            }}
          >
            {isSubmitting || isLoading ? (
              <>
                <Loader className="w-4 h-4 animate-spin" />
                Uploading{uploadPct !== null ? ` ${uploadPct}%` : '...'}
              </>
            ) : (
              <>
                <Upload className="w-4 h-4" />
                Submit All Batches
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SubmissionForm;
