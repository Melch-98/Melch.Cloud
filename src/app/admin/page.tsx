'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Loader,
  AlertCircle,
  Download,
  ChevronDown,
  ChevronUp,
  Rocket,
  Hammer,
  CheckCircle,
  Package,
  Inbox,
  Archive,
  Image,
  Video,
  FileText,
  Music,
  ExternalLink,
  ArrowRight,
  Trash2,
  Play,
} from 'lucide-react';
import Navbar from '@/components/Navbar';
import { createClient } from '@/lib/supabase';

interface BatchSubmission {
  id: string;
  batch_name: string;
  brand_id: string;
  creative_type: string;
  creator_name: string;
  creator_social_handle: string;
  landing_page_url: string;
  copy_title: string;
  copy_body: string;
  is_carousel: boolean;
  is_flexible: boolean;
  is_whitelist: boolean;
  batch_status: 'new' | 'building' | 'ready' | 'launched';
  drive_folder_url?: string | null;
  launched_at: string | null;
  created_at: string;
  file_count: number;
  files: BatchFile[];
  brand_name?: string;
}

interface BatchFile {
  id: string;
  file_name: string;
  file_url: string;
  media_format: string | null;
  aspect_ratio: string | null;
  copy_headline: string | null;
  copy_body: string | null;
}

const statusConfig = {
  new: {
    label: 'New',
    color: '#C8B89A',
    bg: 'rgba(200,184,154,0.10)',
    border: 'rgba(200,184,154,0.22)',
    icon: Inbox,
  },
  building: {
    label: 'Building',
    color: '#9AADCC',
    bg: 'rgba(154,173,204,0.10)',
    border: 'rgba(154,173,204,0.22)',
    icon: Hammer,
  },
  ready: {
    label: 'Ready to Launch',
    color: '#9AC8A7',
    bg: 'rgba(154,200,167,0.10)',
    border: 'rgba(154,200,167,0.22)',
    icon: Rocket,
  },
  launched: {
    label: 'Launched',
    color: '#6B6560',
    bg: 'rgba(107,101,96,0.08)',
    border: 'rgba(107,101,96,0.15)',
    icon: Archive,
  },
};

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;

function getStorageUrl(filePath: string) {
  return `${SUPABASE_URL}/storage/v1/object/public/creatives/${filePath}`;
}

function isImageFile(file: BatchFile) {
  if (file.media_format === 'STATIC') return true;
  const name = file.file_name.toLowerCase();
  return name.endsWith('.jpg') || name.endsWith('.jpeg') || name.endsWith('.png') || name.endsWith('.webp') || name.endsWith('.gif');
}

function isVideoFile(file: BatchFile) {
  if (file.media_format === 'VIDEO') return true;
  const name = file.file_name.toLowerCase();
  return name.endsWith('.mp4') || name.endsWith('.mov') || name.endsWith('.webm');
}

function getFileIcon(format: string | null) {
  switch (format) {
    case 'VIDEO':
      return <Video className="w-4 h-4 text-purple-400" />;
    case 'STATIC':
      return <Image className="w-4 h-4 text-blue-400" />;
    case 'AUDIO':
      return <Music className="w-4 h-4 text-amber-400" />;
    default:
      return <FileText className="w-4 h-4 text-gray-400" />;
  }
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// ─── Batch Card Component ───────────────────────────────────────
function BatchCard({
  batch,
  onDownload,
  onStatusChange,
  onDelete,
  downloading,
}: {
  batch: BatchSubmission;
  onDownload: (id: string) => void;
  onStatusChange: (id: string, status: string) => void;
  onDelete: (id: string) => void;
  downloading: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const config = statusConfig[batch.batch_status];
  const StatusIcon = config.icon;

  return (
    <div
      className="rounded-xl overflow-hidden transition-all"
      style={{
        backgroundColor: 'rgba(255,255,255,0.03)',
        border: `1px solid ${config.border}`,
      }}
    >
      {/* Header */}
      <div
        className="p-4 cursor-pointer hover:bg-white/[0.02] transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          {/* Status indicator */}
          <div
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{ backgroundColor: config.color }}
          />

          {/* Batch name + brand */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              {batch.brand_name && (
                <span
                  className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded"
                  style={{ backgroundColor: 'rgba(200,184,154,0.15)', color: '#C8B89A' }}
                >
                  {batch.brand_name}
                </span>
              )}
              <span className="font-semibold text-[#F5F5F8] text-sm">
                {batch.batch_name}
              </span>
              {batch.is_carousel && (
                <span className="text-[10px] font-bold text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded">
                  CAROUSEL
                </span>
              )}
              {batch.is_flexible && (
                <span className="text-[10px] font-bold text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded">
                  FLEXIBLE
                </span>
              )}
              {batch.is_whitelist && (
                <span className="text-[10px] font-bold text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded">
                  WHITELIST
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
              <span>{batch.creative_type}</span>
              <span>·</span>
              <span>{batch.file_count} file{batch.file_count !== 1 ? 's' : ''}</span>
              {batch.creator_name && (
                <>
                  <span>·</span>
                  <span>{batch.creator_name}</span>
                </>
              )}
              <span>·</span>
              <span>{timeAgo(batch.created_at)}</span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
            {/* Open in Dropbox (new/building/ready) */}
            {batch.drive_folder_url && batch.batch_status !== 'launched' && (
              <a
                href={batch.drive_folder_url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all hover:brightness-110"
                style={{
                  backgroundColor: 'rgba(0,97,254,0.15)',
                  color: '#5B8DEF',
                }}
                title="Open batch folder in Dropbox"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Dropbox
              </a>
            )}

            {/* NEW → Start Building (advance status; Blip pulls from Dropbox) */}
            {batch.batch_status === 'new' && (
              <button
                onClick={() => onStatusChange(batch.id, 'building')}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                style={{
                  backgroundColor: 'rgba(154,173,204,0.15)',
                  color: '#9AADCC',
                }}
              >
                <Hammer className="w-3.5 h-3.5" />
                Start Building
              </button>
            )}

            {/* BUILDING → Mark Ready */}
            {batch.batch_status === 'building' && (
              <button
                onClick={() => onStatusChange(batch.id, 'ready')}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                style={{
                  backgroundColor: 'rgba(76,175,80,0.15)',
                  color: '#4CAF50',
                }}
              >
                <CheckCircle className="w-3.5 h-3.5" />
                Mark Ready
              </button>
            )}

            {/* READY → Launch */}
            {batch.batch_status === 'ready' && (
              <button
                onClick={() => onStatusChange(batch.id, 'launched')}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                style={{
                  backgroundColor: 'rgba(200,184,154,0.2)',
                  color: '#C8B89A',
                }}
              >
                <Rocket className="w-3.5 h-3.5" />
                Launched
              </button>
            )}

            {/* LAUNCHED → show date */}
            {batch.batch_status === 'launched' && batch.launched_at && (
              <span className="text-xs text-gray-500">
                Launched {new Date(batch.launched_at).toLocaleDateString()}
              </span>
            )}

            {/* Delete button */}
            <button
              onClick={() => setConfirmDelete(true)}
              className="p-1.5 rounded-lg transition-all hover:bg-red-500/10"
              title="Delete batch"
            >
              <Trash2 className="w-3.5 h-3.5 text-gray-600 hover:text-red-400" />
            </button>
          </div>

          {/* Expand chevron */}
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-gray-500 flex-shrink-0" />
          ) : (
            <ChevronDown className="w-4 h-4 text-gray-500 flex-shrink-0" />
          )}
        </div>
      </div>

      {/* Expanded: context + file thumbnails */}
      {expanded && (
        <div className="border-t border-white/5 p-4 space-y-4">
          {/* Batch context */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            {batch.landing_page_url && (
              <div>
                <span className="text-gray-500 block mb-0.5">Landing Page</span>
                <a
                  href={batch.landing_page_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-amber-400 hover:underline flex items-center gap-1 truncate"
                >
                  {batch.landing_page_url.replace(/^https?:\/\//, '').slice(0, 30)}
                  <ExternalLink className="w-3 h-3 flex-shrink-0" />
                </a>
              </div>
            )}
            {batch.copy_title && (
              <div>
                <span className="text-gray-500 block mb-0.5">Copy Template</span>
                <span className="text-gray-300">{batch.copy_title}</span>
              </div>
            )}
            {batch.copy_body && batch.is_carousel && (
              <div>
                <span className="text-gray-500 block mb-0.5">Primary Text</span>
                <span className="text-gray-300">{batch.copy_body}</span>
              </div>
            )}
            {batch.creator_social_handle && (
              <div>
                <span className="text-gray-500 block mb-0.5">Social Handle</span>
                <span className="text-gray-300">{batch.creator_social_handle}</span>
              </div>
            )}
          </div>

          {/* Files grid */}
          <div>
            <span className="text-xs text-gray-500 mb-2 block">
              Files ({batch.files.length})
            </span>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
              {batch.files.map((file) => {
                const url = file.file_url ? getStorageUrl(file.file_url) : '';
                const isImg = isImageFile(file);
                const isVid = isVideoFile(file);

                return (
                  <div
                    key={file.id}
                    className="rounded-lg overflow-hidden"
                    style={{
                      backgroundColor: 'rgba(255,255,255,0.03)',
                      border: '1px solid rgba(255,255,255,0.06)',
                    }}
                  >
                    {/* Thumbnail */}
                    <div className="aspect-square w-full relative bg-black/20 flex items-center justify-center">
                      {isImg && url ? (
                        <img
                          src={url}
                          alt={file.file_name}
                          className="w-full h-full object-cover"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        />
                      ) : isVid && url ? (
                        <div
                          className="relative w-full h-full cursor-pointer group/vid"
                          onClick={(e) => {
                            const video = (e.currentTarget as HTMLElement).querySelector('video');
                            if (!video) return;
                            if (video.paused) {
                              video.play();
                              (e.currentTarget.querySelector('.play-overlay') as HTMLElement)?.classList.add('opacity-0');
                            } else {
                              video.pause();
                              (e.currentTarget.querySelector('.play-overlay') as HTMLElement)?.classList.remove('opacity-0');
                            }
                          }}
                        >
                          <video
                            src={`${url}#t=0.5`}
                            className="w-full h-full object-cover"
                            muted
                            loop
                            playsInline
                            preload="auto"
                            onEnded={(e) => {
                              const overlay = (e.currentTarget as HTMLElement).parentElement?.querySelector('.play-overlay') as HTMLElement;
                              overlay?.classList.remove('opacity-0');
                            }}
                          />
                          <div className="play-overlay absolute inset-0 flex items-center justify-center transition-opacity duration-200">
                            <div className="w-7 h-7 rounded-full flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
                              <Play className="w-3.5 h-3.5 text-white ml-0.5" />
                            </div>
                          </div>
                        </div>
                      ) : (
                        <FileText className="w-6 h-6 text-gray-600" />
                      )}
                    </div>
                    {/* Info */}
                    <div className="p-1.5">
                      <p className="text-[10px] text-gray-300 truncate">{file.file_name}</p>
                      <div className="flex gap-1 mt-0.5">
                        {file.media_format && (
                          <span className="text-[9px] text-gray-500 uppercase">{file.media_format}</span>
                        )}
                        {file.aspect_ratio && (
                          <span className="text-[9px] text-amber-600">{file.aspect_ratio}</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Per-card details for carousel */}
          {batch.is_carousel &&
            batch.files.some((f) => f.copy_headline) && (
              <div>
                <span className="text-xs text-gray-500 mb-2 block">
                  Card Copy
                </span>
                <div className="space-y-1.5">
                  {batch.files.map((file, i) =>
                    file.copy_headline ? (
                      <div
                        key={file.id}
                        className="flex items-center gap-3 text-xs px-3 py-2 rounded-lg"
                        style={{ backgroundColor: 'rgba(255,255,255,0.02)' }}
                      >
                        <span className="text-gray-500 font-medium w-16 flex-shrink-0">
                          Card {i + 1}
                        </span>
                        <span className="text-gray-300 flex-1">
                          {file.copy_headline}
                        </span>
                        {file.copy_body && (
                          <span className="text-gray-500 flex-1">
                            {file.copy_body}
                          </span>
                        )}
                      </div>
                    ) : null
                  )}
                </div>
              </div>
            )}
        </div>
      )}

      {/* Delete confirmation overlay */}
      {confirmDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}
          onClick={(e) => { e.stopPropagation(); setConfirmDelete(false); }}
        >
          <div
            className="rounded-xl p-6 max-w-sm mx-4"
            style={{ backgroundColor: '#1A1A1A', border: '1px solid rgba(255,50,50,0.3)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-lg" style={{ backgroundColor: 'rgba(255,50,50,0.1)' }}>
                <Trash2 className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-[#F5F5F8]">Delete Batch</h3>
                <p className="text-xs text-gray-500">This cannot be undone</p>
              </div>
            </div>
            <p className="text-sm text-gray-400 mb-5">
              Permanently delete <strong className="text-[#F5F5F8]">{batch.batch_name}</strong> and all its files? No trace will remain.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmDelete(false)}
                className="flex-1 px-4 py-2 rounded-lg text-sm font-medium text-gray-400 transition-colors"
                style={{ backgroundColor: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}
              >
                Cancel
              </button>
              <button
                onClick={() => { setConfirmDelete(false); onDelete(batch.id); }}
                className="flex-1 px-4 py-2 rounded-lg text-sm font-semibold text-white transition-colors"
                style={{ backgroundColor: 'rgba(239,68,68,0.8)', border: '1px solid rgba(239,68,68,0.5)' }}
              >
                Delete Forever
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Queue Section Component ────────────────────────────────────
function QueueSection({
  title,
  status,
  batches,
  onDownload,
  onStatusChange,
  onDelete,
  downloading,
  defaultOpen = true,
}: {
  title: string;
  status: keyof typeof statusConfig;
  batches: BatchSubmission[];
  onDownload: (id: string) => void;
  onStatusChange: (id: string, status: string) => void;
  onDelete: (id: string) => void;
  downloading: string | null;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const config = statusConfig[status];
  const Icon = config.icon;

  return (
    <div className="mb-6">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-3 w-full text-left mb-3 group"
      >
        <Icon
          className="w-5 h-5 flex-shrink-0"
          style={{ color: config.color }}
        />
        <h2 className="text-lg font-semibold text-[#F5F5F8]">{title}</h2>
        <span
          className="text-xs font-bold px-2 py-0.5 rounded-full"
          style={{ backgroundColor: config.bg, color: config.color }}
        >
          {batches.length}
        </span>
        <div className="flex-1" />
        {open ? (
          <ChevronUp className="w-4 h-4 text-gray-500" />
        ) : (
          <ChevronDown className="w-4 h-4 text-gray-500" />
        )}
      </button>

      {open && (
        <div className="space-y-2">
          {batches.length === 0 ? (
            <p className="text-sm text-gray-600 py-4 text-center">
              No batches here
            </p>
          ) : (
            batches.map((batch) => (
              <BatchCard
                key={batch.id}
                batch={batch}
                onDownload={onDownload}
                onStatusChange={onStatusChange}
                onDelete={onDelete}
                downloading={downloading}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Admin Page ────────────────────────────────────────────
export default function AdminPage() {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [batches, setBatches] = useState<BatchSubmission[]>([]);
  const [brands, setBrands] = useState<{ id: string; name: string }[]>([]);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [brandFilter, setBrandFilter] = useState<string>('all');

  const fetchData = useCallback(async () => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        router.push('/');
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from('users_profile')
        .select('role')
        .eq('id', session.user.id)
        .single();

      console.log('Profile query result:', { profile, profileError });

      // If profile query fails due to RLS, don't redirect — just continue
      if (profile && profile.role !== 'admin') {
        router.push('/submissions');
        return;
      }

      // Fetch all brands
      const { data: allBrands } = await supabase
        .from('brands')
        .select('id, name')
        .order('name');
      setBrands(allBrands || []);

      // Fetch all submissions with their files and brand names
      const { data: submissions, error: subError } = await supabase
        .from('submissions')
        .select(`
          *,
          brands:brand_id (name),
          submission_files (
            id,
            file_name,
            file_url,
            media_format,
            aspect_ratio,
            copy_headline,
            copy_body
          )
        `)
        .order('created_at', { ascending: false });

      console.log('Submissions query result:', { count: submissions?.length, subError });

      if (subError) {
        setError(`Failed to load batches: ${subError.message}`);
        console.error('Fetch error:', subError);
      } else {
        const mapped: BatchSubmission[] = (submissions || []).map((s: any) => ({
          ...s,
          brand_name: s.brands?.name || 'Unknown',
          files: s.submission_files || [],
          batch_status: s.batch_status || 'new',
        }));
        setBatches(mapped);
      }

      setLoading(false);
    } catch (err) {
      console.error('Init error:', err);
      setError('An error occurred');
      setLoading(false);
    }
  }, [supabase, router]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Helper to get current session token for API calls
  const getAuthHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return {};
    return { Authorization: `Bearer ${session.access_token}` };
  }, [supabase]);

  const handleDownload = useCallback(
    async (submissionId: string) => {
      setDownloading(submissionId);
      try {
        const authHeaders = await getAuthHeaders();
        const response = await fetch(`/api/batch-download?id=${submissionId}`, {
          headers: authHeaders,
        });
        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.error || errData.details?.join(', ') || 'Download failed');
        }

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const disposition = response.headers.get('Content-Disposition');
        const filename = disposition?.match(/filename="(.+)"/)?.[1] || 'batch.zip';
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);

        // Update local state to building
        setBatches((prev) =>
          prev.map((b) =>
            b.id === submissionId ? { ...b, batch_status: 'building' } : b
          )
        );
      } catch (err) {
        console.error('Download error:', err);
        setError('Failed to download batch');
      } finally {
        setDownloading(null);
      }
    },
    [getAuthHeaders]
  );

  const handleStatusChange = useCallback(
    async (submissionId: string, newStatus: string) => {
      try {
        const authHeaders = await getAuthHeaders();
        const response = await fetch('/api/batch-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({ submissionId, status: newStatus }),
        });

        if (!response.ok) throw new Error('Status update failed');

        setBatches((prev) =>
          prev.map((b) =>
            b.id === submissionId
              ? {
                  ...b,
                  batch_status: newStatus as any,
                  launched_at:
                    newStatus === 'launched'
                      ? new Date().toISOString()
                      : b.launched_at,
                }
              : b
          )
        );
      } catch (err) {
        console.error('Status change error:', err);
        setError('Failed to update status');
      }
    },
    [getAuthHeaders]
  );

  const handleDelete = useCallback(
    async (submissionId: string) => {
      try {
        const authHeaders = await getAuthHeaders();
        const response = await fetch('/api/batch-delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({ submissionId }),
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.error || 'Delete failed');
        }

        // Remove from local state
        setBatches((prev) => prev.filter((b) => b.id !== submissionId));
      } catch (err: any) {
        console.error('Delete error:', err);
        setError(err.message || 'Failed to delete batch');
      }
    },
    [getAuthHeaders]
  );

  const handleExport = useCallback(async () => {
    try {
      setExporting(true);
      const authHeaders = await getAuthHeaders();
      const response = await fetch('/api/export', { headers: authHeaders });
      if (!response.ok) {
        setError('Failed to export data');
        return;
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `melch-cloud-export-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      console.error('Export error:', err);
      setError('Failed to export data');
    } finally {
      setExporting(false);
    }
  }, [getAuthHeaders]);

  // Apply brand filter then split by status
  const filtered = brandFilter === 'all' ? batches : batches.filter((b) => b.brand_id === brandFilter);
  const newBatches = filtered.filter((b) => b.batch_status === 'new');
  const buildingBatches = filtered.filter((b) => b.batch_status === 'building');
  const readyBatches = filtered.filter((b) => b.batch_status === 'ready');
  const launchedBatches = filtered.filter((b) => b.batch_status === 'launched');

  if (loading) {
    return (
      <Navbar>
        <div className="min-h-screen flex items-center justify-center">
          <Loader className="w-8 h-8 text-[#C8B89A] animate-spin" />
        </div>
      </Navbar>
    );
  }

  return (
    <Navbar>
      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-[#F5F5F8] tracking-tight">
              Creative Queue
            </h1>
            <p className="text-sm text-[#ABABAB] mt-1">
              Manage batch submissions through your workflow
            </p>
          </div>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-colors"
            style={{
              backgroundColor: 'rgba(200,184,154,0.15)',
              color: '#C8B89A',
              opacity: exporting ? 0.5 : 1,
            }}
          >
            <Download className="w-4 h-4" />
            {exporting ? 'Exporting...' : 'Export CSV'}
          </button>
        </div>

        {error && (
          <div
            className="mb-6 p-4 rounded-lg flex items-center gap-3"
            style={{
              backgroundColor: 'rgba(255,50,50,0.08)',
              border: '1px solid rgba(255,50,50,0.2)',
            }}
          >
            <AlertCircle className="w-5 h-5 text-red-400" />
            <p className="text-sm text-red-400">{error}</p>
            <button
              onClick={() => setError(null)}
              className="ml-auto text-red-400/50 hover:text-red-400"
            >
              ×
            </button>
          </div>
        )}

        {/* Brand filter */}
        {brands.length > 0 && (
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <button
              onClick={() => setBrandFilter('all')}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
              style={{
                backgroundColor: brandFilter === 'all' ? 'rgba(200,184,154,0.2)' : 'rgba(255,255,255,0.03)',
                color: brandFilter === 'all' ? '#C8B89A' : '#666',
                border: brandFilter === 'all' ? '1px solid rgba(200,184,154,0.3)' : '1px solid rgba(255,255,255,0.06)',
              }}
            >
              All Brands ({batches.length})
            </button>
            {brands.map((brand) => {
              const count = batches.filter((b) => b.brand_id === brand.id).length;
              return (
                <button
                  key={brand.id}
                  onClick={() => setBrandFilter(brand.id)}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                  style={{
                    backgroundColor: brandFilter === brand.id ? 'rgba(200,184,154,0.2)' : 'rgba(255,255,255,0.03)',
                    color: brandFilter === brand.id ? '#C8B89A' : '#666',
                    border: brandFilter === brand.id ? '1px solid rgba(200,184,154,0.3)' : '1px solid rgba(255,255,255,0.06)',
                  }}
                >
                  {brand.name} ({count})
                </button>
              );
            })}
          </div>
        )}

        {/* Pipeline stats bar */}
        <div className="flex items-center gap-2 mb-8 p-3 rounded-xl bg-white/[0.02] border border-white/5">
          {[
            { key: 'new', count: newBatches.length },
            { key: 'building', count: buildingBatches.length },
            { key: 'ready', count: readyBatches.length },
            { key: 'launched', count: launchedBatches.length },
          ].map((item, i) => {
            const cfg = statusConfig[item.key as keyof typeof statusConfig];
            return (
              <div key={item.key} className="flex items-center gap-2">
                {i > 0 && <ArrowRight className="w-3.5 h-3.5 text-gray-600" />}
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg"
                  style={{ backgroundColor: cfg.bg }}>
                  <span className="text-xs font-semibold" style={{ color: cfg.color }}>
                    {cfg.label}
                  </span>
                  <span
                    className="text-xs font-bold px-1.5 py-0.5 rounded"
                    style={{
                      backgroundColor: `${cfg.color}20`,
                      color: cfg.color,
                    }}
                  >
                    {item.count}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Queue sections */}
        <QueueSection
          title="New Batches"
          status="new"
          batches={newBatches}
          onDownload={handleDownload}
          onStatusChange={handleStatusChange}
          onDelete={handleDelete}
          downloading={downloading}
        />

        <QueueSection
          title="Building"
          status="building"
          batches={buildingBatches}
          onDownload={handleDownload}
          onStatusChange={handleStatusChange}
          onDelete={handleDelete}
          downloading={downloading}
        />

        <QueueSection
          title="Ready to Launch"
          status="ready"
          batches={readyBatches}
          onDownload={handleDownload}
          onStatusChange={handleStatusChange}
          onDelete={handleDelete}
          downloading={downloading}
        />

        <QueueSection
          title="Launched Archive"
          status="launched"
          batches={launchedBatches}
          onDownload={handleDownload}
          onStatusChange={handleStatusChange}
          onDelete={handleDelete}
          downloading={downloading}
          defaultOpen={false}
        />
      </div>
    </Navbar>
  );
}
