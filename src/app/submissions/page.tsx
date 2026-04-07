'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Loader,
  AlertCircle,
  Inbox,
  Hammer,
  Rocket,
  Archive,
  ChevronDown,
  ChevronUp,
  Package,
  Image,
  Video,
  FileText,
  Music,
  ExternalLink,
  ArrowRight,
  Play,
} from 'lucide-react';
import Navbar from '@/components/Navbar';
import { createClient } from '@/lib/supabase';

interface BatchFile {
  id: string;
  file_name: string;
  file_url: string;
  file_type: string | null;
  media_format: string | null;
  aspect_ratio: string | null;
}

interface BatchSubmission {
  id: string;
  batch_name: string;
  creative_type: string;
  creator_name: string;
  landing_page_url: string;
  copy_title: string;
  is_carousel: boolean;
  is_flexible: boolean;
  is_whitelist: boolean;
  batch_status: 'new' | 'building' | 'ready' | 'launched';
  launched_at: string | null;
  created_at: string;
  file_count: number;
  files: BatchFile[];
}

const statusConfig = {
  new: {
    label: 'Submitted',
    color: '#C8B89A',
    bg: 'rgba(200,184,154,0.10)',
    border: 'rgba(200,184,154,0.22)',
    icon: Inbox,
  },
  building: {
    label: 'In Production',
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

function NoPermissionState() {
  return (
    <Navbar>
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center max-w-sm">
          <div className="w-12 h-12 rounded-xl mx-auto mb-4 flex items-center justify-center" style={{ backgroundColor: 'rgba(255,50,50,0.1)' }}>
            <AlertCircle className="w-6 h-6 text-red-400" />
          </div>
          <h2 className="text-lg font-bold text-[#F5F5F8] mb-2">Pipeline Access Restricted</h2>
          <p className="text-sm text-gray-500">
            You don&apos;t have permission to view the pipeline. Contact your admin to request access.
          </p>
        </div>
      </div>
    </Navbar>
  );
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

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// ─── File Thumbnail ────────────────────────────────────────────
function FileThumbnail({ file }: { file: BatchFile }) {
  const [imgError, setImgError] = useState(false);
  const url = file.file_url ? getStorageUrl(file.file_url) : '';

  return (
    <div
      className="rounded-lg overflow-hidden relative group"
      style={{
        backgroundColor: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      {/* Thumbnail area */}
      <div className="aspect-square w-full relative bg-black/20 flex items-center justify-center">
        {isImageFile(file) && url && !imgError ? (
          <img
            src={url}
            alt={file.file_name}
            className="w-full h-full object-cover"
            onError={() => setImgError(true)}
          />
        ) : isVideoFile(file) && url && !imgError ? (
          <div
            className="relative w-full h-full cursor-pointer"
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
              onError={() => setImgError(true)}
              onEnded={(e) => {
                const overlay = (e.currentTarget as HTMLElement).parentElement?.querySelector('.play-overlay') as HTMLElement;
                overlay?.classList.remove('opacity-0');
              }}
            />
            <div className="play-overlay absolute inset-0 flex items-center justify-center transition-opacity duration-200">
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center"
                style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
              >
                <Play className="w-4 h-4 text-white ml-0.5" />
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1">
            <FileText className="w-6 h-6 text-gray-600" />
          </div>
        )}
      </div>

      {/* File info */}
      <div className="p-2">
        <p className="text-[10px] text-gray-400 truncate">{file.file_name}</p>
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
}

// ─── Batch Card ────────────────────────────────────────────────
function BatchCard({ batch }: { batch: BatchSubmission }) {
  const [expanded, setExpanded] = useState(false);
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
          <div
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{ backgroundColor: config.color }}
          />

          <div className="flex-1 min-w-0">
            <span className="font-semibold text-[#F5F5F8] text-sm">
              {batch.batch_name}
            </span>
            <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-500">
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

          <span
            className="text-xs font-semibold px-2.5 py-1 rounded-lg flex-shrink-0"
            style={{ backgroundColor: config.bg, color: config.color }}
          >
            {config.label}
          </span>

          {expanded ? (
            <ChevronUp className="w-4 h-4 text-gray-500 flex-shrink-0" />
          ) : (
            <ChevronDown className="w-4 h-4 text-gray-500 flex-shrink-0" />
          )}
        </div>
      </div>

      {/* Expanded */}
      {expanded && (
        <div className="border-t border-white/5 p-4 space-y-4">
          {/* Context info */}
          <div className="flex flex-wrap gap-4 text-xs">
            {batch.landing_page_url && (
              <div>
                <span className="text-gray-500 block mb-0.5">Landing Page</span>
                <a
                  href={batch.landing_page_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-amber-400 hover:underline flex items-center gap-1"
                >
                  {batch.landing_page_url.replace(/^https?:\/\//, '').slice(0, 40)}
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            )}
            {batch.copy_title && (
              <div>
                <span className="text-gray-500 block mb-0.5">Copy Template</span>
                <span className="text-gray-300">{batch.copy_title}</span>
              </div>
            )}
            {batch.creator_name && (
              <div>
                <span className="text-gray-500 block mb-0.5">Creator</span>
                <span className="text-gray-300">{batch.creator_name}</span>
              </div>
            )}
          </div>

          {/* File thumbnails grid */}
          {batch.files.length > 0 && (
            <div>
              <span className="text-xs text-gray-500 mb-2 block">
                Files ({batch.files.length})
              </span>
              <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
                {batch.files.map((file) => (
                  <FileThumbnail key={file.id} file={file} />
                ))}
              </div>
            </div>
          )}

          {/* Pipeline progress */}
          <div className="flex items-center gap-1 pt-2">
            {(['new', 'building', 'ready', 'launched'] as const).map((step, i) => {
              const stepCfg = statusConfig[step];
              const isActive = step === batch.batch_status;
              const isPast =
                ['new', 'building', 'ready', 'launched'].indexOf(step) <
                ['new', 'building', 'ready', 'launched'].indexOf(batch.batch_status);

              return (
                <div key={step} className="flex items-center gap-1">
                  {i > 0 && (
                    <div
                      className="w-6 h-px"
                      style={{
                        backgroundColor: isPast ? stepCfg.color : 'rgba(255,255,255,0.08)',
                      }}
                    />
                  )}
                  <div
                    className="w-2 h-2 rounded-full"
                    style={{
                      backgroundColor: isActive || isPast ? stepCfg.color : 'rgba(255,255,255,0.1)',
                      boxShadow: isActive ? `0 0 6px ${stepCfg.color}50` : 'none',
                    }}
                  />
                  <span
                    className="text-[10px]"
                    style={{
                      color: isActive ? stepCfg.color : isPast ? '#666' : 'rgba(255,255,255,0.15)',
                      fontWeight: isActive ? 600 : 400,
                    }}
                  >
                    {stepCfg.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Pipeline Section ──────────────────────────────────────────
function PipelineSection({
  title,
  status,
  batches,
  defaultOpen = true,
}: {
  title: string;
  status: keyof typeof statusConfig;
  batches: BatchSubmission[];
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
        <Icon className="w-5 h-5 flex-shrink-0" style={{ color: config.color }} />
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
            <p className="text-sm text-gray-600 py-4 text-center">No batches here</p>
          ) : (
            batches.map((batch) => <BatchCard key={batch.id} batch={batch} />)
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────
export default function SubmissionsPage() {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [noPermission, setNoPermission] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [batches, setBatches] = useState<BatchSubmission[]>([]);

  const fetchData = useCallback(async () => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        router.push('/');
        return;
      }

      const { data: profile } = await supabase
        .from('users_profile')
        .select('role, brand_id')
        .eq('id', session.user.id)
        .single();

      if (!profile) {
        setError('Profile not found');
        setLoading(false);
        return;
      }

      // Check pipeline permission for non-admin users
      if (profile.role === 'strategist') {
        const { data: perms } = await supabase
          .from('user_permissions')
          .select('can_view_pipeline')
          .eq('user_id', session.user.id)
          .single();

        if (perms && !perms.can_view_pipeline) {
          setNoPermission(true);
          setLoading(false);
          return;
        }
      }

      let query = supabase
        .from('submissions')
        .select(`
          id, batch_name, creative_type, creator_name, landing_page_url,
          copy_title, is_carousel, is_flexible, is_whitelist,
          batch_status, launched_at, created_at, file_count,
          submission_files (
            id, file_name, file_url, file_type, media_format, aspect_ratio
          )
        `)
        .order('created_at', { ascending: false });

      if (profile.role !== 'admin') {
        query = query.eq('brand_id', profile.brand_id);
      }

      const { data: submissions, error: subError } = await query;

      if (subError) {
        setError('Failed to load submissions');
        console.error('Fetch error:', subError);
      } else {
        const mapped: BatchSubmission[] = (submissions || []).map((s: any) => ({
          ...s,
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

  if (loading) {
    return (
      <Navbar>
        <div className="min-h-screen flex items-center justify-center">
          <Loader className="w-8 h-8 text-[#C8B89A] animate-spin" />
        </div>
      </Navbar>
    );
  }

  if (noPermission) {
    return <NoPermissionState />;
  }

  const newBatches = batches.filter((b) => b.batch_status === 'new');
  const buildingBatches = batches.filter((b) => b.batch_status === 'building');
  const readyBatches = batches.filter((b) => b.batch_status === 'ready');
  const launchedBatches = batches.filter((b) => b.batch_status === 'launched');

  return (
    <Navbar>
      <div className="max-w-5xl mx-auto px-6 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-[#F5F5F8] tracking-tight">
            My Pipeline
          </h1>
          <p className="text-sm text-[#ABABAB] mt-1">
            Track your batches through the creative pipeline
          </p>
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
                <div
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg"
                  style={{ backgroundColor: cfg.bg }}
                >
                  <span className="text-xs font-semibold" style={{ color: cfg.color }}>
                    {cfg.label}
                  </span>
                  <span
                    className="text-xs font-bold px-1.5 py-0.5 rounded"
                    style={{ backgroundColor: `${cfg.color}20`, color: cfg.color }}
                  >
                    {item.count}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Pipeline sections */}
        <PipelineSection title="Submitted" status="new" batches={newBatches} />
        <PipelineSection title="In Production" status="building" batches={buildingBatches} />
        <PipelineSection title="Ready to Launch" status="ready" batches={readyBatches} />
        <PipelineSection
          title="Launched"
          status="launched"
          batches={launchedBatches}
          defaultOpen={false}
        />

        {batches.length === 0 && (
          <div className="text-center py-16">
            <Package className="w-12 h-12 text-gray-600 mx-auto mb-4" />
            <p className="text-gray-500">No submissions yet</p>
            <p className="text-sm text-gray-600 mt-1">
              Upload your first batch to see it here
            </p>
          </div>
        )}
      </div>
    </Navbar>
  );
}
