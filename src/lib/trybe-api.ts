// ─── Trybe Brand API (read-only) ────────────────────────────────
// Locked against Mintier live probe — see docs/TRYBE_API_LOCKED.md

const TRYBE_BASE = 'https://api.jointrybe.com';

export type TrybeSubmissionStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'revision_requested';

export interface TrybeCreator {
  id: string;
  name: string;
  avatar_url?: string | null;
  joined_at?: string | null;
}

export interface TrybeProgramRef {
  id: string;
  name: string;
}

export interface TrybeSubmission {
  id: string;
  trybe_id?: string;
  creator: { id: string; name: string };
  status: TrybeSubmissionStatus | string;
  media_type: 'video' | 'image' | string;
  version?: number;
  revision_of?: string | null;
  program?: TrybeProgramRef | null;
  ads?: { count: number; first_day?: string | null; last_day?: string | null } | null;
  group?: string | null;
  products?: unknown[];
  creator_comment?: string | null;
  review_comment?: string | null;
  transcript?: string | null;
  angles?: string[];
  asset?: { url?: string; expires_at?: string } | null;
  thumbnail_url?: string | null;
  created_at: string;
}

export interface TrybeCreatorPerformanceRow {
  creator: TrybeCreator;
  programs?: TrybeProgramRef[];
  activity?: {
    last_submission_at?: string | null;
    last_ad_day?: string | null;
  };
  performance: {
    start_date: string;
    end_date: string;
    currency?: string;
    earnings_cents: number;
    trybe_conversions: number;
    trybe_gmv_cents: number;
    new_submissions: number;
    active_submissions: number;
    ads: number;
    spend_cents: number;
    purchases: number;
    purchase_value_cents: number;
    roas: number | null;
  };
}

interface Paginated<T> {
  object?: string;
  data: T[];
  has_more?: boolean;
  next_cursor?: string | null;
  previous_cursor?: string | null;
}

async function trybeFetch<T>(
  apiKey: string,
  path: string,
  query: Record<string, string | number | boolean | undefined | null> = {},
): Promise<T> {
  const url = new URL(`${TRYBE_BASE}${path}`);
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    url.searchParams.set(k, String(v));
  }

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
    cache: 'no-store',
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Trybe ${res.status}: ${text.slice(0, 200) || res.statusText}`);
  }

  return res.json() as Promise<T>;
}

/** Paginate until exhausted or maxPages reached (limit ≤ 100 per page). */
export async function trybePaginate<T>(
  apiKey: string,
  path: string,
  query: Record<string, string | number | boolean | undefined | null> = {},
  opts: { maxPages?: number; pageSize?: number } = {},
): Promise<T[]> {
  const maxPages = opts.maxPages ?? 10;
  const pageSize = Math.min(opts.pageSize ?? 100, 100);
  const out: T[] = [];
  let after: string | undefined;
  let pages = 0;

  while (pages < maxPages) {
    const page = await trybeFetch<Paginated<T>>(apiKey, path, {
      ...query,
      limit: pageSize,
      after,
    });
    const rows = page.data || [];
    out.push(...rows);
    pages += 1;
    if (!page.has_more || !page.next_cursor || rows.length === 0) break;
    after = page.next_cursor;
  }

  return out;
}

export async function listCreators(apiKey: string): Promise<TrybeCreator[]> {
  return trybePaginate<TrybeCreator>(apiKey, '/v1/creators', {}, { maxPages: 5 });
}

export async function listSubmissions(
  apiKey: string,
  opts: {
    status?: TrybeSubmissionStatus;
    program_id?: string;
    creator_id?: string;
    maxPages?: number;
  } = {},
): Promise<TrybeSubmission[]> {
  const { status, program_id, creator_id, maxPages = 15 } = opts;
  return trybePaginate<TrybeSubmission>(
    apiKey,
    '/v1/submissions',
    { status, program_id, creator_id },
    { maxPages },
  );
}

export async function listCreatorPerformance(
  apiKey: string,
  opts: {
    start_date: string;
    end_date: string;
    sort_by?: string;
    active_only?: boolean;
    maxPages?: number;
  },
): Promise<TrybeCreatorPerformanceRow[]> {
  const { start_date, end_date, sort_by = 'spend', active_only = true, maxPages = 5 } = opts;
  return trybePaginate<TrybeCreatorPerformanceRow>(
    apiKey,
    '/v1/creator-performance',
    { start_date, end_date, sort_by, active_only },
    { maxPages },
  );
}

/** Yesterday UTC as YYYY-MM-DD (Trybe requires complete days only). */
export function trybeYesterdayUtc(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** start_date for a window ending yesterday, capped at 90 days when using sort/active. */
export function trybeWindowStart(endDate: string, days = 30): string {
  const end = new Date(`${endDate}T00:00:00.000Z`);
  const capped = Math.min(Math.max(days, 1), 90);
  end.setUTCDate(end.getUTCDate() - (capped - 1));
  return end.toISOString().slice(0, 10);
}

export function centsToDollars(cents: number | null | undefined): number {
  if (cents == null || Number.isNaN(cents)) return 0;
  return cents / 100;
}
