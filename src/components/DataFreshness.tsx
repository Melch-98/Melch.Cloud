'use client';

import { useState, useEffect } from 'react';
import { Clock, Wifi, WifiOff } from 'lucide-react';

interface DataFreshnessProps {
  cachedAt: string | null;
  isCached: boolean;
  className?: string;
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;

  if (diffMs < 60_000) return 'just now';
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function DataFreshness({ cachedAt, isCached, className = '' }: DataFreshnessProps) {
  const [, setTick] = useState(0);

  // Update every 30s so "just now" transitions
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  if (!cachedAt) return null;

  return (
    <div
      className={`flex items-center gap-1.5 text-xs ${className}`}
      style={{ color: isCached ? '#888' : '#6b8a6b' }}
      title={isCached ? `Cached data from ${new Date(cachedAt).toLocaleTimeString()}` : 'Fresh data from Meta'}
    >
      {isCached ? <Clock size={12} /> : <Wifi size={12} />}
      <span>{isCached ? 'Cached' : 'Live'} · {timeAgo(cachedAt)}</span>
    </div>
  );
}

// ─── Friendly Error Messages ────────────────────────────────────

const ERROR_MAP: [RegExp, string][] = [
  [/please reduce the amount of data/i, 'Too much data for this date range. Try a shorter period or fewer ads.'],
  [/application request limit/i, 'Meta API rate limit reached. Please wait a few minutes and try again.'],
  [/invalid oauth|error validating access token|session has expired/i, 'Your Meta access token has expired. Ask an admin to reconnect it in Settings.'],
  [/unknown error/i, 'Something went wrong. Please try again.'],
  [/failed to fetch/i, 'Network error — check your connection and try again.'],
  [/meta access token not configured/i, 'No Meta token found. An admin needs to set it up in Settings.'],
  [/error performing query|error code: 1/i, 'Meta couldn\'t process this query. Try a shorter date range.'],
  [/user request limit|too many calls/i, 'Too many requests. Please wait a moment and retry.'],
];

export function friendlyError(raw: string): string {
  for (const [pattern, friendly] of ERROR_MAP) {
    if (pattern.test(raw)) return friendly;
  }
  return raw;
}
