const DAY_MS = 24 * 60 * 60 * 1000;
const OVERLAP_MS = 2 * 60 * 60 * 1000;
const FLOOR_MS = 2 * DAY_MS;
const EMPTY_LOOKBACK_MS = 7 * DAY_MS;
const ORDER_CAP_MS = 45 * DAY_MS;
/** Matches the Daily P&L slice so a long gap cannot fill the whole cron. */
const ORDER_CHUNK_MS = 10 * DAY_MS;

/**
 * Lower bound for the daily safety-net pull (`updated_at_min`).
 * Always covers the last 48 hours so a once-a-day run overlaps the previous
 * one and a missed webhook cannot stay stale for more than a day. Goes further
 * back when the newest stored order is older than that (2 hour overlap).
 * With no stored orders, look back 7 days.
 */
export function safetyNetSince(
  newestCreatedAt: string | null | undefined,
  nowMs: number
): string {
  const atLeastLastTwoDays = nowMs - FLOOR_MS;
  let since = nowMs - EMPTY_LOOKBACK_MS;
  if (newestCreatedAt) {
    const parsed = new Date(newestCreatedAt).getTime() - OVERLAP_MS;
    if (Number.isFinite(parsed)) since = parsed;
  }
  return new Date(Math.min(since, atLeastLastTwoDays)).toISOString();
}

export type OrderCatchUpPlan = {
  since: string;
  /** Set when this run stops before now. The next run continues here. */
  until: string | null;
  chunked: boolean;
};

/**
 * Safety-net order window, capped at 45 days.
 * A gap of 10 days or less is pulled through now (updated_at, so refunds land).
 * A longer gap is the oldest 10 days only. Pass the ISO timestamp saved when
 * the previous chunk finished so an empty stretch still moves forward.
 */
export function orderCatchUpPlan(
  newestCreatedAt: string | null | undefined,
  nowMs: number,
  resumeIso?: string | null
): OrderCatchUpPlan {
  const cap = nowMs - ORDER_CAP_MS;
  let sinceMs = Date.parse(safetyNetSince(newestCreatedAt, nowMs));
  if (!Number.isFinite(sinceMs)) sinceMs = cap;
  if (resumeIso) {
    const resumeMs = Date.parse(resumeIso);
    if (Number.isFinite(resumeMs)) sinceMs = Math.max(sinceMs, resumeMs);
  }
  if (sinceMs < cap) sinceMs = cap;
  if (nowMs - sinceMs <= ORDER_CHUNK_MS) {
    return { since: new Date(sinceMs).toISOString(), until: null, chunked: false };
  }
  return {
    since: new Date(sinceMs).toISOString(),
    until: new Date(sinceMs + ORDER_CHUNK_MS).toISOString(),
    chunked: true,
  };
}
