'use client';

import React from 'react';
import { Clock, Eye, Check, Calendar, Zap, AlertCircle, Archive } from 'lucide-react';

interface StatusBadgeProps {
  status: string;
  size?: 'sm' | 'md';
}

const statusConfig: Record<string, { bg: string; text: string; border: string; label: string; Icon: React.ElementType }> = {
  pending: { bg: 'rgba(255,159,64,0.1)', text: '#FF9F40', border: 'rgba(255,159,64,0.2)', label: 'Pending', Icon: Clock },
  in_review: { bg: 'rgba(100,180,255,0.1)', text: '#64B4FF', border: 'rgba(100,180,255,0.2)', label: 'In Review', Icon: Eye },
  approved: { bg: 'rgba(76,175,80,0.1)', text: '#4CAF50', border: 'rgba(76,175,80,0.2)', label: 'Approved', Icon: Check },
  scheduled: { bg: 'rgba(200,184,154,0.1)', text: '#C8B89A', border: 'rgba(200,184,154,0.2)', label: 'Scheduled', Icon: Calendar },
  live: { bg: 'rgba(76,175,80,0.15)', text: '#66BB6A', border: 'rgba(76,175,80,0.3)', label: 'Live', Icon: Zap },
  paused: { bg: 'rgba(255,152,0,0.1)', text: '#FF9800', border: 'rgba(255,152,0,0.2)', label: 'Paused', Icon: AlertCircle },
  killed: { bg: 'rgba(244,67,54,0.1)', text: '#F44336', border: 'rgba(244,67,54,0.2)', label: 'Killed', Icon: Archive },
};

export function StatusBadge({ status, size = 'sm' }: StatusBadgeProps) {
  const config = statusConfig[status] || statusConfig.pending;
  const { Icon } = config;
  const sizeClasses = size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm';

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-lg font-medium ${sizeClasses}`}
      style={{
        backgroundColor: config.bg,
        color: config.text,
        border: `1px solid ${config.border}`,
      }}
    >
      <Icon size={size === 'sm' ? 12 : 14} />
      {config.label}
    </span>
  );
}
