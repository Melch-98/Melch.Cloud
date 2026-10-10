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
  Shuffle,
  Users,
  Copy,
  Check,
  FileText,
} from 'lucide-react';
import FileUploader, { FileMediaInfo } from './FileUploader';
import AssetThumbnail from './AssetThumbnail';
import { createClient } from '@/lib/supabase';
import { deriveBatchCreativeType } from '@/lib/batch-creative-type';

export interface BatchFormData {
  batchName: string;
  creatorName: string;
  landingPageUrl: string;
  copyTemplate: string;
  primaryText: string;
  notes: string;
  files: File[];
  isCarousel: boolean;
  isFlexible: boolean;
  isWhitelist: boolean;
  creatorSocialHandle: string;
  fileCards: Record<number, { headline: string; body: string }>;
  fileMediaInfo: Record<number, FileMediaInfo>;
}

interface BatchFormState extends BatchFormData {
  id: string;
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

interface CopyTemplateOption {
  id: string;
  title: string;
}

const createEmptyBatch = (batchName: string): BatchFormState => ({
  id: `batch-${Date.now()}-${Math.random()}`,
  batchName,
  creatorName: '',
  landingPageUrl: '',
  copyTemplate: '',
  primaryText: '',
  notes: '',
  files: [],
  isCarousel: false,
  isFlexible: false,
  isWhitelist: false,
  creatorSocialHandle: '',
  fileCards: {},
  fileMediaInfo: {},
  errors: {},
});

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return (bytes / Math.pow(k, i)).toFixed(1) + ' ' + sizes[i];
}

function remapRecord<T>(rec: Record<number, T>, mapping: number[]): Record<number, T> {
  const out: Record<number, T> = {};
  mapping.forEach((oldIdx, newIdx) => {
    if (rec[oldIdx] !== undefined) out[newIdx] = rec[oldIdx];
  });
  return out;
}

const inputClass =
  'w-full px-3.5 py-2.5 rounded-lg text-sm text-[#F5F5F8] placeholder-gray-600 focus:outline-none transition-all focus:border-[#C8B89A]/40';

const inputStyle: React.CSSProperties = {
  backgroundColor: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.08)',
};

const cardStyle: React.CSSProperties = {
  backgroundColor: '#111111',
  border: '1px solid rgba(255,255,255,0.06)',
};

const sectionLabelClass =
  'text-xs font-medium text-gray-500 uppercase tracking-wider mb-2 block';

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

const SubmissionForm: React.FC<SubmissionFormProps> = ({
  brands,
  selectedBrandId,
  onSubmit,
  isLoading = false,
}) => {
  const [brandId, setBrandId] = useState<string | undefined>(selectedBrandId);
  const [batches, setBatches] = useState<BatchFormState[]>([]);
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null);
  const [savedBatchIds, setSavedBatchIds] = useState<Set<string>>(new Set());
  const [submitMessage, setSubmitMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [copyTemplateOptions, setCopyTemplateOptions] = useState<CopyTemplateOption[]>([]);
  const [existingFiles, setExistingFiles] = useState<Map<string, string>>(new Map());
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const brandLocked = Boolean(selectedBrandId) || brands.length <= 1;
  const activeBrand = brands.find((b) => b.id === brandId) || null;

  useEffect(() => {
    if (selectedBrandId) {
      setBrandId(selectedBrandId);
      return;
    }
    if (brands.length === 1) setBrandId(brands[0].id);
  }, [selectedBrandId, brands]);

  const activeBatch = useMemo(
    () => batches.find((b) => b.id === activeBatchId) || batches[0] || null,
    [batches, activeBatchId]
  );

  const fetchBatchName = useCallback(async (reserved: string[] = []): Promise<string> => {
    if (!brandId) return 'XXX_000000_0001';
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return 'XXX_000000_0001';
    const res = await fetch('/api/batch-name', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ brand_id: brandId, reserved }),
    });
    if (!res.ok) return 'XXX_000000_0001';
    const json = await res.json();
    return json.batch_name;
  }, [brandId]);

  useEffect(() => {
    let cancelled = false;
    if (!brandId) {
      setBatches([]);
      setActiveBatchId(null);
      return;
    }
    const batch = createEmptyBatch('…');
    setBatches([batch]);
    setActiveBatchId(batch.id);
    setSavedBatchIds(new Set());
    void (async () => {
      const name = await fetchBatchName();
      if (cancelled) return;
      setBatches((prev) => prev.map((b) => (b.id === batch.id ? { ...b, batchName: name } : b)));
    })();
    return () => {
      cancelled = true;
    };
  }, [brandId, fetchBatchName]);

  useEffect(() => {
    if (submitMessage?.type === 'success') {
      const timer = setTimeout(() => setSubmitMessage(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [submitMessage]);

  useEffect(() => {
    const fetchExistingFiles = async () => {
      if (!brandId) {
        setExistingFiles(new Map());
        return;
      }
      try {
        const supabase = createClient();
        const { data: files } = await supabase
          .from('submission_files')
          .select('file_name, submissions!inner(batch_name, brand_id)')
          .eq('submissions.brand_id', brandId);
        const map = new Map<string, string>();
        for (const f of files || []) {
          const batchName = (f as { submissions?: { batch_name?: string } }).submissions?.batch_name || 'unknown batch';
          if (f.file_name && !map.has(f.file_name)) map.set(f.file_name, batchName);
        }
        setExistingFiles(map);
      } catch (err) {
        console.error('Failed to fetch existing files:', err);
      }
    };
    fetchExistingFiles();
  }, [brandId]);

  useEffect(() => {
    const fetchCopyTemplates = async () => {
      if (!brandId) {
        setCopyTemplateOptions([]);
        return;
      }
      try {
        const supabase = createClient();
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const res = await fetch(`/api/copy-templates?brand_id=${brandId}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!res.ok) return;
        const json = await res.json();
        setCopyTemplateOptions(
          (json.templates || []).map((t: { id: string; title: string }) => ({
            id: t.id,
            title: t.title,
          }))
        );
      } catch {
        // templates are optional
      }
    };
    fetchCopyTemplates();
  }, [brandId]);

  const updateBatch = useCallback((id: string, updates: Partial<BatchFormState>) => {
    setBatches((prev) =>
      prev.map((batch) => (batch.id === id ? { ...batch, ...updates, errors: {} } : batch))
    );
  }, []);

  const removeBatch = useCallback((id: string) => {
    setBatches((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.filter((batch) => batch.id !== id);
      setActiveBatchId((cur) => (cur === id ? next[0]?.id ?? null : cur));
      return next;
    });
  }, []);

  const addBatch = useCallback(async () => {
    const reserved = batches.map((b) => b.batchName);
    const name = await fetchBatchName(reserved);
    const batch = createEmptyBatch(name);
    setBatches((prev) => [...prev, batch]);
    setActiveBatchId(batch.id);
  }, [batches, fetchBatchName]);

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
          fileCards: remapRecord(b.fileCards, order),
          fileMediaInfo: remapRecord(b.fileMediaInfo, order),
        };
      })
    );
  }, []);

  const removeFile = useCallback((batchId: string, index: number) => {
    setBatches((prev) =>
      prev.map((b) => {
        if (b.id !== batchId) return b;
        const order = b.files.map((_, i) => i).filter((i) => i !== index);
        return {
          ...b,
          files: order.map((i) => b.files[i]),
          fileCards: remapRecord(b.fileCards, order),
          fileMediaInfo: remapRecord(b.fileMediaInfo, order),
        };
      })
    );
  }, []);

  const validateBatch = (batch: BatchFormState): boolean => {
    const errors: Record<string, string> = {};
    if (batch.files.length === 0) errors.files = 'Add at least one file';
    setBatches((prev) => prev.map((b) => (b.id === batch.id ? { ...b, errors } : b)));
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async () => {
    if (!brandId) {
      setSubmitMessage({ type: 'error', text: 'Choose a brand' });
      return;
    }

    let allValid = true;
    for (const batch of batches) {
      if (!validateBatch(batch)) allValid = false;
    }
    if (!allValid) {
      setSubmitMessage({ type: 'error', text: 'Add at least one file to each batch' });
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
        if (savedBatchIds.has(batch.id)) {
          setUploadProgress(`Batch ${bIdx + 1} of ${totalBatches} already saved — skipping`);
          continue;
        }

        setUploadProgress(`Uploading batch ${bIdx + 1} of ${totalBatches}...`);
        const uploadedFiles: { path: string; name: string }[] = [];
        for (let fIdx = 0; fIdx < batch.files.length; fIdx++) {
          const file = batch.files[fIdx];
          setUploadProgress(
            `Batch ${bIdx + 1}/${totalBatches} — file ${fIdx + 1}/${batch.files.length} (${file.name})`
          );
          const storagePath = `${brandId}/${batch.batchName}/${file.name}`;
          const { data: uploadData, error: uploadError } = await supabase.storage
            .from('creatives')
            .upload(storagePath, file, { upsert: true });
          if (uploadError) {
            throw new Error(
              `Batch ${bIdx + 1} (${batch.batchName}) — file upload failed for "${file.name}": ${uploadError.message}`
            );
          }
          uploadedFiles.push({ path: uploadData.path, name: file.name });
          doneWork += 1;
          setUploadPct(Math.round((doneWork / totalWork) * 90));
        }

        setUploadProgress(`Saving batch ${bIdx + 1} of ${totalBatches}...`);
        const { data: { user } } = await supabase.auth.getUser();
        const { data: submission, error: submissionError } = await supabase
          .from('submissions')
          .insert({
            brand_id: brandId,
            user_id: user?.id,
            drive_sync_status: 'pending',
            batch_name: batch.batchName,
            creative_type: deriveBatchCreativeType(batch.files, {
              isCarousel: batch.isCarousel,
              isFlexible: batch.isFlexible,
            }),
            creator_name: batch.creatorName.trim(),
            creator_social_handle: batch.creatorSocialHandle.trim() || null,
            landing_page_url: batch.landingPageUrl.trim() || '',
            copy_title: batch.copyTemplate.trim() || '',
            copy_headline: null,
            copy_body: batch.isCarousel ? batch.primaryText.trim() || '' : '',
            copy_cta: null,
            notes: batch.notes.trim() || '',
            is_carousel: batch.isCarousel,
            is_flexible: batch.isFlexible,
            is_whitelist: batch.isWhitelist,
            file_count: batch.files.length,
          })
          .select()
          .single();

        if (submissionError || !submission) {
          throw new Error(
            `Batch ${bIdx + 1} (${batch.batchName}) — submission insert failed: ${submissionError?.message || 'unknown error'}`
          );
        }

        for (let i = 0; i < batch.files.length; i++) {
          const file = batch.files[i];
          const media = batch.fileMediaInfo[i];
          const card = batch.fileCards[i];
          const { error: fileError } = await supabase.from('submission_files').insert({
            submission_id: submission.id,
            file_name: file.name,
            file_type: file.type || 'application/octet-stream',
            file_size: file.size || 0,
            file_url: uploadedFiles[i].path,
            media_format: media?.format || null,
            aspect_ratio: media?.aspectRatio || null,
            width: media?.width || null,
            height: media?.height || null,
            copy_headline: batch.isCarousel ? card?.headline?.trim() || null : null,
            copy_body: batch.isCarousel ? card?.body?.trim() || null : null,
          });
          if (fileError) {
            throw new Error(
              `Batch ${bIdx + 1} (${batch.batchName}) — file record insert failed for "${file.name}": ${fileError.message}`
            );
          }
        }

        setSavedBatchIds((prev) => {
          const next = new Set(prev);
          next.add(batch.id);
          return next;
        });

        const { data: { session } } = await supabase.auth.getSession();
        const syncHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
        if (session?.access_token) syncHeaders.Authorization = `Bearer ${session.access_token}`;
        const syncOnce = (notify: boolean) =>
          fetch('/api/submissions/sync-drive', {
            method: 'POST',
            headers: syncHeaders,
            body: JSON.stringify({ submission_id: submission.id, notify }),
          });
        void syncOnce(true)
          .then(async (res) => {
            if (res.ok) return;
            const result = await res.json().catch(() => null);
            if (result?.retryable) await syncOnce(false);
          })
          .catch((e) => {
            console.warn('Dropbox sync trigger failed (non-fatal):', e);
          });
      }

      setUploadPct(100);
      setUploadProgress(null);
      const freshName = await fetchBatchName();
      setSubmitMessage({
        type: 'success',
        text: `${batches.length} batch${batches.length > 1 ? 'es' : ''} submitted — ${batches.reduce((s, b) => s + b.files.length, 0)} files uploaded`,
      });
      const fresh = createEmptyBatch(freshName);
      setBatches([fresh]);
      setActiveBatchId(fresh.id);
      setSavedBatchIds(new Set());
      if (onSubmit) onSubmit(batches);
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

  const fileDupeWarnings = useMemo(() => {
    const warnings: Record<string, Record<number, string>> = {};
    for (const batch of batches) {
      const batchWarnings: Record<number, string> = {};
      const seenInBatch = new Map<string, number>();
      for (let i = 0; i < batch.files.length; i++) {
        const name = batch.files[i].name;
        if (seenInBatch.has(name)) {
          batchWarnings[i] = 'Duplicate in this batch';
          const firstIdx = seenInBatch.get(name)!;
          if (!batchWarnings[firstIdx]) batchWarnings[firstIdx] = 'Duplicate in this batch';
        } else {
          seenInBatch.set(name, i);
        }
        if (!batchWarnings[i] && existingFiles.has(name)) {
          batchWarnings[i] = `Already uploaded in ${existingFiles.get(name)}`;
        }
      }
      warnings[batch.id] = batchWarnings;
    }
    return warnings;
  }, [batches, existingFiles]);

  const namesReady = batches.every((b) => b.batchName && b.batchName !== '…');

  const stats = useMemo(
    () => ({
      batchCount: batches.length,
      totalFiles: batches.reduce((sum, b) => sum + b.files.length, 0),
      totalSize: batches.reduce((sum, b) => sum + b.files.reduce((s, f) => s + f.size, 0), 0),
    }),
    [batches]
  );

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

  if (!brandId || !activeBatch) {
    if (!brandLocked && brands.length > 1 && !brandId) {
      return <BrandPicker brands={brands} value={brandId} onChange={setBrandId} />;
    }
    if (brands.length === 0 && !selectedBrandId) {
      return <p className="text-sm text-gray-500">No brand is available for this account.</p>;
    }
    return (
      <div className="flex items-center justify-center py-24">
        <Loader className="w-6 h-6 text-[#C8B89A] animate-spin" />
      </div>
    );
  }

  const batch = activeBatch;
  const dupes = fileDupeWarnings[batch.id] || {};

  return (
    <div className="pb-24">
      {submitMessage && (
        <div
          className={`fixed top-4 right-4 z-50 p-4 rounded-lg flex items-center gap-3 backdrop-blur-sm border shadow-lg ${
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
            type="button"
            onClick={() => setSubmitMessage(null)}
            className="ml-2 text-white/50 hover:text-white/80"
          >
            ×
          </button>
        </div>
      )}

      <div className="max-w-3xl space-y-4">
        {brandLocked ? (
          <p className="text-sm text-[#ABABAB]">
            Brand <span className="text-[#F5F5F8]">{activeBrand?.name || 'your brand'}</span>
          </p>
        ) : (
          <BrandPicker brands={brands} value={brandId} onChange={setBrandId} />
        )}

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
                  style={{ color: isActive ? '#F5F5F8' : '#ABABAB', fontWeight: isActive ? 600 : 400 }}
                >
                  <span>Batch {i + 1}</span>
                  <span
                    className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                    style={{
                      backgroundColor: isActive ? 'rgba(200,184,154,0.15)' : 'rgba(255,255,255,0.06)',
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
          </div>
        </div>

        <div className="rounded-xl p-4 flex items-center justify-between gap-3" style={cardStyle}>
          <div className="min-w-0">
            <span className={sectionLabelClass} style={{ marginBottom: 4 }}>
              Batch name
            </span>
            <p className="text-sm font-semibold truncate" style={{ color: '#C8B89A' }}>
              {batch.batchName}
            </p>
          </div>
          <CopyButton text={batch.batchName} />
        </div>

        <div className="rounded-xl p-4" style={cardStyle}>
          <div className="flex items-center gap-2 mb-3">
            <FileText className="w-4 h-4 text-[#C8B89A]" />
            <span className="text-sm font-medium text-gray-200">Files</span>
            {batch.files.length > 0 && (
              <span className="text-xs text-gray-500">
                {batch.files.length} file{batch.files.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          <FileUploader
            files={batch.files}
            compact={batch.files.length > 0}
            onFilesChange={(files: File[]) => updateBatch(batch.id, { files })}
            onMediaInfoChange={(index: number, info: FileMediaInfo) => {
              setBatches((prev) =>
                prev.map((b) =>
                  b.id === batch.id
                    ? { ...b, fileMediaInfo: { ...b.fileMediaInfo, [index]: info } }
                    : b
                )
              );
            }}
            mediaInfo={batch.fileMediaInfo}
            maxFileSize={2 * 1024 * 1024 * 1024}
          />
          {batch.files.length > 0 && (
            <>
              <p className="text-[10px] text-gray-600 mt-3 mb-2">Drag to reorder. Files keep these names in Dropbox.</p>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {batch.files.map((file, fileIndex) => (
                  <AssetThumbnail
                    key={`${file.name}-${fileIndex}`}
                    file={file}
                    index={fileIndex}
                    mediaInfo={batch.fileMediaInfo[fileIndex]}
                    isSelected={false}
                    isTagged={false}
                    dupeWarning={dupes[fileIndex] || ''}
                    onClick={() => {}}
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
          {batch.errors.files && (
            <div
              className="mt-3 rounded-lg px-3 py-2 flex items-center gap-2 text-xs"
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

        <div className="rounded-xl p-4 space-y-4" style={cardStyle}>
          <span className={sectionLabelClass}>Optional</span>
          <textarea
            value={batch.notes}
            rows={2}
            placeholder="Note for the media buyer"
            onChange={(e) => updateBatch(batch.id, { notes: e.target.value })}
            className={inputClass}
            style={inputStyle}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              type="text"
              placeholder="Creator name"
              value={batch.creatorName}
              onChange={(e) => updateBatch(batch.id, { creatorName: e.target.value })}
              className={inputClass}
              style={inputStyle}
            />
            <input
              type="text"
              placeholder="Creator @handle"
              value={batch.creatorSocialHandle}
              onChange={(e) => updateBatch(batch.id, { creatorSocialHandle: e.target.value })}
              className={inputClass}
              style={inputStyle}
            />
          </div>
          <input
            type="url"
            placeholder="Landing page URL"
            value={batch.landingPageUrl}
            onChange={(e) => updateBatch(batch.id, { landingPageUrl: e.target.value })}
            className={inputClass}
            style={inputStyle}
          />
          <select
            value={batch.copyTemplate}
            onChange={(e) => updateBatch(batch.id, { copyTemplate: e.target.value })}
            className={inputClass}
            style={inputStyle}
          >
            <option value="">No copy template</option>
            {copyTemplateOptions.map((tpl) => (
              <option key={tpl.id} value={tpl.title}>
                {tpl.title}
              </option>
            ))}
          </select>
          <div className="flex flex-wrap gap-2">
            {toggles.map(({ key, icon: Icon, label, exclusive }) => {
              const checked = batch[key];
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    const updates: Partial<BatchFormState> = { [key]: !checked };
                    if (!checked && exclusive) updates[exclusive] = false;
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
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {batch.isCarousel && (
          <div className="rounded-xl p-4 space-y-3" style={cardStyle}>
            <span className={sectionLabelClass}>Carousel copy</span>
            <textarea
              value={batch.primaryText}
              rows={3}
              placeholder="Primary text (optional)"
              onChange={(e) => updateBatch(batch.id, { primaryText: e.target.value })}
              className={inputClass}
              style={inputStyle}
            />
            {batch.files.length > 0 && (
              <div className="space-y-2">
                {batch.files.map((file, fileIndex) => {
                  const card = batch.fileCards[fileIndex] || { headline: '', body: '' };
                  return (
                    <div
                      key={fileIndex}
                      className="rounded-lg p-3"
                      style={{
                        backgroundColor: 'rgba(255,255,255,0.03)',
                        border: '1px solid rgba(255,255,255,0.08)',
                      }}
                    >
                      <p className="text-[10px] text-gray-500 mb-2 truncate">
                        Card {fileIndex + 1} — {file.name}
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <input
                          type="text"
                          placeholder="Headline"
                          value={card.headline}
                          onChange={(e) =>
                            updateBatch(batch.id, {
                              fileCards: {
                                ...batch.fileCards,
                                [fileIndex]: { ...card, headline: e.target.value },
                              },
                            })
                          }
                          className={inputClass}
                          style={inputStyle}
                        />
                        <input
                          type="text"
                          placeholder="Description"
                          value={card.body}
                          onChange={(e) =>
                            updateBatch(batch.id, {
                              fileCards: {
                                ...batch.fileCards,
                                [fileIndex]: { ...card, body: e.target.value },
                              },
                            })
                          }
                          className={inputClass}
                          style={inputStyle}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      <div
        className="fixed bottom-0 left-0 right-0 z-40"
        style={{
          backgroundColor: 'rgba(10,10,10,0.95)',
          backdropFilter: 'blur(12px)',
          borderTop: '1px solid rgba(255,255,255,0.06)',
        }}
      >
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
              <span className="text-[#F5F5F8] font-semibold">{formatSize(stats.totalSize)}</span>
            </div>
            {uploadProgress && (
              <span className="text-[#C8B89A] text-xs animate-pulse ml-2 hidden md:inline">
                {uploadProgress}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting || isLoading || !namesReady}
            className="px-8 py-2.5 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-[#0A0A0A] font-semibold text-sm flex items-center gap-2 transition-all"
            style={{ background: 'linear-gradient(135deg, #C8B89A 0%, #A89474 100%)' }}
          >
            {isSubmitting || isLoading ? (
              <>
                <Loader className="w-4 h-4 animate-spin" />
                Uploading{uploadPct !== null ? ` ${uploadPct}%` : '...'}
              </>
            ) : (
              <>
                <Upload className="w-4 h-4" />
                Submit
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

function BrandPicker({
  brands,
  value,
  onChange,
}: {
  brands: Brand[];
  value?: string;
  onChange: (id: string) => void;
}) {
  return (
    <label className="block">
      <span className={sectionLabelClass}>Brand</span>
      <select
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass}
        style={inputStyle}
      >
        <option value="" disabled>
          Choose a brand
        </option>
        {brands.map((brand) => (
          <option key={brand.id} value={brand.id}>
            {brand.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export default SubmissionForm;
