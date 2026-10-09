/** How far a first run looks back, and how fresh windows overlap the last success. */
export const META_BACKFILL_MS = 7 * 24 * 60 * 60 * 1000;
export const GOOGLE_BACKFILL_MS = 14 * 24 * 60 * 60 * 1000;
export const META_OVERLAP_MS = 10 * 60 * 1000;
export const GOOGLE_OVERLAP_MS = 15 * 60 * 1000;
/** Google rejects a change_event window of 30 days. Stay inside 29. */
export const GOOGLE_MAX_WINDOW_MS = 29 * 24 * 60 * 60 * 1000;
/** Meta's activities edge is fetched in slices no longer than 7 days. */
export const META_SLICE_MS = 7 * 24 * 60 * 60 * 1000;

export const CHICAGO = 'America/Chicago';

export interface IngestionWindow {
  since: number;
  until: number;
}

export function ingestionWindow(opts: {
  platform: 'meta' | 'google';
  lastSuccessAt: string | null;
  now: number;
}): IngestionWindow {
  const backfill = opts.platform === 'meta' ? META_BACKFILL_MS : GOOGLE_BACKFILL_MS;
  const overlap = opts.platform === 'meta' ? META_OVERLAP_MS : GOOGLE_OVERLAP_MS;
  const until = opts.now;
  let since = opts.lastSuccessAt
    ? new Date(opts.lastSuccessAt).getTime() - overlap
    : opts.now - backfill;

  if (opts.platform === 'google') {
    const earliest = opts.now - GOOGLE_MAX_WINDOW_MS;
    if (since < earliest) since = earliest;
  }
  if (!Number.isFinite(since) || since > until) since = until;
  return { since, until };
}

export function sliceWindow(
  since: number,
  until: number,
  maxSliceMs: number
): IngestionWindow[] {
  if (until <= since || maxSliceMs <= 0) return [{ since, until }];
  const out: IngestionWindow[] = [];
  let cursor = since;
  while (cursor < until) {
    const end = Math.min(cursor + maxSliceMs, until);
    out.push({ since: cursor, until: end });
    if (end <= cursor) break;
    cursor = end;
  }
  return out.length > 0 ? out : [{ since, until }];
}

interface ClockParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function clockParts(date: Date, timeZone: string): ClockParts {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const map: Record<string, string> = {};
  for (const part of dtf.formatToParts(date)) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }
  let year = Number(map.year);
  let month = Number(map.month);
  let day = Number(map.day);
  let hour = Number(map.hour);
  if (hour === 24) {
    hour = 0;
    const rolled = new Date(Date.UTC(year, month - 1, day + 1));
    year = rolled.getUTCFullYear();
    month = rolled.getUTCMonth() + 1;
    day = rolled.getUTCDate();
  }
  return {
    year,
    month,
    day,
    hour,
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

/** Milliseconds to add to a UTC instant to get the clock time in `timeZone`. */
function zoneOffsetMs(utcDate: Date, timeZone: string): number {
  const parts = clockParts(utcDate, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  return asUtc - utcDate.getTime();
}

/** `local` is `YYYY-MM-DD HH:mm:ss` on the wall clock of `timeZone`. */
export function zonedLocalToUtc(local: string, timeZone: string): Date {
  const match = local.trim().match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/
  );
  if (!match) throw new Error(`Invalid local time: ${local}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const offset1 = zoneOffsetMs(guess, timeZone);
  let utc = new Date(guess.getTime() - offset1);
  const offset2 = zoneOffsetMs(utc, timeZone);
  if (offset2 !== offset1) utc = new Date(guess.getTime() - offset2);
  return utc;
}

export function formatInTimeZone(date: Date, timeZone: string): string {
  const parts = clockParts(date, timeZone);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)} ${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}`;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** Inclusive Chicago calendar dates → UTC instants for the activity query. */
export function chicagoDayBounds(
  fromYmd: string,
  toYmd: string
): { fromIso: string; toIso: string } {
  if (!YMD.test(fromYmd) || !YMD.test(toYmd)) {
    throw new Error('Date range must be YYYY-MM-DD');
  }
  const start = zonedLocalToUtc(`${fromYmd} 00:00:00`, CHICAGO);
  const end = zonedLocalToUtc(`${toYmd} 23:59:59`, CHICAGO);
  return { fromIso: start.toISOString(), toIso: end.toISOString() };
}
