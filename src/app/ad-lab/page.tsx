'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Loader,
  Hammer,
  FileText,
  Package,
  Shuffle,
  Users as UsersIcon,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  Globe,
  ExternalLink,
  CheckCircle,
  Rocket,
  Play,
} from 'lucide-react';
import Navbar from '@/components/Navbar';
import { createClient } from '@/lib/supabase';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const getStorageUrl = (path: string) =>
  `${SUPABASE_URL}/storage/v1/object/public/creatives/${path}`;
const isImage = (f: SubmissionFile) => {
  if (f.media_format === 'STATIC') return true;
  const n = (f.file_name || '').toLowerCase();
  return /\.(jpe?g|png|webp|gif)$/.test(n);
};
const isVideo = (f: SubmissionFile) => {
  if (f.media_format === 'VIDEO') return true;
  const n = (f.file_name || '').toLowerCase();
  return /\.(mp4|mov|webm)$/.test(n);
};

// ─── Types ──────────────────────────────────────────────────────
interface Brand {
  id: string;
  name: string;
}

interface SubmissionFile {
  id: string;
  file_name: string;
  file_url: string | null;
  media_format: string | null;
  aspect_ratio: string | null;
}

interface BuildingBatch {
  id: string;
  batch_name: string;
  brand_id: string;
  brand_name: string;
  creative_type: string;
  is_carousel: boolean;
  is_flexible: boolean;
  is_whitelist: boolean;
  file_count: number;
  created_at: string;
  drive_folder_url: string | null;
  drive_sync_status: string | null;
  notes: string | null;
  files: SubmissionFile[];
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

const PAGE_SIZE = 10;

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// ─── Inline copy button ─────────────────────────────────────────
function CopyChip({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  if (!text) return null;
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      className="shrink-0 inline-flex items-center justify-center w-6 h-6 rounded transition-colors hover:bg-[rgba(200,184,154,0.12)]"
      title="Copy"
    >
      {copied ? (
        <Check className="w-3 h-3" style={{ color: '#22C55E' }} />
      ) : (
        <Copy className="w-3 h-3" style={{ color: '#999' }} />
      )}
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════
export default function AdLabPage() {
  const router = useRouter();
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<string>('');
  const [brands, setBrands] = useState<Brand[]>([]);
  const [selectedBrandId, setSelectedBrandId] = useState<string>('');

  const [batches, setBatches] = useState<BuildingBatch[]>([]);
  const [templates, setTemplates] = useState<CopyTemplate[]>([]);
  const [batchPage, setBatchPage] = useState(1);
  const [tplPage, setTplPage] = useState(1);
  const [expandedBatch, setExpandedBatch] = useState<string | null>(null);
  const [expandedTpl, setExpandedTpl] = useState<string | null>(null);

  // ─── Auth + brand bootstrap ───────────────────────────────────
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.push('/');
        return;
      }

      const { data: profile } = await supabase
        .from('users_profile')
        .select('role, brand_id')
        .eq('id', session.user.id)
        .single();

      if (!profile || !['admin', 'founder', 'strategist'].includes(profile.role)) {
        router.push('/');
        return;
      }

      setRole(profile.role);

      if (profile.role === 'admin') {
        const { data: allBrands } = await supabase
          .from('brands')
          .select('id, name')
          .order('name');
        setBrands(allBrands || []);
      } else if (profile.brand_id) {
        const { data: brand } = await supabase
          .from('brands')
          .select('id, name')
          .eq('id', profile.brand_id)
          .single();
        if (brand) {
          setBrands([brand]);
          setSelectedBrandId(brand.id);
        }
      }

      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Fetch batches + templates when brand changes ─────────────
  useEffect(() => {
    if (!selectedBrandId) {
      setBatches([]);
      setTemplates([]);
      return;
    }

    let cancelled = false;

    (async () => {
      const [{ data: batchRows }, { data: tplRows }] = await Promise.all([
        supabase
          .from('submissions')
          .select(`
            id,
            batch_name,
            brand_id,
            creative_type,
            is_carousel,
            is_flexible,
            is_whitelist,
            file_count,
            created_at,
            batch_status,
            drive_folder_url,
            drive_sync_status,
            notes,
            brands:brand_id (name),
            submission_files (
              id,
              file_name,
              file_url,
              media_format,
              aspect_ratio
            )
          `)
          .eq('brand_id', selectedBrandId)
          .eq('batch_status', 'building')
          .order('created_at', { ascending: false }),
        supabase
          .from('copy_templates')
          .select('*')
          .eq('brand_id', selectedBrandId)
          .order('created_at', { ascending: false }),
      ]);

      if (cancelled) return;

      setBatches(
        ((batchRows as any[]) || []).map((r) => ({
          id: r.id,
          batch_name: r.batch_name,
          brand_id: r.brand_id,
          brand_name: r.brands?.name || 'Unknown',
          creative_type: r.creative_type || '',
          is_carousel: !!r.is_carousel,
          is_flexible: !!r.is_flexible,
          is_whitelist: !!r.is_whitelist,
          file_count: r.file_count || 0,
          created_at: r.created_at,
          drive_folder_url: r.drive_folder_url || null,
          drive_sync_status: r.drive_sync_status || null,
          notes: r.notes || null,
          files: (r.submission_files || []) as SubmissionFile[],
        }))
      );
      setTemplates((tplRows as CopyTemplate[]) || []);
      setBatchPage(1);
      setTplPage(1);
      setExpandedBatch(null);
      setExpandedTpl(null);
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedBrandId, supabase]);

  const advanceStatus = async (id: string, status: 'ready' | 'launched') => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const res = await fetch('/api/batch-status', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ submissionId: id, status }),
    });
    if (res.ok) {
      // Building list: any advance removes the row
      setBatches((prev) => prev.filter((b) => b.id !== id));
    }
  };

  const selectedBrandName = useMemo(
    () => brands.find((b) => b.id === selectedBrandId)?.name || '',
    [brands, selectedBrandId]
  );

  const batchPages = Math.max(1, Math.ceil(batches.length / PAGE_SIZE));
  const tplPages = Math.max(1, Math.ceil(templates.length / PAGE_SIZE));
  const visibleBatches = batches.slice((batchPage - 1) * PAGE_SIZE, batchPage * PAGE_SIZE);
  const visibleTemplates = templates.slice((tplPage - 1) * PAGE_SIZE, tplPage * PAGE_SIZE);

  if (loading) {
    return (
      <Navbar>
        <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#0a0a0a' }}>
          <Loader className="w-8 h-8 animate-spin" style={{ color: '#C8B89A' }} />
        </div>
      </Navbar>
    );
  }

  const isAdmin = role === 'admin';

  return (
    <Navbar>
      <div className="min-h-screen" style={{ backgroundColor: '#0a0a0a', color: '#F5F5F8' }}>
        <main className="px-8 pt-10 pb-20 max-w-7xl mx-auto w-full">
          <header className="mb-8">
            <h1 className="text-3xl font-semibold mb-2">Ad Lab</h1>
            <p className="text-sm" style={{ color: '#ABABAB' }}>
              Build queue and copy templates for your brand.
            </p>
          </header>

          {/* Brand picker */}
          <div className="mb-8 flex items-center gap-3">
            <label className="text-xs uppercase tracking-wider" style={{ color: '#6B6560' }}>
              Brand
            </label>
            <select
              value={selectedBrandId}
              onChange={(e) => setSelectedBrandId(e.target.value)}
              disabled={!isAdmin}
              className="text-sm px-3 py-2 rounded-lg focus:outline-none transition-colors min-w-[240px]"
              style={{
                backgroundColor: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                color: '#F5F5F8',
              }}
            >
              {isAdmin && <option value="">Select a brand…</option>}
              {brands.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>

          {!selectedBrandId ? (
            <div
              className="rounded-2xl border px-6 py-20 text-center"
              style={{
                backgroundColor: 'rgba(13,13,13,0.5)',
                borderColor: 'rgba(255,255,255,0.08)',
                color: '#6B6560',
              }}
            >
              <p className="text-sm">Select a brand to get started.</p>
            </div>
          ) : (
            <>
              {/* SECTION A — Building */}
              <section
                className="rounded-2xl border overflow-hidden mb-8"
                style={{
                  backgroundColor: 'rgba(13,13,13,0.5)',
                  borderColor: 'rgba(255,255,255,0.08)',
                }}
              >
                <div
                  className="flex items-center justify-between px-6 py-4 border-b"
                  style={{ borderColor: 'rgba(255,255,255,0.06)' }}
                >
                  <div className="flex items-center gap-2.5">
                    <Hammer className="w-4 h-4" style={{ color: '#C8B89A' }} />
                    <div>
                      <h2 className="text-base font-semibold tracking-tight">Building</h2>
                      <p className="text-xs mt-0.5" style={{ color: '#6B6560' }}>
                        {batches.length} in progress
                      </p>
                    </div>
                  </div>
                </div>

                {visibleBatches.length === 0 ? (
                  <div className="px-6 py-12 text-center text-xs" style={{ color: '#6B6560' }}>
                    No batches building for {selectedBrandName}.
                  </div>
                ) : (
                  <ul>
                    {visibleBatches.map((b) => {
                      const typeIcon = b.is_carousel
                        ? Package
                        : b.is_flexible
                        ? Shuffle
                        : b.is_whitelist
                        ? UsersIcon
                        : null;
                      const typeLabel = b.is_carousel
                        ? 'Carousel'
                        : b.is_flexible
                        ? 'Flexible'
                        : b.is_whitelist
                        ? 'Whitelist'
                        : b.creative_type || 'Standard';
                      const isOpen = expandedBatch === b.id;
                      return (
                        <li
                          key={b.id}
                          style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}
                        >
                          <div
                            className="flex items-center gap-4 px-6 py-3.5 hover:bg-[rgba(255,255,255,0.02)] transition-colors cursor-pointer"
                            onClick={() => setExpandedBatch(isOpen ? null : b.id)}
                          >
                            {isOpen ? (
                              <ChevronDown className="w-4 h-4 shrink-0" style={{ color: '#C8B89A' }} />
                            ) : (
                              <ChevronRight className="w-4 h-4 shrink-0" style={{ color: '#6B6560' }} />
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-sm font-semibold truncate" style={{ color: '#F5F5F8' }}>
                                  {b.brand_name}
                                </span>
                                <span
                                  className="text-[11px] font-mono px-1.5 py-0.5 rounded"
                                  style={{ color: '#C8B89A', backgroundColor: 'rgba(200,184,154,0.08)' }}
                                >
                                  {b.batch_name}
                                </span>
                              </div>
                              <div className="flex items-center gap-3 text-[11px]" style={{ color: '#6B6560' }}>
                                {typeIcon ? (
                                  <span className="flex items-center gap-1">
                                    {(() => {
                                      const Icon = typeIcon;
                                      return <Icon className="w-3 h-3" />;
                                    })()}
                                    {typeLabel}
                                  </span>
                                ) : (
                                  <span>{typeLabel}</span>
                                )}
                                <span>·</span>
                                <span>{b.file_count} file{b.file_count === 1 ? '' : 's'}</span>
                                <span>·</span>
                                <span>{timeAgo(b.created_at)}</span>
                              </div>
                            </div>
                            {b.drive_folder_url && (
                              <a
                                href={b.drive_folder_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="shrink-0 text-[11px] font-medium px-2.5 py-1 rounded transition-colors"
                                style={{ color: '#22C55E', backgroundColor: 'rgba(34,197,94,0.08)' }}
                              >
                                Open in Dropbox →
                              </a>
                            )}
                          </div>

                          {isOpen && (
                            <div
                              className="px-6 pb-5 pt-2 space-y-4"
                              style={{ backgroundColor: 'rgba(255,255,255,0.015)' }}
                            >
                              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
                                <div>
                                  <div className="text-[10px] uppercase tracking-wider mb-0.5" style={{ color: '#6B6560' }}>Brand</div>
                                  <div style={{ color: '#F5F5F8' }}>{b.brand_name}</div>
                                </div>
                                <div>
                                  <div className="text-[10px] uppercase tracking-wider mb-0.5" style={{ color: '#6B6560' }}>Batch</div>
                                  <div className="font-mono" style={{ color: '#C8B89A' }}>{b.batch_name}</div>
                                </div>
                                {b.drive_folder_url && (
                                  <div>
                                    <div className="text-[10px] uppercase tracking-wider mb-0.5" style={{ color: '#6B6560' }}>Dropbox</div>
                                    <a
                                      href={b.drive_folder_url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center gap-1 hover:underline"
                                      style={{ color: '#5B8DEF' }}
                                    >
                                      Open folder <ExternalLink className="w-3 h-3" />
                                    </a>
                                  </div>
                                )}
                              </div>

                              {b.notes && (
                                <div>
                                  <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: '#6B6560' }}>Notes</div>
                                  <div
                                    className="text-xs px-3 py-2 rounded whitespace-pre-wrap"
                                    style={{
                                      backgroundColor: 'rgba(255,255,255,0.025)',
                                      border: '1px solid rgba(255,255,255,0.04)',
                                      color: '#F5F5F8',
                                    }}
                                  >
                                    {b.notes}
                                  </div>
                                </div>
                              )}

                              {b.files.length > 0 && (
                                <div>
                                  <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: '#6B6560' }}>
                                    Files ({b.files.length})
                                  </div>
                                  <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
                                    {b.files.map((f) => {
                                      const url = f.file_url ? getStorageUrl(f.file_url) : '';
                                      const img = isImage(f);
                                      const vid = isVideo(f);
                                      return (
                                        <div
                                          key={f.id}
                                          className="rounded-lg overflow-hidden"
                                          style={{
                                            backgroundColor: 'rgba(255,255,255,0.03)',
                                            border: '1px solid rgba(255,255,255,0.06)',
                                          }}
                                        >
                                          <a
                                            href={url || undefined}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="block aspect-square w-full relative bg-black/20 flex items-center justify-center"
                                          >
                                            {img && url ? (
                                              <img src={url} alt={f.file_name} className="w-full h-full object-cover" />
                                            ) : vid && url ? (
                                              <>
                                                <video src={`${url}#t=0.5`} className="w-full h-full object-cover" muted playsInline preload="metadata" />
                                                <div className="absolute inset-0 flex items-center justify-center">
                                                  <div className="w-7 h-7 rounded-full flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
                                                    <Play className="w-3.5 h-3.5 text-white ml-0.5" />
                                                  </div>
                                                </div>
                                              </>
                                            ) : (
                                              <FileText className="w-6 h-6 text-gray-600" />
                                            )}
                                          </a>
                                          <div className="p-1.5">
                                            <p className="text-[10px] truncate" style={{ color: '#D5D5D5' }}>{f.file_name}</p>
                                            <div className="flex items-center justify-between mt-0.5">
                                              <div className="flex gap-1">
                                                {f.media_format && <span className="text-[9px] uppercase" style={{ color: '#6B6560' }}>{f.media_format}</span>}
                                                {f.aspect_ratio && <span className="text-[9px]" style={{ color: '#C8B89A' }}>{f.aspect_ratio}</span>}
                                              </div>
                                              {url && (
                                                <a
                                                  href={url}
                                                  target="_blank"
                                                  rel="noopener noreferrer"
                                                  className="text-[9px] inline-flex items-center gap-0.5 hover:underline"
                                                  style={{ color: '#5B8DEF' }}
                                                >
                                                  Open <ExternalLink className="w-2.5 h-2.5" />
                                                </a>
                                              )}
                                            </div>
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}

                              <div className="flex items-center gap-2 pt-1">
                                <button
                                  onClick={() => advanceStatus(b.id, 'ready')}
                                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                                  style={{ backgroundColor: 'rgba(76,175,80,0.15)', color: '#4CAF50' }}
                                >
                                  <CheckCircle className="w-3.5 h-3.5" />
                                  Mark Ready
                                </button>
                                <button
                                  onClick={() => advanceStatus(b.id, 'launched')}
                                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                                  style={{ backgroundColor: 'rgba(200,184,154,0.2)', color: '#C8B89A' }}
                                >
                                  <Rocket className="w-3.5 h-3.5" />
                                  Mark Launched
                                </button>
                              </div>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}

                {batches.length > PAGE_SIZE && (
                  <Pager page={batchPage} pages={batchPages} setPage={setBatchPage} />
                )}
              </section>

              {/* SECTION B — Copy Templates */}
              <section
                className="rounded-2xl border overflow-hidden"
                style={{
                  backgroundColor: 'rgba(13,13,13,0.5)',
                  borderColor: 'rgba(255,255,255,0.08)',
                }}
              >
                <div
                  className="flex items-center justify-between px-6 py-4 border-b"
                  style={{ borderColor: 'rgba(255,255,255,0.06)' }}
                >
                  <div className="flex items-center gap-2.5">
                    <FileText className="w-4 h-4" style={{ color: '#C8B89A' }} />
                    <div>
                      <h2 className="text-base font-semibold tracking-tight">Copy Templates</h2>
                      <p className="text-xs mt-0.5" style={{ color: '#6B6560' }}>
                        {templates.length} template{templates.length === 1 ? '' : 's'}
                      </p>
                    </div>
                  </div>
                  <Link
                    href="/copy-templates"
                    className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
                    style={{ color: '#C8B89A', backgroundColor: 'rgba(200,184,154,0.08)' }}
                  >
                    Manage →
                  </Link>
                </div>

                {visibleTemplates.length === 0 ? (
                  <div className="px-6 py-12 text-center text-xs" style={{ color: '#6B6560' }}>
                    No copy templates for {selectedBrandName} yet.
                  </div>
                ) : (
                  <ul>
                    {visibleTemplates.map((t) => {
                      const isOpen = expandedTpl === t.id;
                      return (
                        <li
                          key={t.id}
                          style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}
                        >
                          <button
                            onClick={() => setExpandedTpl(isOpen ? null : t.id)}
                            className="w-full flex items-center gap-3 px-6 py-3.5 hover:bg-[rgba(255,255,255,0.02)] transition-colors text-left"
                          >
                            {isOpen ? (
                              <ChevronDown className="w-4 h-4 shrink-0" style={{ color: '#C8B89A' }} />
                            ) : (
                              <ChevronRight className="w-4 h-4 shrink-0" style={{ color: '#6B6560' }} />
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-semibold truncate" style={{ color: '#F5F5F8' }}>
                                {t.title || 'Untitled'}
                              </div>
                              <div className="text-[11px] mt-0.5" style={{ color: '#6B6560' }}>
                                {t.primary_texts.length} primary · {t.headlines.length} headlines · {t.descriptions.length} descriptions
                              </div>
                            </div>
                          </button>

                          {isOpen && (
                            <div
                              className="px-6 pb-5 pt-1 space-y-4"
                              style={{ backgroundColor: 'rgba(255,255,255,0.015)' }}
                            >
                              {t.landing_page_url && (
                                <FieldRow
                                  label="Landing page"
                                  icon={<Globe className="w-3 h-3" />}
                                  items={[t.landing_page_url]}
                                />
                              )}
                              {t.primary_texts.length > 0 && (
                                <FieldRow label="Primary texts" items={t.primary_texts} />
                              )}
                              {t.headlines.length > 0 && (
                                <FieldRow label="Headlines" items={t.headlines} />
                              )}
                              {t.descriptions.length > 0 && (
                                <FieldRow label="Descriptions" items={t.descriptions} />
                              )}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}

                {templates.length > PAGE_SIZE && (
                  <Pager page={tplPage} pages={tplPages} setPage={setTplPage} />
                )}
              </section>
            </>
          )}
        </main>
      </div>
    </Navbar>
  );
}

// ─── Pager ──────────────────────────────────────────────────────
function Pager({
  page,
  pages,
  setPage,
}: {
  page: number;
  pages: number;
  setPage: (n: number) => void;
}) {
  return (
    <div
      className="flex items-center justify-between px-6 py-3 text-xs"
      style={{ borderTop: '1px solid rgba(255,255,255,0.04)', color: '#6B6560' }}
    >
      <span>
        Page {page} of {pages}
      </span>
      <div className="flex items-center gap-2">
        <button
          onClick={() => setPage(Math.max(1, page - 1))}
          disabled={page <= 1}
          className="px-2.5 py-1 rounded transition-colors disabled:opacity-30"
          style={{ backgroundColor: 'rgba(200,184,154,0.08)', color: '#C8B89A' }}
        >
          Prev
        </button>
        <button
          onClick={() => setPage(Math.min(pages, page + 1))}
          disabled={page >= pages}
          className="px-2.5 py-1 rounded transition-colors disabled:opacity-30"
          style={{ backgroundColor: 'rgba(200,184,154,0.08)', color: '#C8B89A' }}
        >
          Next
        </button>
      </div>
    </div>
  );
}

// ─── Expanded template field row ────────────────────────────────
function FieldRow({
  label,
  items,
  icon,
}: {
  label: string;
  items: string[];
  icon?: React.ReactNode;
}) {
  const filtered = items.filter((s) => s && s.trim());
  if (filtered.length === 0) return null;
  return (
    <div>
      <div
        className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider mb-1.5"
        style={{ color: '#6B6560' }}
      >
        {icon}
        {label}
      </div>
      <ul className="space-y-1">
        {filtered.map((text, i) => (
          <li
            key={i}
            className="flex items-start gap-2 px-3 py-2 rounded text-sm group"
            style={{
              backgroundColor: 'rgba(255,255,255,0.025)',
              border: '1px solid rgba(255,255,255,0.04)',
              color: '#F5F5F8',
            }}
          >
            <span className="flex-1 whitespace-pre-wrap break-words">{text}</span>
            <CopyChip text={text} />
          </li>
        ))}
      </ul>
    </div>
  );
}
