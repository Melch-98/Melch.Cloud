'use client';

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  AlertCircle,
  CheckCircle,
  Loader,
  Plus,
  Trash2,
  ChevronDown,
  ChevronUp,
  Upload,
  Package,
  Layers,
  Shuffle,
  Users,
  Copy,
  Check,
  RefreshCw,
} from 'lucide-react';
import FileUploader, { FileMediaInfo } from './FileUploader';
import FileCard from './FileCard';
import { createClient } from '@/lib/supabase';
import { FileContext } from '@/lib/types';
import { CREATIVE_TYPE_GROUPS, CREATIVE_TYPES_MAP } from '@/lib/creative-types';

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
  isExpanded: boolean;
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
  files: [],
  isCarousel: false,
  isFlexible: false,
  isWhitelist: false,
  creatorSocialHandle: '',
  fileContexts: {},
  fileMediaInfo: {},
  isExpanded: true,
  errors: {},
});

// Input field component for consistency and speed
const Field = ({
  label,
  icon,
  error,
  children,
  className = '',
}: {
  label: string;
  icon?: React.ReactNode;
  error?: string;
  children: React.ReactNode;
  className?: string;
}) => (
  <div className={className}>
    <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1.5">
      {icon ? (
        <span className="flex items-center gap-1.5">
          {icon}
          {label}
        </span>
      ) : (
        label
      )}
    </label>
    {children}
    {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
  </div>
);

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
  'w-full px-3.5 py-2.5 rounded-lg text-sm text-[#F5F5F8] placeholder-gray-600 focus:outline-none transition-all';

const inputStyle = {
  backgroundColor: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.08)',
};

const inputFocusStyle = 'focus:border-[#C8B89A]/40 focus:bg-[rgba(255,255,255,0.06)]';

const selectClass =
  'w-full px-3.5 py-2.5 rounded-lg text-sm text-[#F5F5F8] focus:outline-none transition-all';

interface CopyTemplateOption {
  id: string;
  title: string;
}

const SubmissionForm: React.FC<SubmissionFormProps> = ({
  brands,
  selectedBrandId,
  onSubmit,
  isLoading = false,
}) => {
  const [batches, setBatches] = useState<BatchFormState[]>([]);
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
  const [copyTemplateOptions, setCopyTemplateOptions] = useState<CopyTemplateOption[]>([]);
  const [brandProducts, setBrandProducts] = useState<
    { shopify_product_id: string; title: string; product_type: string; handle: string }[]
  >([]);
  const [syncingProducts, setSyncingProducts] = useState(false);
  const [syncSuccess, setSyncSuccess] = useState(false);

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
        setBatches([createEmptyBatch(name)]);
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

  const removeBatch = useCallback((id: string) => {
    setBatches((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((batch) => batch.id !== id);
    });
  }, []);

  const addBatch = useCallback(async () => {
    // Pass current form batch names as reserved so the API skips them
    const reserved = batches.map((b) => b.batchName);
    const name = await fetchBatchName(reserved);
    setBatches((prev) => {
      const collapsed = prev.map((b) => ({ ...b, isExpanded: false }));
      return [...collapsed, createEmptyBatch(name)];
    });
  }, [batches, fetchBatchName]);

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

    updateBatch(batch.id, { errors });
    // Re-set errors without clearing them
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

    try {
      const supabase = createClient();
      const totalBatches = batches.length;

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

      setUploadProgress(null);

      // Get a fresh batch name from the server for the reset form
      const freshName = await fetchBatchName();

      setSubmitMessage({
        type: 'success',
        text: `${batches.length} batch${batches.length > 1 ? 'es' : ''} submitted — ${batches.reduce((s, b) => s + b.files.length, 0)} files uploaded`,
      });
      setBatches([createEmptyBatch(freshName)]);
      setSavedBatchIds(new Set());

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
    }
  };

  const stats = useMemo(() => {
    return {
      batchCount: batches.length,
      totalFiles: batches.reduce((sum, b) => sum + b.files.length, 0),
      carouselCount: batches.filter((b) => b.isCarousel).length,
      flexibleCount: batches.filter((b) => b.isFlexible).length,
      whitelistCount: batches.filter((b) => b.isWhitelist).length,
    };
  }, [batches]);

  return (
    <div className="space-y-4 pb-32">
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

      {/* Batches */}
      <div className="space-y-4">
        {batches.map((batch, batchIndex) => (
          <div
            key={batch.id}
            className="rounded-xl overflow-hidden"
            style={{
              backgroundColor: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            {/* Batch Header */}
            <div
              className="p-4 cursor-pointer hover:bg-white/[0.02] transition-colors flex items-center justify-between"
              style={{ borderBottom: batch.isExpanded ? '1px solid rgba(255,255,255,0.06)' : 'none' }}
              onClick={() =>
                updateBatch(batch.id, { isExpanded: !batch.isExpanded })
              }
            >
              <div className="flex items-center gap-3 flex-1">
                {batch.isExpanded ? (
                  <ChevronUp className="w-4 h-4 text-[#C8B89A]" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-[#C8B89A]" />
                )}
                <span
                  className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded"
                  style={{ backgroundColor: 'rgba(200,184,154,0.15)', color: '#C8B89A' }}
                >
                  BATCH {batchIndex + 1}
                </span>
                <span className="text-sm font-semibold text-[#F5F5F8]">{batch.batchName}</span>
                <div className="ml-auto flex items-center gap-2">
                  <span className="text-xs text-gray-500">
                    {batch.files.length} file{batch.files.length !== 1 ? 's' : ''}
                  </span>
                  {batch.isCarousel && (
                    <span className="text-[10px] font-bold text-[#C8B89A] bg-[rgba(200,184,154,0.1)] px-1.5 py-0.5 rounded">
                      CAROUSEL
                    </span>
                  )}
                  {batch.isFlexible && (
                    <span className="text-[10px] font-bold text-[#C8B89A] bg-[rgba(200,184,154,0.1)] px-1.5 py-0.5 rounded">
                      FLEXIBLE
                    </span>
                  )}
                  {batch.isWhitelist && (
                    <span className="text-[10px] font-bold text-[#C8B89A] bg-[rgba(200,184,154,0.1)] px-1.5 py-0.5 rounded">
                      WHITELIST
                    </span>
                  )}
                  {Object.keys(batch.errors).length > 0 && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: 'rgba(255,50,50,0.1)', color: '#ef4444' }}>
                      {Object.keys(batch.errors).length} error{Object.keys(batch.errors).length > 1 ? 's' : ''}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {batch.isExpanded && (
              <div className="p-5 space-y-5">
                {/* Checkbox Toggles */}
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { key: 'isCarousel', icon: Package, label: 'Carousel Ad', desc: 'Multi-card carousel', exclusive: 'isFlexible' },
                    { key: 'isFlexible', icon: Shuffle, label: 'Flexible Ad', desc: 'Dynamic placements', exclusive: 'isCarousel' },
                    { key: 'isWhitelist', icon: Users, label: 'Whitelist', desc: 'Creator handle required', exclusive: null },
                  ].map(({ key, icon: Icon, label, desc, exclusive }) => {
                    const checked = batch[key as keyof BatchFormState] as boolean;
                    return (
                      <label
                        key={key}
                        className="flex items-center gap-3 cursor-pointer p-3 rounded-lg transition-all"
                        style={{
                          backgroundColor: checked ? 'rgba(200,184,154,0.08)' : 'rgba(255,255,255,0.02)',
                          border: checked ? '1px solid rgba(200,184,154,0.25)' : '1px solid rgba(255,255,255,0.06)',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const updates: any = { [key]: e.target.checked };
                            if (e.target.checked && exclusive) updates[exclusive] = false;
                            updateBatch(batch.id, updates);
                          }}
                          className="w-4 h-4 accent-[#C8B89A]"
                        />
                        <div>
                          <div className="flex items-center gap-1.5 font-medium text-[#F5F5F8] text-sm">
                            <Icon className="w-3.5 h-3.5 text-[#C8B89A]" />
                            {label}
                          </div>
                          <p className="text-[10px] text-gray-500">{desc}</p>
                        </div>
                      </label>
                    );
                  })}
                </div>

                {/* ─── Form Fields ─── */}
                <div className="grid grid-cols-2 gap-3">
                  {/* Batch Name */}
                  <Field label="Batch Name" error={batch.errors.batchName}>
                    <div
                      className={`${inputClass} cursor-default flex items-center justify-between gap-2`}
                      style={{
                        ...inputStyle,
                        color: '#C8B89A',
                        fontWeight: 600,
                        letterSpacing: '0.03em',
                      }}
                    >
                      <span className="truncate">{batch.batchName}</span>
                      <CopyButton text={batch.batchName} />
                    </div>
                  </Field>

                  {/* Primary Text — CAROUSEL only */}
                  {batch.isCarousel && (
                    <Field label="Primary Text" error={batch.errors.primaryText}>
                      <input
                        type="text"
                        value={batch.primaryText}
                        onChange={(e) =>
                          updateBatch(batch.id, { primaryText: e.target.value })
                        }
                          className={`${inputClass} ${inputFocusStyle}`}
                        style={inputStyle}
                        placeholder="Ad primary text shown above carousel"
                      />
                    </Field>
                  )}

                </div>

                {/* ─── File Uploader (drop zone) ─── */}
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm font-medium text-gray-200">Files</span>
                    {batch.files.length > 0 && (
                      <span className="text-xs text-gray-500">
                        {batch.files.length} file{batch.files.length !== 1 ? 's' : ''} selected
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
                    onFilesChange={(files: File[]) =>
                      updateBatch(batch.id, { files })
                    }
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
                  {batch.errors.files && (
                    <p className="text-xs text-red-400 mt-2">
                      {batch.errors.files}
                    </p>
                  )}
                </div>

                {/* ─── File Cards with Inline Tags ─── */}
                {batch.files.length > 0 && (
                  <div className="space-y-2">
                    {batch.files.map((file, fileIndex) => (
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
                        creatorName={(batch.fileContexts[fileIndex] as any)?.creatorName || ''}
                        creatorHandle={(batch.fileContexts[fileIndex] as any)?.creatorHandle || ''}
                        products={brandProducts}
                        copyTemplateOptions={copyTemplateOptions}
                        isCarousel={batch.isCarousel}
                        isWhitelist={batch.isWhitelist}
                        onRemove={(idx) => {
                          const updatedFiles = batch.files.filter((_, i) => i !== idx);
                          updateBatch(batch.id, { files: updatedFiles });
                        }}
                        onProductChange={(idx, pid, pname) => {
                          const context = batch.fileContexts[idx] || {} as any;
                          updateBatch(batch.id, {
                            fileContexts: {
                              ...batch.fileContexts,
                              [idx]: { ...context, productId: pid, productName: pname },
                            },
                          });
                        }}
                        onCreativeTypeChange={(idx, val) => {
                          const context = batch.fileContexts[idx] || {} as any;
                          updateBatch(batch.id, {
                            fileContexts: {
                              ...batch.fileContexts,
                              [idx]: { ...context, creativeType: val },
                            },
                          });
                        }}
                        onHookAngleChange={(idx, val) => {
                          const context = batch.fileContexts[idx] || {} as any;
                          updateBatch(batch.id, {
                            fileContexts: {
                              ...batch.fileContexts,
                              [idx]: { ...context, hookAngle: val },
                            },
                          });
                        }}
                        onCopyTemplateChange={(idx, val) => {
                          const context = batch.fileContexts[idx] || {} as any;
                          updateBatch(batch.id, {
                            fileContexts: {
                              ...batch.fileContexts,
                              [idx]: { ...context, copyTemplate: val },
                            },
                          });
                        }}
                        onCreatorNameChange={(idx, val) => {
                          const context = batch.fileContexts[idx] || {} as any;
                          updateBatch(batch.id, {
                            fileContexts: {
                              ...batch.fileContexts,
                              [idx]: { ...context, creatorName: val },
                            },
                          });
                        }}
                        onCreatorHandleChange={(idx, val) => {
                          const context = batch.fileContexts[idx] || {} as any;
                          updateBatch(batch.id, {
                            fileContexts: {
                              ...batch.fileContexts,
                              [idx]: { ...context, creatorHandle: val },
                            },
                          });
                        }}
                      />
                    ))}
                  </div>
                )}

                {/* ─── Per-Card Details (CAROUSEL only) ─── */}
                {batch.isCarousel && batch.files.length > 0 && (
                  <div className="space-y-3">
                    <span className="text-sm font-medium text-gray-200 flex items-center gap-2">
                      <Layers className="w-4 h-4 text-amber-600" />
                      Card Details
                    </span>
                    {batch.files.map((file, fileIndex) => (
                      <div
                        key={fileIndex}
                        className="p-4 bg-white/[0.03] border border-white/8 rounded-lg"
                      >
                        <p className="text-xs text-gray-400 mb-3 font-medium">
                          Card {fileIndex + 1} — {file.name}
                        </p>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <input
                              type="text"
                              placeholder="Headline *"
                              value={
                                batch.fileContexts[fileIndex]?.copyHeadline || ''
                              }
                              onChange={(e) => {
                                const context =
                                  batch.fileContexts[fileIndex] || {};
                                updateBatch(batch.id, {
                                  fileContexts: {
                                    ...batch.fileContexts,
                                    [fileIndex]: {
                                      ...context,
                                      copyHeadline: e.target.value,
                                    },
                                  },
                                });
                              }}
                              className={`${inputClass} ${inputFocusStyle}`}
                              style={inputStyle}
                            />
                            {batch.errors[`file_${fileIndex}_headline`] && (
                              <p className="text-xs text-red-400 mt-1">
                                {batch.errors[`file_${fileIndex}_headline`]}
                              </p>
                            )}
                          </div>
                          <input
                            type="text"
                            placeholder="Description"
                            value={
                              batch.fileContexts[fileIndex]?.copyBody || ''
                            }
                            onChange={(e) => {
                              const context =
                                batch.fileContexts[fileIndex] || {};
                              updateBatch(batch.id, {
                                fileContexts: {
                                  ...batch.fileContexts,
                                  [fileIndex]: {
                                    ...context,
                                    copyBody: e.target.value,
                                  },
                                },
                              });
                            }}
                            className={`${inputClass} ${inputFocusStyle}`}
                            style={inputStyle}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Remove Batch Button */}
                {batches.length > 1 && (
                  <button
                    onClick={() => removeBatch(batch.id)}
                    className="w-full px-4 py-2 rounded-lg text-sm flex items-center justify-center gap-2 transition-all"
                    style={{
                      backgroundColor: 'rgba(255,50,50,0.06)',
                      border: '1px solid rgba(255,50,50,0.15)',
                      color: '#888',
                    }}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Remove Batch
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Add Another Batch */}
      <button
        onClick={addBatch}
        className="w-full px-4 py-3 rounded-xl flex items-center justify-center gap-2 transition-all text-sm font-medium"
        style={{
          border: '1px dashed rgba(200,184,154,0.3)',
          color: '#C8B89A',
          backgroundColor: 'rgba(200,184,154,0.04)',
        }}
      >
        <Plus className="w-4 h-4" />
        Add Another Batch
      </button>

      {/* Sticky Footer */}
      <div
        className="fixed bottom-0 left-0 right-0 p-4 z-40"
        style={{
          backgroundColor: 'rgba(10,10,10,0.95)',
          backdropFilter: 'blur(12px)',
          borderTop: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-5 text-sm">
            <div className="flex gap-1.5">
              <span className="text-gray-500">Batches:</span>
              <span className="text-[#F5F5F8] font-semibold">{stats.batchCount}</span>
            </div>
            <div className="flex gap-1.5">
              <span className="text-gray-500">Files:</span>
              <span className="text-[#F5F5F8] font-semibold">{stats.totalFiles}</span>
            </div>
            {stats.carouselCount > 0 && (
              <div className="flex gap-1.5">
                <span className="text-gray-500">Carousel:</span>
                <span className="text-[#C8B89A] font-semibold">
                  {stats.carouselCount}
                </span>
              </div>
            )}
            {stats.flexibleCount > 0 && (
              <div className="flex gap-1.5">
                <span className="text-gray-500">Flexible:</span>
                <span className="text-[#C8B89A] font-semibold">
                  {stats.flexibleCount}
                </span>
              </div>
            )}
            {stats.whitelistCount > 0 && (
              <div className="flex gap-1.5">
                <span className="text-gray-500">Whitelist:</span>
                <span className="text-[#C8B89A] font-semibold">
                  {stats.whitelistCount}
                </span>
              </div>
            )}
            {uploadProgress && (
              <span className="text-[#C8B89A] text-xs animate-pulse ml-2">
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
                Uploading...
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
