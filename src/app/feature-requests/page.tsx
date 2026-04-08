'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Loader,
  Lightbulb,
  Plus,
  X,
  Check,
  ArrowUp,
  ArrowDown,
  MessageSquare,
  CheckCircle2,
  XCircle,
  Circle,
  Wrench,
  ClipboardList,
} from 'lucide-react';
import Navbar from '@/components/Navbar';
import { createClient } from '@/lib/supabase';

// ─── Brand Palette ──────────────────────────────────────────────
const GOLD = '#C8B89A';
const GOLD_LIGHT = '#D9CBAE';
const GOLD_DIM = 'rgba(200,184,154,0.18)';
const GOLD_BORDER = 'rgba(200,184,154,0.30)';
const BG_CARD = '#111111';
const BG_COLUMN = 'rgba(255,255,255,0.02)';
const BORDER = 'rgba(200,184,154,0.10)';
const BORDER_STRONG = 'rgba(200,184,154,0.18)';
const TEXT_PRIMARY = '#F5F5F8';
const TEXT_MUTED = '#999';
const TEXT_DIM = '#666';

// ─── Types ──────────────────────────────────────────────────────

type RequestStatus = 'triage' | 'spec_ready' | 'building' | 'shipped' | 'declined';

interface FeatureRequest {
  id: string;
  title: string;
  description: string | null;
  status: RequestStatus;
  category: string;
  submitted_by: string;
  submitted_by_email: string;
  submitted_by_role: string;
  brand_id: string | null;
  admin_note: string | null;
  created_at: string;
  score: number;
  upvotes: number;
  downvotes: number;
  user_vote: number;
}

const STATUS_CONFIG: Record<RequestStatus, { label: string; color: string; icon: React.ElementType; description: string }> = {
  triage:     { label: 'Triage',     color: TEXT_MUTED, icon: Circle,        description: 'New requests awaiting review' },
  spec_ready: { label: 'Spec Ready', color: '#5DADE2',  icon: ClipboardList, description: 'Scoped and ready to build' },
  building:   { label: 'Building',   color: '#E8A838',  icon: Wrench,        description: 'In progress right now' },
  shipped:    { label: 'Shipped',    color: '#2ECC71',  icon: CheckCircle2,  description: 'Live in melch.cloud' },
  declined:   { label: 'Declined',   color: '#E74C3C',  icon: XCircle,       description: 'Not moving forward' },
};

// Primary Kanban columns (declined hidden by default)
const KANBAN_COLUMNS: RequestStatus[] = ['triage', 'spec_ready', 'building', 'shipped'];

const CATEGORIES = [
  { value: 'general',      label: 'General' },
  { value: 'analytics',    label: 'Analytics' },
  { value: 'calendar',     label: 'Calendar' },
  { value: 'upload',       label: 'Upload' },
  { value: 'integrations', label: 'Integrations' },
  { value: 'ui',           label: 'UI / Design' },
];

// ─── Helpers ────────────────────────────────────────────────────

function getTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ─── Vote Control ───────────────────────────────────────────────

function VoteControl({
  score,
  userVote,
  onVote,
  disabled,
}: {
  score: number;
  userVote: number;
  onVote: (vote: number) => void;
  disabled: boolean;
}) {
  const scoreColor = score > 0 ? '#2ECC71' : score < 0 ? '#E74C3C' : TEXT_DIM;
  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => onVote(userVote === 1 ? 0 : 1)}
        disabled={disabled}
        className="p-0.5 rounded transition-all"
        style={{
          color: userVote === 1 ? '#2ECC71' : TEXT_DIM,
          backgroundColor: userVote === 1 ? '#2ECC7115' : 'transparent',
        }}
        title="Upvote"
      >
        <ArrowUp size={14} strokeWidth={userVote === 1 ? 3 : 2} />
      </button>
      <span className="text-xs font-bold tabular-nums" style={{ color: scoreColor }}>
        {score}
      </span>
      <button
        onClick={() => onVote(userVote === -1 ? 0 : -1)}
        disabled={disabled}
        className="p-0.5 rounded transition-all"
        style={{
          color: userVote === -1 ? '#E74C3C' : TEXT_DIM,
          backgroundColor: userVote === -1 ? '#E74C3C15' : 'transparent',
        }}
        title="Downvote"
      >
        <ArrowDown size={14} strokeWidth={userVote === -1 ? 3 : 2} />
      </button>
    </div>
  );
}

// ─── Request Card (Kanban tile) ─────────────────────────────────

function RequestCard({
  request,
  isAdmin,
  onVote,
  onStatusChange,
  voting,
}: {
  request: FeatureRequest;
  isAdmin: boolean;
  onVote: (featureId: string, vote: number) => void;
  onStatusChange: (featureId: string, status: RequestStatus) => void;
  voting: boolean;
}) {
  const [showStatusDropdown, setShowStatusDropdown] = useState(false);
  const categoryLabel = CATEGORIES.find((c) => c.value === request.category)?.label || request.category;
  const timeAgo = getTimeAgo(request.created_at);

  return (
    <div
      className="rounded-lg p-3 transition-all"
      style={{
        backgroundColor: BG_CARD,
        border: `1px solid ${BORDER_STRONG}`,
      }}
    >
      {/* Header: category + time + score */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <span
          className="text-[9px] px-1.5 py-[2px] rounded font-bold uppercase tracking-wider"
          style={{ backgroundColor: 'rgba(255,255,255,0.04)', color: TEXT_DIM, border: '1px solid rgba(255,255,255,0.06)' }}
        >
          {categoryLabel}
        </span>
        <VoteControl
          score={request.score}
          userVote={request.user_vote}
          onVote={(vote) => onVote(request.id, vote)}
          disabled={voting}
        />
      </div>

      {/* Title */}
      <h4 className="text-sm font-bold leading-snug" style={{ color: TEXT_PRIMARY }}>
        {request.title}
      </h4>

      {/* Description (truncated) */}
      {request.description && (
        <p
          className="text-xs mt-1 leading-relaxed line-clamp-3"
          style={{ color: TEXT_MUTED }}
        >
          {request.description}
        </p>
      )}

      {/* Admin note */}
      {request.admin_note && (
        <div
          className="mt-2 px-2 py-1.5 rounded flex items-start gap-1.5"
          style={{ backgroundColor: `${GOLD}08`, border: `1px solid ${GOLD}15` }}
        >
          <MessageSquare size={10} style={{ color: GOLD, marginTop: '2px', flexShrink: 0 }} />
          <p className="text-[11px] leading-relaxed" style={{ color: GOLD_LIGHT }}>
            {request.admin_note}
          </p>
        </div>
      )}

      {/* Footer: submitter + admin status control */}
      <div className="flex items-center justify-between gap-2 mt-2.5 pt-2" style={{ borderTop: `1px solid ${BORDER}` }}>
        <span className="text-[10px] truncate" style={{ color: TEXT_DIM }}>
          {request.submitted_by_email?.split('@')[0]} · {timeAgo}
        </span>

        {isAdmin && (
          <div className="relative flex-shrink-0">
            <button
              onClick={() => setShowStatusDropdown(!showStatusDropdown)}
              className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded transition-colors"
              style={{
                color: TEXT_DIM,
                backgroundColor: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.06)',
              }}
              title="Move"
            >
              Move →
            </button>
            {showStatusDropdown && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setShowStatusDropdown(false)} />
                <div
                  className="absolute bottom-full right-0 mb-1 w-40 rounded-lg py-1 z-40"
                  style={{ backgroundColor: '#1A1A1A', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}
                >
                  {(Object.entries(STATUS_CONFIG) as [RequestStatus, typeof STATUS_CONFIG[RequestStatus]][]).map(
                    ([key, config]) => {
                      const StatusIcon = config.icon;
                      return (
                        <button
                          key={key}
                          onClick={() => {
                            onStatusChange(request.id, key);
                            setShowStatusDropdown(false);
                          }}
                          className="w-full text-left px-3 py-2 text-xs flex items-center gap-2 transition-colors"
                          style={{
                            color: request.status === key ? config.color : '#CCC',
                            backgroundColor: request.status === key ? `${config.color}10` : 'transparent',
                          }}
                        >
                          <StatusIcon size={12} />
                          {config.label}
                          {request.status === key && <Check size={10} className="ml-auto" />}
                        </button>
                      );
                    }
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Kanban Column ──────────────────────────────────────────────

function KanbanColumn({
  status,
  requests,
  isAdmin,
  onVote,
  onStatusChange,
  voting,
}: {
  status: RequestStatus;
  requests: FeatureRequest[];
  isAdmin: boolean;
  onVote: (featureId: string, vote: number) => void;
  onStatusChange: (featureId: string, status: RequestStatus) => void;
  voting: boolean;
}) {
  const config = STATUS_CONFIG[status];
  const Icon = config.icon;

  return (
    <div
      className="flex flex-col rounded-xl min-w-[280px] w-[280px]"
      style={{
        backgroundColor: BG_COLUMN,
        border: `1px solid ${BORDER}`,
      }}
    >
      {/* Column header */}
      <div
        className="px-4 py-3 flex items-center justify-between"
        style={{ borderBottom: `1px solid ${BORDER}` }}
      >
        <div className="flex items-center gap-2">
          <Icon size={14} style={{ color: config.color }} />
          <h3 className="text-xs font-bold uppercase tracking-wider" style={{ color: config.color }}>
            {config.label}
          </h3>
          <span
            className="text-[10px] px-1.5 py-0.5 rounded-full font-bold tabular-nums"
            style={{
              backgroundColor: `${config.color}15`,
              color: config.color,
              border: `1px solid ${config.color}30`,
            }}
          >
            {requests.length}
          </span>
        </div>
      </div>

      {/* Cards */}
      <div className="p-2 flex-1 space-y-2 overflow-y-auto max-h-[calc(100vh-280px)]">
        {requests.length === 0 ? (
          <div
            className="rounded-lg py-6 px-3 text-center"
            style={{ backgroundColor: 'rgba(255,255,255,0.02)', border: `1px dashed ${BORDER}` }}
          >
            <p className="text-[11px]" style={{ color: TEXT_DIM }}>
              {config.description}
            </p>
          </div>
        ) : (
          requests.map((req) => (
            <RequestCard
              key={req.id}
              request={req}
              isAdmin={isAdmin}
              onVote={onVote}
              onStatusChange={onStatusChange}
              voting={voting}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ─── Submit Modal ───────────────────────────────────────────────

function SubmitRequestModal({
  open,
  onClose,
  onSubmit,
  saving,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (title: string, description: string, category: string) => void;
  saving: boolean;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('general');

  useEffect(() => {
    if (open) { setTitle(''); setDescription(''); setCategory('general'); }
  }, [open]);

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-40" onClick={onClose} />
      <div
        className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg rounded-xl p-6 z-50 space-y-4"
        style={{ backgroundColor: '#141414', border: '1px solid rgba(255,255,255,0.08)' }}
      >
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-lg font-bold" style={{ color: TEXT_PRIMARY }}>Request a Feature</h3>
            <p className="text-xs mt-1" style={{ color: TEXT_DIM }}>
              Describe what you&apos;d like to see in melch.cloud.
            </p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-white/5" style={{ color: TEXT_DIM }}>
            <X size={16} />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-[10px] font-medium block mb-1.5 uppercase tracking-wider" style={{ color: TEXT_DIM }}>Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Dark mode for the upload page"
              autoFocus
              className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
              style={{ backgroundColor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: TEXT_PRIMARY }}
            />
          </div>

          <div>
            <label className="text-[10px] font-medium block mb-1.5 uppercase tracking-wider" style={{ color: TEXT_DIM }}>Description (optional)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add more detail about what you're looking for..."
              rows={3}
              className="w-full px-3 py-2.5 rounded-lg text-sm outline-none resize-none"
              style={{ backgroundColor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: TEXT_PRIMARY }}
            />
          </div>

          <div>
            <label className="text-[10px] font-medium block mb-1.5 uppercase tracking-wider" style={{ color: TEXT_DIM }}>Category</label>
            <div className="flex flex-wrap gap-1.5">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.value}
                  onClick={() => setCategory(cat.value)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                  style={{
                    backgroundColor: category === cat.value ? GOLD_DIM : 'rgba(255,255,255,0.04)',
                    color: category === cat.value ? GOLD : TEXT_MUTED,
                    border: `1px solid ${category === cat.value ? GOLD_BORDER : 'rgba(255,255,255,0.06)'}`,
                  }}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium" style={{ color: TEXT_MUTED }}>
            Cancel
          </button>
          <button
            onClick={() => { if (title.trim()) onSubmit(title.trim(), description.trim(), category); }}
            disabled={!title.trim() || saving}
            className="px-4 py-2 rounded-lg text-sm font-bold transition-all"
            style={{
              backgroundColor: title.trim() ? GOLD : `${GOLD}30`,
              color: title.trim() ? '#0A0A0A' : '#666',
              opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? 'Submitting...' : 'Submit Request'}
          </button>
        </div>
      </div>
    </>
  );
}

// ═════════════════════════════════════════════════════════════════
// ─── Main Page ──────────────────────────────────────────────────
// ═════════════════════════════════════════════════════════════════

export default function FeatureRequestsPage() {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState<string | null>(null);

  const [requests, setRequests] = useState<FeatureRequest[]>([]);
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [voting, setVoting] = useState(false);
  const [showDeclined, setShowDeclined] = useState(false);
  const [toast, setToast] = useState('');

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2500);
  };

  const getAuthHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return {};
    return { Authorization: `Bearer ${session.access_token}` };
  }, [supabase]);

  // Auth check
  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push('/'); return; }

      const { data: profile } = await supabase
        .from('users_profile')
        .select('role')
        .eq('id', session.user.id)
        .single();

      setUserRole(profile?.role || null);
      setLoading(false);
    };
    checkAuth();
  }, [supabase, router]);

  // Fetch feature requests
  const fetchRequests = useCallback(async () => {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/feature-requests', { headers });
      if (res.ok) {
        const json = await res.json();
        setRequests(json.requests || []);
      }
    } catch {
      // table might not exist yet
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    if (!loading) fetchRequests();
  }, [loading, fetchRequests]);

  // Submit request
  const handleSubmit = useCallback(async (title: string, description: string, category: string) => {
    setSaving(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/feature-requests', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description, category }),
      });
      if (res.ok) {
        const json = await res.json();
        setRequests((prev) => [json.request, ...prev]);
        setShowSubmitModal(false);
        showToast('Feature request submitted');
      }
    } catch {
      showToast('Failed to submit');
    }
    setSaving(false);
  }, [getAuthHeaders]);

  // Vote
  const handleVote = useCallback(async (featureId: string, vote: number) => {
    setVoting(true);
    setRequests((prev) =>
      prev.map((r) => {
        if (r.id !== featureId) return r;
        const oldVote = r.user_vote;
        const scoreDelta = vote - oldVote;
        return {
          ...r,
          user_vote: vote,
          score: r.score + scoreDelta,
          upvotes: r.upvotes + (vote === 1 ? 1 : 0) - (oldVote === 1 ? 1 : 0),
          downvotes: r.downvotes + (vote === -1 ? 1 : 0) - (oldVote === -1 ? 1 : 0),
        };
      })
    );

    try {
      const headers = await getAuthHeaders();
      await fetch('/api/feature-requests/vote', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ feature_id: featureId, vote }),
      });
    } catch {
      fetchRequests();
    }
    setVoting(false);
  }, [getAuthHeaders, fetchRequests]);

  // Admin status change
  const handleStatusChange = useCallback(async (featureId: string, status: RequestStatus) => {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/feature-requests/status', {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ feature_id: featureId, status }),
      });
      if (res.ok) {
        setRequests((prev) =>
          prev.map((r) => (r.id === featureId ? { ...r, status } : r))
        );
        showToast(`Moved to ${STATUS_CONFIG[status].label}`);
      }
    } catch {
      showToast('Failed to update status');
    }
  }, [getAuthHeaders]);

  if (loading) {
    return (
      <Navbar>
        <div className="min-h-screen flex items-center justify-center">
          <Loader className="w-8 h-8 animate-spin" style={{ color: GOLD }} />
        </div>
      </Navbar>
    );
  }

  const isAdmin = userRole === 'admin';

  // Group by status, sorted by score (desc) then newest within each column
  const grouped: Record<RequestStatus, FeatureRequest[]> = {
    triage: [],
    spec_ready: [],
    building: [],
    shipped: [],
    declined: [],
  };
  for (const r of requests) {
    if (grouped[r.status]) grouped[r.status].push(r);
    else grouped.triage.push(r); // fallback for legacy statuses
  }
  for (const key of Object.keys(grouped) as RequestStatus[]) {
    grouped[key].sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }

  const visibleColumns: RequestStatus[] = showDeclined
    ? [...KANBAN_COLUMNS, 'declined']
    : KANBAN_COLUMNS;

  const declinedCount = grouped.declined.length;

  return (
    <Navbar>
      <div className="p-6 md:p-8">
        {/* ─── Header ──────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 max-w-[1600px] mx-auto">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <Lightbulb size={24} style={{ color: GOLD_LIGHT }} />
              <h1 className="text-2xl font-bold tracking-tight" style={{ color: TEXT_PRIMARY }}>
                Feature Requests
              </h1>
            </div>
            <p className="text-sm" style={{ color: TEXT_DIM }}>
              Shape what&apos;s next in melch.cloud — submit ideas, vote on what matters, track progress.
            </p>
          </div>

          <div className="flex items-center gap-2">
            {declinedCount > 0 && (
              <button
                onClick={() => setShowDeclined(!showDeclined)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all"
                style={{
                  backgroundColor: showDeclined ? 'rgba(231,76,60,0.15)' : 'rgba(255,255,255,0.04)',
                  color: showDeclined ? '#E74C3C' : TEXT_DIM,
                  border: `1px solid ${showDeclined ? 'rgba(231,76,60,0.30)' : 'rgba(255,255,255,0.06)'}`,
                }}
              >
                <XCircle size={12} />
                {showDeclined ? 'Hide' : 'Show'} Declined ({declinedCount})
              </button>
            )}
            <button
              onClick={() => setShowSubmitModal(true)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-bold transition-all"
              style={{ backgroundColor: GOLD, color: '#0A0A0A' }}
            >
              <Plus size={16} />
              Submit Request
            </button>
          </div>
        </div>

        {/* ─── Kanban Board ─────────────────────────────────── */}
        <div className="overflow-x-auto pb-4 max-w-[1600px] mx-auto">
          <div className="flex gap-4 min-w-fit">
            {visibleColumns.map((status) => (
              <KanbanColumn
                key={status}
                status={status}
                requests={grouped[status]}
                isAdmin={isAdmin}
                onVote={handleVote}
                onStatusChange={handleStatusChange}
                voting={voting}
              />
            ))}
          </div>
        </div>

        {/* Empty state */}
        {requests.length === 0 && (
          <div
            className="rounded-xl py-16 text-center mt-6 max-w-md mx-auto"
            style={{ backgroundColor: BG_CARD, border: `1px solid ${BORDER_STRONG}` }}
          >
            <Lightbulb size={32} style={{ color: TEXT_DIM }} className="mx-auto mb-3" />
            <p className="text-sm font-medium" style={{ color: TEXT_MUTED }}>
              No feature requests yet. Be the first!
            </p>
            <button
              onClick={() => setShowSubmitModal(true)}
              className="mt-4 px-4 py-2 rounded-lg text-sm font-bold"
              style={{ backgroundColor: GOLD, color: '#0A0A0A' }}
            >
              Submit a Request
            </button>
          </div>
        )}
      </div>

      {/* Modals */}
      <SubmitRequestModal
        open={showSubmitModal}
        onClose={() => setShowSubmitModal(false)}
        onSubmit={handleSubmit}
        saving={saving}
      />

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
