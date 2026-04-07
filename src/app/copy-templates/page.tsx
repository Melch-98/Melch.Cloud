'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  FileText,
  Plus,
  Trash2,
  Pencil,
  Check,
  X,
  ChevronDown,
  Globe,
  Copy,
  Loader,
  Save,
  Type,
  AlignLeft,
  Heading,
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
const TEXT_PRIMARY = '#F5F5F8';
const TEXT_MUTED = '#999';
const TEXT_DIM = '#666';

// ─── Types ──────────────────────────────────────────────────────
interface Brand {
  id: string;
  name: string;
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

// ─── Empty template form ────────────────────────────────────────
const emptyForm = (): Omit<CopyTemplate, 'id' | 'brand_id' | 'created_at' | 'updated_at'> => ({
  title: '',
  primary_texts: ['', '', '', '', ''],
  headlines: ['', '', '', '', ''],
  descriptions: ['', ''],
  landing_page_url: '',
});

// ─── Clipboard helper ───────────────────────────────────────────
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  if (!text) return null;
  return (
    <button
      onClick={handleCopy}
      className="opacity-0 group-hover:opacity-100 transition-opacity ml-1"
      title="Copy"
    >
      {copied ? (
        <Check size={12} style={{ color: '#4CAF50' }} />
      ) : (
        <Copy size={12} style={{ color: TEXT_DIM }} />
      )}
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════
export default function CopyTemplatesPage() {
  const router = useRouter();
  const supabase = createClient();

  // ─── Auth state ─────────────────────────────────────────────────
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<string>('');
  const [userBrandId, setUserBrandId] = useState<string | null>(null);

  // ─── Data state ─────────────────────────────────────────────────
  const [brands, setBrands] = useState<Brand[]>([]);
  const [selectedBrandId, setSelectedBrandId] = useState<string>('');
  const [templates, setTemplates] = useState<CopyTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // ─── Form state ─────────────────────────────────────────────────
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm());

  // ─── Auth ───────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push('/'); return; }
      setAuthToken(session.access_token);

      const { data: profile } = await supabase
        .from('users_profile')
        .select('role, brand_id')
        .eq('id', session.user.id)
        .single();

      if (!profile || !['admin', 'strategist'].includes(profile.role)) {
        router.push('/');
        return;
      }

      setUserRole(profile.role);
      setUserBrandId(profile.brand_id);

      // Fetch brands
      if (profile.role === 'admin') {
        const { data: allBrands } = await supabase
          .from('brands')
          .select('id, name')
          .order('name');
        setBrands(allBrands || []);

        // Restore last selected brand
        const saved = localStorage.getItem('melch_selected_brand');
        if (saved && allBrands?.find((b: Brand) => b.id === saved)) {
          setSelectedBrandId(saved);
        } else if (allBrands?.length) {
          setSelectedBrandId(allBrands[0].id);
        }
      } else {
        // Strategist — locked to their brand
        if (profile.brand_id) {
          setSelectedBrandId(profile.brand_id);
          const { data: brand } = await supabase
            .from('brands')
            .select('id, name')
            .eq('id', profile.brand_id)
            .single();
          if (brand) setBrands([brand]);
        }
      }

      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Fetch templates when brand changes ─────────────────────────
  const fetchTemplates = useCallback(async () => {
    if (!authToken || !selectedBrandId) return;
    const res = await fetch(`/api/copy-templates?brand_id=${selectedBrandId}`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (res.ok) {
      const { templates: data } = await res.json();
      setTemplates(data || []);
    }
  }, [authToken, selectedBrandId]);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  // ─── Brand switch (admin) ───────────────────────────────────────
  const handleBrandChange = (id: string) => {
    setSelectedBrandId(id);
    localStorage.setItem('melch_selected_brand', id);
  };

  // ─── Form handlers ─────────────────────────────────────────────
  const openNewForm = () => {
    setEditingId(null);
    setForm(emptyForm());
    setShowForm(true);
  };

  const openEditForm = (t: CopyTemplate) => {
    setEditingId(t.id);
    setForm({
      title: t.title,
      primary_texts: [...t.primary_texts, ...Array(5).fill('')].slice(0, 5),
      headlines: [...t.headlines, ...Array(5).fill('')].slice(0, 5),
      descriptions: [...t.descriptions, ...Array(2).fill('')].slice(0, 2),
      landing_page_url: t.landing_page_url,
    });
    setShowForm(true);
  };

  const cancelForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(emptyForm());
  };

  const updateField = (
    field: 'primary_texts' | 'headlines' | 'descriptions',
    index: number,
    value: string
  ) => {
    setForm((prev) => {
      const arr = [...prev[field]];
      arr[index] = value;
      return { ...prev, [field]: arr };
    });
  };

  // ─── Save / Update ─────────────────────────────────────────────
  const handleSave = async () => {
    if (!form.title.trim()) return;
    setSaving(true);

    const payload = {
      ...(editingId ? { id: editingId } : { brand_id: selectedBrandId }),
      title: form.title.trim(),
      primary_texts: form.primary_texts.filter((t) => t.trim()),
      headlines: form.headlines.filter((t) => t.trim()),
      descriptions: form.descriptions.filter((t) => t.trim()),
      landing_page_url: form.landing_page_url.trim(),
    };

    const res = await fetch('/api/copy-templates', {
      method: editingId ? 'PUT' : 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      await fetchTemplates();
      cancelForm();
    }
    setSaving(false);
  };

  // ─── Delete ────────────────────────────────────────────────────
  const handleDelete = async (id: string) => {
    if (!confirm('Delete this template?')) return;
    await fetch(`/api/copy-templates?id=${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${authToken}` },
    });
    await fetchTemplates();
  };

  // ─── Current brand name ────────────────────────────────────────
  const brandName = brands.find((b) => b.id === selectedBrandId)?.name || '';

  // ═══════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════
  if (loading) {
    return (
      <Navbar>
        <div className="flex items-center justify-center h-screen bg-[#0a0a0a]">
          <Loader className="animate-spin" size={28} style={{ color: GOLD }} />
        </div>
      </Navbar>
    );
  }

  return (
    <Navbar>
      <div className="min-h-screen bg-[#0a0a0a] px-4 md:px-8 py-6 max-w-[1400px] mx-auto">
        {/* ── Header ──────────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: GOLD_DIM }}
            >
              <FileText size={20} style={{ color: GOLD }} />
            </div>
            <div>
              <h1 className="text-xl font-semibold" style={{ color: TEXT_PRIMARY }}>
                Copy Templates
              </h1>
              <p className="text-xs mt-0.5" style={{ color: TEXT_MUTED }}>
                {brandName ? `${brandName} — ` : ''}Create and manage ad copy templates
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Brand selector (admin only) */}
            {userRole === 'admin' && brands.length > 1 && (
              <div className="relative">
                <select
                  value={selectedBrandId}
                  onChange={(e) => handleBrandChange(e.target.value)}
                  className="appearance-none pl-3 pr-8 py-2 rounded-lg text-sm cursor-pointer"
                  style={{
                    background: BG_CARD,
                    color: TEXT_PRIMARY,
                    border: `1px solid ${BORDER}`,
                  }}
                >
                  {brands.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={14}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
                  style={{ color: TEXT_MUTED }}
                />
              </div>
            )}

            {/* New template button */}
            <button
              onClick={openNewForm}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all hover:brightness-110"
              style={{ background: GOLD, color: '#0a0a0a' }}
            >
              <Plus size={16} />
              New Template
            </button>
          </div>
        </div>

        {/* ── Create / Edit Form ──────────────────────────────────── */}
        {showForm && (
          <div
            className="rounded-xl p-6 mb-6 animate-fade-in"
            style={{ background: BG_CARD, border: `1px solid ${GOLD_BORDER}` }}
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-semibold" style={{ color: TEXT_PRIMARY }}>
                {editingId ? 'Edit Template' : 'New Template'}
              </h2>
              <button onClick={cancelForm}>
                <X size={18} style={{ color: TEXT_DIM }} />
              </button>
            </div>

            {/* Title */}
            <div className="mb-5">
              <label className="block text-xs font-medium mb-1.5 uppercase tracking-wider" style={{ color: GOLD }}>
                Template Title
              </label>
              <input
                type="text"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="e.g. Spring Collection — Tallow Body Lotion"
                className="w-full px-3 py-2.5 rounded-lg text-sm"
                style={{
                  background: '#0a0a0a',
                  color: TEXT_PRIMARY,
                  border: `1px solid ${BORDER}`,
                }}
              />
            </div>

            {/* Primary Texts */}
            <div className="mb-5">
              <label className="flex items-center gap-2 text-xs font-medium mb-2 uppercase tracking-wider" style={{ color: GOLD }}>
                <AlignLeft size={13} /> Primary Text Options (5)
              </label>
              <div className="space-y-2">
                {form.primary_texts.map((text, i) => (
                  <textarea
                    key={i}
                    value={text}
                    onChange={(e) => updateField('primary_texts', i, e.target.value)}
                    placeholder={`Primary text option ${i + 1}...`}
                    rows={2}
                    className="w-full px-3 py-2 rounded-lg text-sm resize-none"
                    style={{
                      background: '#0a0a0a',
                      color: TEXT_PRIMARY,
                      border: `1px solid ${BORDER}`,
                    }}
                  />
                ))}
              </div>
            </div>

            {/* Headlines */}
            <div className="mb-5">
              <label className="flex items-center gap-2 text-xs font-medium mb-2 uppercase tracking-wider" style={{ color: GOLD }}>
                <Heading size={13} /> Headline Options (5)
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {form.headlines.map((text, i) => (
                  <input
                    key={i}
                    type="text"
                    value={text}
                    onChange={(e) => updateField('headlines', i, e.target.value)}
                    placeholder={`Headline ${i + 1}...`}
                    className="w-full px-3 py-2.5 rounded-lg text-sm"
                    style={{
                      background: '#0a0a0a',
                      color: TEXT_PRIMARY,
                      border: `1px solid ${BORDER}`,
                    }}
                  />
                ))}
              </div>
            </div>

            {/* Descriptions */}
            <div className="mb-5">
              <label className="flex items-center gap-2 text-xs font-medium mb-2 uppercase tracking-wider" style={{ color: GOLD }}>
                <Type size={13} /> Description Options (2)
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {form.descriptions.map((text, i) => (
                  <input
                    key={i}
                    type="text"
                    value={text}
                    onChange={(e) => updateField('descriptions', i, e.target.value)}
                    placeholder={`Description ${i + 1}...`}
                    className="w-full px-3 py-2.5 rounded-lg text-sm"
                    style={{
                      background: '#0a0a0a',
                      color: TEXT_PRIMARY,
                      border: `1px solid ${BORDER}`,
                    }}
                  />
                ))}
              </div>
            </div>

            {/* Landing Page URL */}
            <div className="mb-6">
              <label className="flex items-center gap-2 text-xs font-medium mb-1.5 uppercase tracking-wider" style={{ color: GOLD }}>
                <Globe size={13} /> Landing Page / Destination
              </label>
              <input
                type="text"
                value={form.landing_page_url}
                onChange={(e) => setForm({ ...form, landing_page_url: e.target.value })}
                placeholder="https://example.com/collection/spring"
                className="w-full px-3 py-2.5 rounded-lg text-sm"
                style={{
                  background: '#0a0a0a',
                  color: TEXT_PRIMARY,
                  border: `1px solid ${BORDER}`,
                }}
              />
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3">
              <button
                onClick={handleSave}
                disabled={saving || !form.title.trim()}
                className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all hover:brightness-110 disabled:opacity-40"
                style={{ background: GOLD, color: '#0a0a0a' }}
              >
                {saving ? <Loader size={14} className="animate-spin" /> : <Save size={14} />}
                {editingId ? 'Update Template' : 'Save Template'}
              </button>
              <button
                onClick={cancelForm}
                className="px-4 py-2.5 rounded-lg text-sm"
                style={{ color: TEXT_MUTED, border: `1px solid ${BORDER}` }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* ── Templates Grid ──────────────────────────────────────── */}
        {templates.length === 0 && !showForm ? (
          <div
            className="rounded-xl p-12 text-center"
            style={{ background: BG_CARD, border: `1px solid ${BORDER}` }}
          >
            <FileText size={36} style={{ color: TEXT_DIM }} className="mx-auto mb-3" />
            <p className="text-sm mb-1" style={{ color: TEXT_MUTED }}>
              No templates yet{brandName ? ` for ${brandName}` : ''}
            </p>
            <p className="text-xs mb-4" style={{ color: TEXT_DIM }}>
              Create your first ad copy template to get started.
            </p>
            <button
              onClick={openNewForm}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium"
              style={{ background: GOLD, color: '#0a0a0a' }}
            >
              <Plus size={14} /> New Template
            </button>
          </div>
        ) : (
          <div className="grid gap-4">
            {templates.map((t) => (
              <TemplateCard
                key={t.id}
                template={t}
                onEdit={() => openEditForm(t)}
                onDelete={() => handleDelete(t.id)}
              />
            ))}
          </div>
        )}
      </div>
    </Navbar>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Template Card Component
// ═══════════════════════════════════════════════════════════════════
function TemplateCard({
  template: t,
  onEdit,
  onDelete,
}: {
  template: CopyTemplate;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="rounded-xl overflow-hidden transition-all hover:border-[rgba(200,184,154,0.25)]"
      style={{ background: BG_CARD, border: `1px solid ${BORDER}` }}
    >
      {/* Header — always visible, clickable to toggle */}
      <div
        className="flex items-center justify-between px-5 py-3 cursor-pointer select-none"
        style={{ background: BG_HEADER, borderBottom: expanded ? `1px solid ${BORDER}` : 'none' }}
        onClick={() => setExpanded((prev) => !prev)}
      >
        <div className="flex items-center gap-2.5">
          <ChevronDown
            size={15}
            style={{ color: GOLD, transition: 'transform 0.2s', transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)' }}
          />
          <FileText size={15} style={{ color: GOLD }} />
          <span className="text-sm font-semibold" style={{ color: TEXT_PRIMARY }}>
            {t.title}
          </span>
          <span className="text-[10px] ml-1" style={{ color: TEXT_DIM }}>
            {t.primary_texts.length}pt · {t.headlines.length}hl · {t.descriptions.length}desc
          </span>
        </div>
        <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={onEdit}
            className="p-1.5 rounded-md transition-colors hover:bg-white/5"
            title="Edit"
          >
            <Pencil size={14} style={{ color: TEXT_MUTED }} />
          </button>
          <button
            onClick={onDelete}
            className="p-1.5 rounded-md transition-colors hover:bg-red-500/10"
            title="Delete"
          >
            <Trash2 size={14} style={{ color: '#EF4444' }} />
          </button>
        </div>
      </div>

      {/* Body — collapsible */}
      {expanded && (
      <>
      <div className="px-5 py-4 space-y-4">
        {/* Primary Texts */}
        {t.primary_texts.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <AlignLeft size={12} style={{ color: GOLD }} />
              <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: GOLD }}>
                Primary Text
              </span>
              <span className="text-[10px] ml-1" style={{ color: TEXT_DIM }}>
                ({t.primary_texts.length} options)
              </span>
            </div>
            <div className="space-y-1.5">
              {t.primary_texts.map((text, i) => (
                <div
                  key={i}
                  className="group flex items-start gap-2 px-3 py-2 rounded-lg text-xs leading-relaxed"
                  style={{ background: '#0a0a0a', color: TEXT_PRIMARY }}
                >
                  <span className="shrink-0 text-[10px] font-medium mt-0.5" style={{ color: TEXT_DIM }}>
                    {i + 1}.
                  </span>
                  <span className="flex-1">{text}</span>
                  <CopyButton text={text} />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Headlines */}
        {t.headlines.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <Heading size={12} style={{ color: GOLD }} />
              <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: GOLD }}>
                Headlines
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {t.headlines.map((h, i) => (
                <div
                  key={i}
                  className="group flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs"
                  style={{ background: '#0a0a0a', color: TEXT_PRIMARY }}
                >
                  {h}
                  <CopyButton text={h} />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Descriptions */}
        {t.descriptions.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <Type size={12} style={{ color: GOLD }} />
              <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: GOLD }}>
                Descriptions
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {t.descriptions.map((d, i) => (
                <div
                  key={i}
                  className="group flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs"
                  style={{ background: '#0a0a0a', color: TEXT_PRIMARY }}
                >
                  {d}
                  <CopyButton text={d} />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Landing Page */}
        {t.landing_page_url && (
          <div className="flex items-center gap-2 pt-1">
            <Globe size={12} style={{ color: TEXT_DIM }} />
            <a
              href={t.landing_page_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs truncate hover:underline"
              style={{ color: GOLD }}
            >
              {t.landing_page_url}
            </a>
          </div>
        )}
      </div>

      {/* Footer */}
      <div
        className="px-5 py-2 text-[10px] flex items-center justify-between"
        style={{ borderTop: `1px solid ${BORDER}`, color: TEXT_DIM }}
      >
        <span>Created {new Date(t.created_at).toLocaleDateString()}</span>
        {t.updated_at !== t.created_at && (
          <span>Updated {new Date(t.updated_at).toLocaleDateString()}</span>
        )}
      </div>
      </>
      )}
    </div>
  );
}
