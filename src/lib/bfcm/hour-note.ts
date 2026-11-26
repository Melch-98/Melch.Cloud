/** One shop-hour note. Empty text deletes the row. */
export function normalizeHourNote(value: unknown): { ok: true; note: string } | { ok: false; error: string } {
  if (typeof value !== 'string') return { ok: false, error: 'Note must be text.' };
  const note = value.trim();
  if (note.length > 500) return { ok: false, error: 'Note is limited to 500 characters.' };
  return { ok: true, note };
}

export function normalizeHour(value: unknown): number | null {
  const hour = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  return hour;
}
