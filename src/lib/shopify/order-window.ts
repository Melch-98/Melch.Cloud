const DAY_MS = 24 * 60 * 60 * 1000;
const OVERLAP_MS = 2 * 60 * 60 * 1000;
const FLOOR_MS = 2 * DAY_MS;
const EMPTY_LOOKBACK_MS = 7 * DAY_MS;

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
