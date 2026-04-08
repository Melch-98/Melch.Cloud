'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Loader,
  Rocket,
  ChevronDown,
  ChevronUp,
  Tag,
  Zap,
} from 'lucide-react';
import Navbar from '@/components/Navbar';
import { createClient } from '@/lib/supabase';
import {
  RELEASES,
  CHANGE_TYPE_CONFIG,
  type ChangeType,
  type Release,
} from '@/lib/releases';

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

function TypeBadge({ type }: { type: ChangeType }) {
  const config = CHANGE_TYPE_CONFIG[type];
  return (
    <span
      className="inline-flex items-center px-1.5 py-[2px] rounded text-[9px] font-bold uppercase tracking-wider flex-shrink-0"
      style={{ backgroundColor: `${config.color}18`, color: config.color, border: `1px solid ${config.color}30` }}
    >
      {config.label}
    </span>
  );
}

function ReleaseCard({ release, isLatest }: { release: Release; isLatest: boolean }) {
  const [expanded, setExpanded] = useState(isLatest);
  const Icon = release.icon;

  return (
    <div
      className="rounded-xl overflow-hidden transition-all"
      style={{
        backgroundColor: BG_CARD,
        border: `1px solid ${isLatest ? GOLD_BORDER : BORDER_STRONG}`,
        boxShadow: isLatest ? '0 4px 24px rgba(200,184,154,0.08)' : '0 2px 12px rgba(0,0,0,0.2)',
      }}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left px-6 py-5 flex items-start gap-4 transition-colors"
        style={{ backgroundColor: expanded ? BG_HEADER : 'transparent' }}
      >
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
          style={{ backgroundColor: `${release.iconColor}15`, border: `1px solid ${release.iconColor}30` }}
        >
          <Icon size={18} style={{ color: release.iconColor }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <span
              className="text-xs font-bold px-2 py-0.5 rounded"
              style={{
                backgroundColor: isLatest ? `${GOLD}20` : 'rgba(255,255,255,0.06)',
                color: isLatest ? GOLD : TEXT_MUTED,
                border: isLatest ? `1px solid ${GOLD}30` : '1px solid rgba(255,255,255,0.08)',
              }}
            >
              v{release.version}
            </span>
            {isLatest && (
              <span
                className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                style={{ backgroundColor: '#2ECC7120', color: '#2ECC71', border: '1px solid #2ECC7130' }}
              >
                Latest
              </span>
            )}
            <span className="text-xs" style={{ color: TEXT_DIM }}>{release.date}</span>
          </div>
          <h3 className="text-base font-bold mt-1.5" style={{ color: TEXT_PRIMARY }}>{release.title}</h3>
          <p className="text-sm mt-1 leading-relaxed" style={{ color: TEXT_MUTED }}>{release.description}</p>
          <div className="flex flex-wrap gap-1.5 mt-3">
            {release.tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full"
                style={{ backgroundColor: 'rgba(255,255,255,0.04)', color: TEXT_DIM, border: '1px solid rgba(255,255,255,0.06)' }}
              >
                <Tag size={8} />{tag}
              </span>
            ))}
          </div>
        </div>
        <div className="flex-shrink-0 mt-1" style={{ color: TEXT_DIM }}>
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </button>
      {expanded && (
        <div className="px-6 pb-5 pt-2" style={{ borderTop: `1px solid ${BORDER}` }}>
          <div className="space-y-2.5 ml-14">
            {release.changes.map((change, i) => (
              <div key={i} className="flex items-start gap-2.5">
                <TypeBadge type={change.type} />
                <span className="text-sm leading-relaxed" style={{ color: '#CCC' }}>{change.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════
// ─── Main Page ──────────────────────────────────────────────────
// ═════════════════════════════════════════════════════════════════

export default function ReleasesPage() {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<ChangeType | 'all'>('all');

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push('/'); return; }
      setLoading(false);
    };
    checkAuth();
  }, [supabase, router]);

  if (loading) {
    return (
      <Navbar>
        <div className="min-h-screen flex items-center justify-center">
          <Loader className="w-8 h-8 animate-spin" style={{ color: GOLD }} />
        </div>
      </Navbar>
    );
  }

  const filteredReleases = filterType === 'all'
    ? RELEASES
    : RELEASES.map((r) => ({ ...r, changes: r.changes.filter((c) => c.type === filterType) })).filter((r) => r.changes.length > 0);

  const totalChanges = RELEASES.reduce((acc, r) => acc + r.changes.length, 0);

  return (
    <Navbar>
      <div className="p-6 md:p-8 max-w-4xl mx-auto">
        {/* ─── Header ──────────────────────────────────────── */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-2">
            <Rocket size={24} style={{ color: GOLD_LIGHT }} />
            <h1 className="text-2xl font-bold tracking-tight" style={{ color: TEXT_PRIMARY }}>
              Releases
            </h1>
          </div>
          <p className="text-sm" style={{ color: TEXT_DIM }}>
            Everything that&apos;s shipped to melch.cloud — {RELEASES.length} releases, {totalChanges} changes.
          </p>
        </div>

        {/* Type filters */}
        <div className="flex flex-wrap gap-2 mb-6">
          <button
            onClick={() => setFilterType('all')}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
            style={{
              backgroundColor: filterType === 'all' ? GOLD_DIM : 'rgba(255,255,255,0.04)',
              color: filterType === 'all' ? GOLD : TEXT_DIM,
              border: `1px solid ${filterType === 'all' ? GOLD_BORDER : 'rgba(255,255,255,0.06)'}`,
            }}
          >
            All
          </button>
          {(Object.entries(CHANGE_TYPE_CONFIG) as [ChangeType, { label: string; color: string }][]).map(
            ([type, config]) => (
              <button
                key={type}
                onClick={() => setFilterType(type)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                style={{
                  backgroundColor: filterType === type ? `${config.color}18` : 'rgba(255,255,255,0.04)',
                  color: filterType === type ? config.color : TEXT_DIM,
                  border: `1px solid ${filterType === type ? `${config.color}30` : 'rgba(255,255,255,0.06)'}`,
                }}
              >
                {config.label}
              </button>
            )
          )}
        </div>

        {/* Timeline */}
        <div className="relative">
          <div className="absolute left-[19px] top-0 bottom-0 w-[2px]" style={{ backgroundColor: BORDER_STRONG }} />
          <div className="space-y-6">
            {filteredReleases.map((release, i) => (
              <div key={release.version} className="relative flex items-start gap-6">
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 z-10"
                  style={{
                    backgroundColor: i === 0 ? `${GOLD}20` : BG_HEADER,
                    border: `2px solid ${i === 0 ? GOLD : BORDER_STRONG}`,
                  }}
                >
                  <Zap size={14} style={{ color: i === 0 ? GOLD : TEXT_DIM }} />
                </div>
                <div className="flex-1 min-w-0 -mt-1">
                  <ReleaseCard release={release} isLatest={i === 0} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="mt-12 text-center">
          <p className="text-xs" style={{ color: TEXT_DIM }}>
            melch.cloud is under active development. This log is updated with every release.
          </p>
        </div>
      </div>
    </Navbar>
  );
}
