'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Loader,
  FlaskConical,
  ChevronRight,
  Copy,
  Check,
  RefreshCw,
  Sparkles,
  ExternalLink,
  ArrowLeft,
  Wand2,
  Package,
  Globe,
  MessageSquare,
  Palette,
  FileText,
  Save,
  AlignLeft,
  Heading,
  Type,
  ChevronDown,
} from 'lucide-react';
import Navbar from '@/components/Navbar';
import { createClient } from '@/lib/supabase';

// ─── Brand Palette ──────────────────────────────────────────────
const GOLD = '#C8B89A';
const GOLD_LIGHT = '#D9CBAE';
const GOLD_DIM = 'rgba(200,184,154,0.18)';
const GOLD_BORDER = 'rgba(200,184,154,0.30)';
const BG_CARD = '#111111';
const BG_HEADER = '#161616';
const BORDER = 'rgba(200,184,154,0.10)';
const BORDER_STRONG = 'rgba(200,184,154,0.18)';
const TEXT_PRIMARY = '#F5F5F8';
const TEXT_MUTED = '#999';
const TEXT_DIM = '#666';

// ─── Types ──────────────────────────────────────────────────────

interface Batch {
  id: string;
  batch_name: string;
  brand_id: string;
  brand_name: string;
  creative_type: string;
  creator_name: string;
  batch_status: string;
  created_at: string;
  copy_headline: string | null;
  copy_body: string | null;
  copy_cta: string | null;
  copy_title: string | null;
  landing_page_url: string | null;
  notes: string | null;
  file_count: number;
}

interface GeneratedCopy {
  primary_texts: { label: string; text: string }[];
  headlines: string[];
  descriptions: string[];
}

interface CopyTemplate {
  id: string;
  brand_id: string;
  title: string;
  primary_texts: string[];
  headlines: string[];
  descriptions: string[];
  landing_page_url: string;
  created_at: string;
  updated_at: string;
}

// ─── Tone Options ───────────────────────────────────────────────

const TONES = [
  { value: 'bold', label: 'Bold & Direct', emoji: '🔥' },
  { value: 'friendly', label: 'Friendly & Warm', emoji: '😊' },
  { value: 'premium', label: 'Premium & Elevated', emoji: '✨' },
  { value: 'urgent', label: 'Urgent & Scarcity', emoji: '⏰' },
  { value: 'playful', label: 'Playful & Fun', emoji: '🎉' },
  { value: 'educational', label: 'Educational', emoji: '📚' },
];

// ─── Copy-to-clipboard helper ───────────────────────────────────

function useCopyToClipboard() {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copy = useCallback((text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  }, []);

  return { copiedId, copy };
}

// ═════════════════════════════════════════════════════════════════
// ─── Sub-Components ─────────────────────────────────────────────
// ═════════════════════════════════════════════════════════════════

function BatchCard({
  batch,
  onClick,
}: {
  batch: Batch;
  onClick: () => void;
}) {
  const statusColor = batch.batch_status === 'new' ? '#E8A838' : batch.batch_status === 'building' ? '#5DADE2' : '#58D68D';
  const hasCopy = batch.copy_headline || batch.copy_body;

  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-xl p-4 flex items-center gap-4 transition-all group"
      style={{
        backgroundColor: BG_CARD,
        border: `1px solid ${BORDER_STRONG}`,
      }}
    >
      {/* Status dot */}
      <div className="flex flex-col items-center gap-1">
        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: statusColor }} />
        <span className="text-[8px] font-bold uppercase" style={{ color: statusColor }}>
          {batch.batch_status}
        </span>
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-bold truncate" style={{ color: TEXT_PRIMARY }}>{batch.batch_name}</h4>
          {hasCopy && (
            <span className="text-[8px] font-bold px-1.5 py-0.5 rounded uppercase" style={{ backgroundColor: '#2ECC7115', color: '#2ECC71', border: '1px solid #2ECC7130' }}>
              Has Copy
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 mt-1">
          <span className="text-xs" style={{ color: GOLD }}>{batch.brand_name}</span>
          <span className="text-[10px]" style={{ color: TEXT_DIM }}>{batch.creative_type}</span>
          <span className="text-[10px]" style={{ color: TEXT_DIM }}>{batch.file_count} file{batch.file_count !== 1 ? 's' : ''}</span>
          {batch.creator_name && (
            <span className="text-[10px]" style={{ color: TEXT_DIM }}>by {batch.creator_name}</span>
          )}
        </div>
      </div>

      {/* Arrow */}
      <ChevronRight size={16} style={{ color: TEXT_DIM }} className="group-hover:translate-x-0.5 transition-transform" />
    </button>
  );
}

function CopyBlock({
  id,
  label,
  text,
  color,
  copiedId,
  onCopy,
}: {
  id: string;
  label: string;
  text: string;
  color: string;
  copiedId: string | null;
  onCopy: (text: string, id: string) => void;
}) {
  const isCopied = copiedId === id;
  return (
    <div
      className="rounded-lg p-3 relative group"
      style={{ backgroundColor: `${color}08`, border: `1px solid ${color}15` }}
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color }}>{label}</span>
        <button
          onClick={() => onCopy(text, id)}
          className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-all opacity-0 group-hover:opacity-100"
          style={{
            backgroundColor: isCopied ? '#2ECC7120' : 'rgba(255,255,255,0.06)',
            color: isCopied ? '#2ECC71' : TEXT_MUTED,
          }}
        >
          {isCopied ? <Check size={10} /> : <Copy size={10} />}
          {isCopied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: '#DDD' }}>{text}</p>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════
// ─── Main Page ──────────────────────────────────────────────────
// ═════════════════════════════════════════════════════════════════

export default function AdLabPage() {
  const router = useRouter();
  const supabase = createClient();
  const { copiedId, copy } = useCopyToClipboard();

  const [loading, setLoading] = useState(true);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [selectedBatch, setSelectedBatch] = useState<Batch | null>(null);

  // Brief form
  const [product, setProduct] = useState('');
  const [destinationUrl, setDestinationUrl] = useState('');
  const [tone, setTone] = useState('bold');
  const [extraContext, setExtraContext] = useState('');

  // Generation state
  const [generating, setGenerating] = useState(false);
  const [generatedCopy, setGeneratedCopy] = useState<GeneratedCopy | null>(null);
  const [genError, setGenError] = useState('');

  // Save state
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Toast
  const [toast, setToast] = useState('');
  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2500); };

  // Copy Templates
  const [brandTemplates, setBrandTemplates] = useState<CopyTemplate[]>([]);
  const [templatesExpanded, setTemplatesExpanded] = useState(true);
  const [loadingTemplates, setLoadingTemplates] = useState(false);

  const getAuthHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return {};
    return { Authorization: `Bearer ${session.access_token}` };
  }, [supabase]);

  // ─── Fetch Batches ────────────────────────────────────────────

  useEffect(() => {
    const fetchData = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push('/'); return; }

      const { data: profile } = await supabase
        .from('users_profile')
        .select('role')
        .eq('id', session.user.id)
        .single();

      if (!profile || profile.role !== 'admin') { router.push('/'); return; }

      // Fetch recent batches (newest first, non-launched)
      const { data: subs } = await supabase
        .from('submissions')
        .select('id, batch_name, brand_id, creative_type, creator_name, batch_status, created_at, copy_headline, copy_body, copy_cta, copy_title, landing_page_url, notes, brands:brand_id(name)')
        .in('batch_status', ['new', 'building', 'ready'])
        .order('created_at', { ascending: false })
        .limit(50);

      // Get file counts
      const ids = (subs || []).map((s: any) => s.id);
      let fileCounts: Record<string, number> = {};
      if (ids.length > 0) {
        const { data: files } = await supabase
          .from('submission_files')
          .select('submission_id');

        if (files) {
          for (const f of files) {
            fileCounts[f.submission_id] = (fileCounts[f.submission_id] || 0) + 1;
          }
        }
      }

      setBatches(
        (subs || []).map((s: any) => ({
          id: s.id,
          batch_name: s.batch_name,
          brand_id: s.brand_id,
          brand_name: s.brands?.name || 'Unknown',
          creative_type: s.creative_type || 'mixed',
          creator_name: s.creator_name || '',
          batch_status: s.batch_status || 'new',
          created_at: s.created_at,
          copy_headline: s.copy_headline,
          copy_body: s.copy_body,
          copy_cta: s.copy_cta,
          copy_title: s.copy_title,
          landing_page_url: s.landing_page_url,
          notes: s.notes,
          file_count: fileCounts[s.id] || 0,
        }))
      );

      setLoading(false);
    };
    fetchData();
  }, [supabase, router]);

  // ─── Fetch templates for selected batch's brand ────────────────

  useEffect(() => {
    if (!selectedBatch) { setBrandTemplates([]); return; }
    (async () => {
      setLoadingTemplates(true);
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/copy-templates?brand_id=${selectedBatch.brand_id}`, { headers });
      if (res.ok) {
        const { templates } = await res.json();
        setBrandTemplates(templates || []);
      }
      setLoadingTemplates(false);
    })();
  }, [selectedBatch?.brand_id, getAuthHeaders]);

  // ─── Select a batch ───────────────────────────────────────────

  const handleSelectBatch = (batch: Batch) => {
    setSelectedBatch(batch);
    setProduct('');
    setDestinationUrl(batch.landing_page_url || '');
    setTone('bold');
    setExtraContext(batch.notes || '');
    setGeneratedCopy(null);
    setGenError('');
    setSaved(false);
  };

  // ─── Generate Copy ────────────────────────────────────────────

  const handleGenerate = useCallback(async () => {
    if (!selectedBatch || !product.trim()) return;

    setGenerating(true);
    setGenError('');
    setGeneratedCopy(null);
    setSaved(false);

    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/ad-lab/generate', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brand_name: selectedBatch.brand_name,
          product: product.trim(),
          destination_url: destinationUrl.trim() || undefined,
          tone,
          creative_type: selectedBatch.creative_type,
          extra_context: extraContext.trim() || undefined,
        }),
      });

      const json = await res.json();
      if (res.ok && json.copy) {
        setGeneratedCopy(json.copy);
      } else {
        setGenError(json.error || 'Generation failed');
      }
    } catch {
      setGenError('Network error — try again');
    }
    setGenerating(false);
  }, [selectedBatch, product, destinationUrl, tone, extraContext, getAuthHeaders]);

  // ─── Save to submission ───────────────────────────────────────

  const handleSave = useCallback(async () => {
    if (!selectedBatch || !generatedCopy) return;
    setSaving(true);

    const bestPrimary = generatedCopy.primary_texts[0]?.text || '';
    const bestHeadline = generatedCopy.headlines[0] || '';
    const bestDescription = generatedCopy.descriptions[0] || '';

    const { error } = await supabase
      .from('submissions')
      .update({
        copy_body: bestPrimary,
        copy_headline: bestHeadline,
        copy_cta: bestDescription,
        landing_page_url: destinationUrl.trim() || selectedBatch.landing_page_url,
      })
      .eq('id', selectedBatch.id);

    if (error) {
      showToast('Failed to save');
    } else {
      setSaved(true);
      // Update local state
      setBatches((prev) =>
        prev.map((b) =>
          b.id === selectedBatch.id
            ? { ...b, copy_body: bestPrimary, copy_headline: bestHeadline, copy_cta: bestDescription }
            : b
        )
      );
      showToast('Copy saved to submission');
    }
    setSaving(false);
  }, [selectedBatch, generatedCopy, destinationUrl, supabase]);

  // ─── Copy All ─────────────────────────────────────────────────

  const handleCopyAll = useCallback(() => {
    if (!generatedCopy) return;
    const lines: string[] = [];
    lines.push('=== PRIMARY TEXT ===\n');
    generatedCopy.primary_texts.forEach((pt) => {
      lines.push(`[${pt.label}]`);
      lines.push(pt.text);
      lines.push('');
    });
    lines.push('\n=== HEADLINES ===\n');
    generatedCopy.headlines.forEach((h, i) => lines.push(`${i + 1}. ${h}`));
    lines.push('\n\n=== DESCRIPTIONS ===\n');
    generatedCopy.descriptions.forEach((d, i) => lines.push(`${i + 1}. ${d}`));
    copy(lines.join('\n'), 'all');
  }, [generatedCopy, copy]);

  // ─── Loading ──────────────────────────────────────────────────

  if (loading) {
    return (
      <Navbar>
        <div className="min-h-screen flex items-center justify-center">
          <Loader className="w-8 h-8 animate-spin" style={{ color: GOLD }} />
        </div>
      </Navbar>
    );
  }

  // ═════════════════════════════════════════════════════════════════
  // ─── Render ─────────────────────────────────────────────────────
  // ═════════════════════════════════════════════════════════════════

  return (
    <Navbar>
      <div className="p-6 md:p-8 max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-2">
            <FlaskConical size={24} style={{ color: GOLD_LIGHT }} />
            <h1 className="text-2xl font-bold tracking-tight" style={{ color: TEXT_PRIMARY }}>
              Ad Lab
            </h1>
            <span
              className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
              style={{ backgroundColor: 'rgba(200,184,154,0.15)', color: GOLD }}
            >
              Beta
            </span>
          </div>
          <p className="text-sm" style={{ color: TEXT_DIM }}>
            Select a batch, drop in some context, and generate high-converting Meta ad copy with AI.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* ─── Left: Batch Queue ──────────────────────────── */}
          <div className={`${selectedBatch ? 'hidden lg:block' : ''} lg:col-span-4`}>
            <div
              className="rounded-xl overflow-hidden"
              style={{ backgroundColor: BG_CARD, border: `1px solid ${BORDER_STRONG}` }}
            >
              <div className="px-4 py-3" style={{ backgroundColor: BG_HEADER, borderBottom: `1px solid ${BORDER}` }}>
                <h2 className="text-xs font-bold uppercase tracking-wider" style={{ color: GOLD }}>
                  Batch Queue
                </h2>
                <p className="text-[10px] mt-0.5" style={{ color: TEXT_DIM }}>
                  {batches.length} batch{batches.length !== 1 ? 'es' : ''} awaiting copy
                </p>
              </div>
              <div className="p-3 space-y-2 max-h-[calc(100vh-220px)] overflow-y-auto">
                {batches.length > 0 ? (
                  batches.map((b) => (
                    <BatchCard
                      key={b.id}
                      batch={b}
                      onClick={() => handleSelectBatch(b)}
                    />
                  ))
                ) : (
                  <div className="py-12 text-center">
                    <Package size={24} style={{ color: TEXT_DIM }} className="mx-auto mb-2" />
                    <p className="text-xs" style={{ color: TEXT_DIM }}>No batches in the queue.</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ─── Right: Generator ───────────────────────────── */}
          <div className={`${!selectedBatch ? 'hidden lg:block' : ''} lg:col-span-8`}>
            {selectedBatch ? (
              <div className="space-y-4">
                {/* Back button (mobile) */}
                <button
                  onClick={() => { setSelectedBatch(null); setGeneratedCopy(null); }}
                  className="lg:hidden flex items-center gap-2 text-xs font-medium mb-2"
                  style={{ color: TEXT_MUTED }}
                >
                  <ArrowLeft size={14} />
                  Back to Queue
                </button>

                {/* Selected batch header */}
                <div
                  className="rounded-xl p-4"
                  style={{ backgroundColor: BG_CARD, border: `1px solid ${BORDER_STRONG}` }}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-base font-bold" style={{ color: TEXT_PRIMARY }}>{selectedBatch.batch_name}</h3>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-xs font-medium" style={{ color: GOLD }}>{selectedBatch.brand_name}</span>
                        <span className="text-[10px]" style={{ color: TEXT_DIM }}>{selectedBatch.creative_type}</span>
                        <span className="text-[10px]" style={{ color: TEXT_DIM }}>{selectedBatch.file_count} files</span>
                      </div>
                    </div>
                    <button
                      onClick={() => { setSelectedBatch(null); setGeneratedCopy(null); }}
                      className="hidden lg:flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded"
                      style={{ color: TEXT_DIM, backgroundColor: 'rgba(255,255,255,0.04)' }}
                    >
                      Change
                    </button>
                  </div>
                </div>

                {/* Brief form */}
                <div
                  className="rounded-xl p-5 space-y-4"
                  style={{ backgroundColor: BG_CARD, border: `1px solid ${BORDER_STRONG}` }}
                >
                  <h4 className="text-xs font-bold uppercase tracking-wider flex items-center gap-2" style={{ color: GOLD }}>
                    <FileText size={12} />
                    Quick Brief
                  </h4>

                  {/* Product / Offer */}
                  <div>
                    <label className="text-[10px] font-medium block mb-1.5 uppercase tracking-wider flex items-center gap-1.5" style={{ color: TEXT_DIM }}>
                      <Package size={10} />
                      Product / Offer *
                    </label>
                    <input
                      type="text"
                      value={product}
                      onChange={(e) => setProduct(e.target.value)}
                      placeholder="e.g. Beef Tallow Moisturizer — 20% off first order"
                      className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
                      style={{ backgroundColor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: TEXT_PRIMARY }}
                    />
                  </div>

                  {/* Destination */}
                  <div>
                    <label className="text-[10px] font-medium block mb-1.5 uppercase tracking-wider flex items-center gap-1.5" style={{ color: TEXT_DIM }}>
                      <Globe size={10} />
                      Destination URL
                    </label>
                    <input
                      type="text"
                      value={destinationUrl}
                      onChange={(e) => setDestinationUrl(e.target.value)}
                      placeholder="https://..."
                      className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
                      style={{ backgroundColor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: TEXT_PRIMARY }}
                    />
                  </div>

                  {/* Tone */}
                  <div>
                    <label className="text-[10px] font-medium block mb-1.5 uppercase tracking-wider flex items-center gap-1.5" style={{ color: TEXT_DIM }}>
                      <Palette size={10} />
                      Tone
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {TONES.map((t) => (
                        <button
                          key={t.value}
                          onClick={() => setTone(t.value)}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                          style={{
                            backgroundColor: tone === t.value ? GOLD_DIM : 'rgba(255,255,255,0.04)',
                            color: tone === t.value ? GOLD : TEXT_MUTED,
                            border: `1px solid ${tone === t.value ? GOLD_BORDER : 'rgba(255,255,255,0.06)'}`,
                          }}
                        >
                          {t.emoji} {t.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Extra context */}
                  <div>
                    <label className="text-[10px] font-medium block mb-1.5 uppercase tracking-wider flex items-center gap-1.5" style={{ color: TEXT_DIM }}>
                      <MessageSquare size={10} />
                      Additional Context
                    </label>
                    <textarea
                      value={extraContext}
                      onChange={(e) => setExtraContext(e.target.value)}
                      placeholder="Any extra details — target audience, key ingredients, unique selling points..."
                      rows={2}
                      className="w-full px-3 py-2.5 rounded-lg text-sm outline-none resize-none"
                      style={{ backgroundColor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: TEXT_PRIMARY }}
                    />
                  </div>

                  {/* Generate button */}
                  <button
                    onClick={handleGenerate}
                    disabled={!product.trim() || generating}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-sm font-bold transition-all"
                    style={{
                      backgroundColor: product.trim() && !generating ? GOLD : `${GOLD}30`,
                      color: product.trim() && !generating ? '#0A0A0A' : '#666',
                      opacity: generating ? 0.7 : 1,
                    }}
                  >
                    {generating ? (
                      <>
                        <Loader size={16} className="animate-spin" />
                        Generating with Claude...
                      </>
                    ) : (
                      <>
                        <Wand2 size={16} />
                        Generate Ad Copy
                      </>
                    )}
                  </button>
                </div>

                {/* Error */}
                {genError && (
                  <div
                    className="rounded-lg p-3 text-xs"
                    style={{ backgroundColor: '#E74C3C15', color: '#E74C3C', border: '1px solid #E74C3C30' }}
                  >
                    {genError}
                  </div>
                )}

                {/* ─── Generated Results ─────────────────────── */}
                {generatedCopy && (
                  <div
                    className="rounded-xl overflow-hidden"
                    style={{ backgroundColor: BG_CARD, border: `1px solid ${GOLD_BORDER}`, boxShadow: '0 4px 24px rgba(200,184,154,0.08)' }}
                  >
                    {/* Results header */}
                    <div
                      className="px-5 py-3 flex items-center justify-between"
                      style={{ backgroundColor: BG_HEADER, borderBottom: `1px solid ${BORDER}` }}
                    >
                      <div className="flex items-center gap-2">
                        <Sparkles size={14} style={{ color: GOLD }} />
                        <span className="text-xs font-bold uppercase tracking-wider" style={{ color: GOLD }}>
                          Generated Copy
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={handleCopyAll}
                          className="flex items-center gap-1 px-2.5 py-1 rounded text-[10px] font-medium transition-all"
                          style={{
                            backgroundColor: copiedId === 'all' ? '#2ECC7115' : 'rgba(255,255,255,0.06)',
                            color: copiedId === 'all' ? '#2ECC71' : TEXT_MUTED,
                          }}
                        >
                          {copiedId === 'all' ? <Check size={10} /> : <Copy size={10} />}
                          {copiedId === 'all' ? 'Copied All' : 'Copy All'}
                        </button>
                        <button
                          onClick={handleSave}
                          disabled={saving || saved}
                          className="flex items-center gap-1 px-2.5 py-1 rounded text-[10px] font-bold transition-all"
                          style={{
                            backgroundColor: saved ? '#2ECC7115' : GOLD_DIM,
                            color: saved ? '#2ECC71' : GOLD,
                            border: `1px solid ${saved ? '#2ECC7130' : GOLD_BORDER}`,
                          }}
                        >
                          {saved ? <Check size={10} /> : <Save size={10} />}
                          {saved ? 'Saved' : saving ? 'Saving...' : 'Save to Batch'}
                        </button>
                        <button
                          onClick={handleGenerate}
                          disabled={generating}
                          className="flex items-center gap-1 px-2.5 py-1 rounded text-[10px] font-medium"
                          style={{ backgroundColor: 'rgba(255,255,255,0.06)', color: TEXT_MUTED }}
                          title="Regenerate"
                        >
                          <RefreshCw size={10} className={generating ? 'animate-spin' : ''} />
                          Redo
                        </button>
                      </div>
                    </div>

                    <div className="p-5 space-y-5">
                      {/* Primary Texts */}
                      <div>
                        <h5 className="text-[11px] font-bold uppercase tracking-wider mb-3" style={{ color: TEXT_MUTED }}>
                          Primary Text ({generatedCopy.primary_texts.length} variants)
                        </h5>
                        <div className="space-y-3">
                          {generatedCopy.primary_texts.map((pt, i) => (
                            <CopyBlock
                              key={i}
                              id={`pt-${i}`}
                              label={pt.label}
                              text={pt.text}
                              color="#5DADE2"
                              copiedId={copiedId}
                              onCopy={copy}
                            />
                          ))}
                        </div>
                      </div>

                      {/* Headlines */}
                      <div>
                        <h5 className="text-[11px] font-bold uppercase tracking-wider mb-3" style={{ color: TEXT_MUTED }}>
                          Headlines ({generatedCopy.headlines.length})
                        </h5>
                        <div className="space-y-1.5">
                          {generatedCopy.headlines.map((h, i) => (
                            <div
                              key={i}
                              className="flex items-center justify-between px-3 py-2 rounded-lg group"
                              style={{ backgroundColor: '#E8A83808', border: '1px solid #E8A83815' }}
                            >
                              <span className="text-sm font-medium" style={{ color: '#DDD' }}>{h}</span>
                              <button
                                onClick={() => copy(h, `h-${i}`)}
                                className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded"
                                style={{ color: copiedId === `h-${i}` ? '#2ECC71' : TEXT_DIM }}
                              >
                                {copiedId === `h-${i}` ? <Check size={12} /> : <Copy size={12} />}
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Descriptions */}
                      <div>
                        <h5 className="text-[11px] font-bold uppercase tracking-wider mb-3" style={{ color: TEXT_MUTED }}>
                          Descriptions ({generatedCopy.descriptions.length})
                        </h5>
                        <div className="space-y-1.5">
                          {generatedCopy.descriptions.map((d, i) => (
                            <div
                              key={i}
                              className="flex items-center justify-between px-3 py-2 rounded-lg group"
                              style={{ backgroundColor: '#2ECC7108', border: '1px solid #2ECC7115' }}
                            >
                              <span className="text-sm" style={{ color: '#DDD' }}>{d}</span>
                              <button
                                onClick={() => copy(d, `d-${i}`)}
                                className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded"
                                style={{ color: copiedId === `d-${i}` ? '#2ECC71' : TEXT_DIM }}
                              >
                                {copiedId === `d-${i}` ? <Check size={12} /> : <Copy size={12} />}
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* No batch selected — placeholder */
              <div
                className="rounded-xl py-24 flex flex-col items-center justify-center"
                style={{ backgroundColor: BG_CARD, border: `1px solid ${BORDER_STRONG}` }}
              >
                <FlaskConical size={40} style={{ color: TEXT_DIM }} className="mb-4" />
                <p className="text-sm font-medium" style={{ color: TEXT_MUTED }}>Select a batch from the queue to get started</p>
                <p className="text-xs mt-1" style={{ color: TEXT_DIM }}>
                  Drop in some context and generate ad copy in seconds
                </p>
              </div>
            )}
          </div>
        </div>

        {/* ─── Copy Templates Library ───────────────────────── */}
        {selectedBatch && brandTemplates.length > 0 && (
          <div className="mt-6">
            <button
              onClick={() => setTemplatesExpanded(!templatesExpanded)}
              className="flex items-center gap-2 mb-3 group"
            >
              <ChevronDown
                size={14}
                className="transition-transform"
                style={{
                  color: GOLD,
                  transform: templatesExpanded ? 'rotate(0deg)' : 'rotate(-90deg)',
                }}
              />
              <FileText size={15} style={{ color: GOLD }} />
              <span className="text-xs font-bold uppercase tracking-wider" style={{ color: GOLD }}>
                Copy Templates — {selectedBatch.brand_name}
              </span>
              <span className="text-[10px]" style={{ color: TEXT_DIM }}>
                ({brandTemplates.length} template{brandTemplates.length !== 1 ? 's' : ''})
              </span>
            </button>

            {templatesExpanded && (
              <div className="grid gap-3">
                {brandTemplates.map((t) => (
                  <div
                    key={t.id}
                    className="rounded-xl overflow-hidden transition-all"
                    style={{ background: BG_CARD, border: `1px solid ${BORDER_STRONG}` }}
                  >
                    {/* Template header */}
                    <div
                      className="flex items-center justify-between px-4 py-2.5"
                      style={{ background: BG_HEADER, borderBottom: `1px solid ${BORDER}` }}
                    >
                      <div className="flex items-center gap-2">
                        <FileText size={13} style={{ color: GOLD }} />
                        <span className="text-xs font-semibold" style={{ color: TEXT_PRIMARY }}>
                          {t.title}
                        </span>
                      </div>
                      {t.landing_page_url && (
                        <a
                          href={t.landing_page_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-[10px] hover:underline"
                          style={{ color: GOLD }}
                        >
                          <Globe size={10} />
                          {t.landing_page_url.replace(/^https?:\/\//, '').slice(0, 40)}
                        </a>
                      )}
                    </div>

                    {/* Template body */}
                    <div className="px-4 py-3 space-y-3">
                      {/* Primary Texts */}
                      {t.primary_texts.length > 0 && (
                        <div>
                          <div className="flex items-center gap-1.5 mb-1.5">
                            <AlignLeft size={11} style={{ color: GOLD }} />
                            <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: GOLD }}>
                              Primary Text
                            </span>
                          </div>
                          <div className="space-y-1">
                            {t.primary_texts.map((text, i) => (
                              <div
                                key={i}
                                className="group flex items-start gap-2 px-2.5 py-1.5 rounded-lg text-[11px] leading-relaxed cursor-pointer transition-colors hover:bg-white/5"
                                style={{ background: '#0a0a0a', color: TEXT_PRIMARY }}
                                onClick={() => { copy(text, `tpl-pt-${t.id}-${i}`); showToast('Copied!'); }}
                              >
                                <span className="shrink-0 text-[10px] mt-0.5" style={{ color: TEXT_DIM }}>{i + 1}.</span>
                                <span className="flex-1">{text}</span>
                                {copiedId === `tpl-pt-${t.id}-${i}` ? (
                                  <Check size={11} style={{ color: '#4CAF50' }} className="shrink-0 mt-0.5" />
                                ) : (
                                  <Copy size={11} style={{ color: TEXT_DIM }} className="shrink-0 mt-0.5 opacity-0 group-hover:opacity-100" />
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Headlines + Descriptions side by side */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {t.headlines.length > 0 && (
                          <div>
                            <div className="flex items-center gap-1.5 mb-1.5">
                              <Heading size={11} style={{ color: GOLD }} />
                              <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: GOLD }}>
                                Headlines
                              </span>
                            </div>
                            <div className="space-y-1">
                              {t.headlines.map((h, i) => (
                                <div
                                  key={i}
                                  className="group flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] cursor-pointer hover:bg-white/5"
                                  style={{ background: '#0a0a0a', color: TEXT_PRIMARY }}
                                  onClick={() => { copy(h, `tpl-h-${t.id}-${i}`); showToast('Copied!'); }}
                                >
                                  <span className="flex-1">{h}</span>
                                  {copiedId === `tpl-h-${t.id}-${i}` ? (
                                    <Check size={11} style={{ color: '#4CAF50' }} className="shrink-0" />
                                  ) : (
                                    <Copy size={11} style={{ color: TEXT_DIM }} className="shrink-0 opacity-0 group-hover:opacity-100" />
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {t.descriptions.length > 0 && (
                          <div>
                            <div className="flex items-center gap-1.5 mb-1.5">
                              <Type size={11} style={{ color: GOLD }} />
                              <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: GOLD }}>
                                Descriptions
                              </span>
                            </div>
                            <div className="space-y-1">
                              {t.descriptions.map((d, i) => (
                                <div
                                  key={i}
                                  className="group flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] cursor-pointer hover:bg-white/5"
                                  style={{ background: '#0a0a0a', color: TEXT_PRIMARY }}
                                  onClick={() => { copy(d, `tpl-d-${t.id}-${i}`); showToast('Copied!'); }}
                                >
                                  <span className="flex-1">{d}</span>
                                  {copiedId === `tpl-d-${t.id}-${i}` ? (
                                    <Check size={11} style={{ color: '#4CAF50' }} className="shrink-0" />
                                  ) : (
                                    <Copy size={11} style={{ color: TEXT_DIM }} className="shrink-0 opacity-0 group-hover:opacity-100" />
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div
          className="fixed bottom-6 right-6 px-4 py-3 rounded-lg flex items-center gap-2 text-sm font-medium z-50"
          style={{ backgroundColor: `${GOLD}20`, color: GOLD, border: `1px solid ${GOLD}40` }}
        >
          <Check className="w-4 h-4" />
          {toast}
        </div>
      )}
    </Navbar>
  );
}
