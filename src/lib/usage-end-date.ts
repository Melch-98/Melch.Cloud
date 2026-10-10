/** Calendar date in the browser's local zone, YYYY-MM-DD. */
export function localToday(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** UTC calendar date, YYYY-MM-DD. */
export function utcToday(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function shiftIsoDate(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/**
 * A date the uploader can still call "today". UTC-12 is one calendar day
 * behind UTC, so the server accepts UTC yesterday through any later date.
 */
export function isUsageEndDateAllowed(value: string, now = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return value >= shiftIsoDate(utcToday(now), -1);
}

export function showsUsageEndDate(input: {
  isWhitelist: boolean;
  creatorName: string;
  creatorHandle: string;
}): boolean {
  return (
    input.isWhitelist ||
    input.creatorName.trim().length > 0 ||
    input.creatorHandle.trim().length > 0
  );
}

/** Empty is allowed. A filled date must be today or later in `today`. */
export function usageEndDateError(value: string, today: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return 'Usage end date must be a date';
  if (trimmed < today) return 'Usage end date must be today or later';
  return null;
}
