import { createNotionUsageClient } from '@/lib/notion-usage';
import { isUsageEndDateAllowed, shiftIsoDate, utcToday } from '@/lib/usage-end-date';
import {
  SubmissionUpdateError,
  sanitizeSecretText,
  syncUsageTask,
  usageTaskFailureFromError,
  type UsageSubmissionRow,
  type UsageTaskFailure,
  type UsageTaskResult,
} from '@/lib/usage-task';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ServiceClient = any;

export class UsageDateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageDateError';
  }
}

function brandNameOf(brands: { name?: string } | { name?: string }[] | null): string {
  if (!brands) return '';
  if (Array.isArray(brands)) return brands[0]?.name || '';
  return brands.name || '';
}

export async function loadUsageSubmission(
  supabase: ServiceClient,
  submissionId: string
): Promise<(UsageSubmissionRow & { userId: string; brandId: string; notionPageUrl: string | null }) | null> {
  const { data, error } = await supabase
    .from('submissions')
    .select(
      `id, brand_id, user_id, batch_name, file_count, creator_name, creator_social_handle,
       is_whitelist, usage_end_date, notion_page_id, notion_page_url,
       brands:brand_id (name)`
    )
    .eq('id', submissionId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  const { data: profile } = await supabase
    .from('users_profile')
    .select('full_name, email')
    .eq('id', data.user_id)
    .maybeSingle();

  return {
    id: data.id,
    brandId: data.brand_id,
    userId: data.user_id,
    brandName: brandNameOf(data.brands),
    batchName: data.batch_name || '',
    fileCount: data.file_count || 0,
    uploader: profile?.full_name || profile?.email || 'Unknown',
    creatorName: data.creator_name,
    creatorHandle: data.creator_social_handle,
    isWhitelist: !!data.is_whitelist,
    usageEndDate: data.usage_end_date,
    notionPageId: data.notion_page_id,
    notionPageUrl: data.notion_page_url,
  };
}

export async function saveUsageEndDate(
  supabase: ServiceClient,
  submissionId: string,
  usageEndDate: string | null
): Promise<void> {
  if (usageEndDate && !isUsageEndDateAllowed(usageEndDate)) {
    throw new UsageDateError('Usage end date must be today or later');
  }
  const { error } = await supabase
    .from('submissions')
    .update({ usage_end_date: usageEndDate })
    .eq('id', submissionId);
  if (error) throw new Error(error.message);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asUuid(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (UUID_RE.test(trimmed)) return trimmed;
  if (/^[0-9a-f]{32}$/i.test(value.trim())) {
    const hex = value.trim().toLowerCase();
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return null;
}

function safeNotionUrl(page: { id: string; url: string }): string {
  const fallback = `https://www.notion.so/${page.id.replace(/-/g, '')}`;
  try {
    const parsed = new URL(page.url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return fallback;
    const host = parsed.hostname.toLowerCase();
    const allowed =
      host === 'notion.so' ||
      host.endsWith('.notion.so') ||
      host === 'notion.site' ||
      host.endsWith('.notion.site') ||
      host === 'app.notion.com';
    return allowed ? parsed.toString() : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Save the Notion page on the batch. Next.js 14 caches fetch GET responses.
 * This PATCH is its own no-store request: it writes the id Notion just
 * returned and does not read the submissions row first.
 */
export async function rememberNotionPage(
  submissionId: string,
  page: { id: string; url: string }
): Promise<void> {
  const id = asUuid(submissionId);
  const pageId = asUuid(page.id);
  if (!id || !pageId) {
    throw new SubmissionUpdateError(null, 'invalid_id', 'submission or Notion page id was not a uuid');
  }
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) {
    throw new SubmissionUpdateError(null, 'config', 'Server config error');
  }

  const endpoint = new URL('rest/v1/submissions', base.endsWith('/') ? base : `${base}/`);
  endpoint.searchParams.set('id', `eq.${id}`);
  endpoint.searchParams.set('notion_page_id', 'is.null');

  const res = await fetch(endpoint.toString(), {
    method: 'PATCH',
    cache: 'no-store',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      notion_page_id: page.id,
      notion_page_url: safeNotionUrl(page),
    }),
  });

  let payload: unknown = null;
  const raw = await res.text();
  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = null;
    }
  }

  if (!res.ok) {
    const body = payload && typeof payload === 'object' ? (payload as { message?: unknown; code?: unknown }) : {};
    const code = typeof body.code === 'string' ? sanitizeSecretText(body.code).slice(0, 80) : null;
    const message = typeof body.message === 'string' ? sanitizeSecretText(body.message) : '';
    throw new SubmissionUpdateError(res.status, code || null, message || `submissions update ${res.status}`);
  }

  const rows = Array.isArray(payload) ? payload : [];
  const saved = rows.some(
    (row) => row && typeof row === 'object' && (row as { notion_page_id?: unknown }).notion_page_id === page.id
  );
  if (!saved) {
    throw new SubmissionUpdateError(res.status, 'not_updated', 'submissions row was not updated');
  }
}

/**
 * Create the Agency Tasks page, or move its Due date when this batch
 * already has one. Notion failures are returned, not thrown.
 */
export async function runUsageTaskSync(
  supabase: ServiceClient,
  submissionId: string
): Promise<UsageTaskResult & { notionPageId: string | null; notionPageUrl: string | null; usageEndDate: string | null }> {
  const row = await loadUsageSubmission(supabase, submissionId);
  if (!row) {
    return {
      ok: false,
      action: 'failed',
      error: 'not_found',
      failure: {
        submissionId,
        step: 'submissions_update',
        status: 404,
        code: 'not_found',
        message: 'submission was not found',
      },
      notionPageId: null,
      notionPageUrl: null,
      usageEndDate: null,
    };
  }

  const result = await syncUsageTask({ row, notion: createNotionUsageClient() });
  if (result.ok && result.action === 'created' && result.page) {
    try {
      await rememberNotionPage(submissionId, result.page);
    } catch (error) {
      const failure = usageTaskFailureFromError(submissionId, 'submissions_update', error);
      console.warn('Usage task was created but not saved on the batch', {
        submissionId,
        status: failure.status,
        code: failure.code,
        message: failure.message,
      });
      return {
        ok: false,
        action: 'failed',
        error: 'save',
        failure,
        warnings: result.warnings,
        notionPageId: result.page.id,
        notionPageUrl: result.page.url,
        usageEndDate: row.usageEndDate,
      };
    }
    return {
      ...result,
      notionPageId: result.page.id,
      notionPageUrl: result.page.url,
      usageEndDate: row.usageEndDate,
    };
  }
  return {
    ...result,
    notionPageId: row.notionPageId,
    notionPageUrl: row.notionPageUrl,
    usageEndDate: row.usageEndDate,
  };
}

export interface UsageTaskRetryResult {
  created: number;
  failed: number;
  missingKey: number;
  failures: UsageTaskFailure[];
  warnings: UsageTaskFailure[];
}

/** Batches with a usage end date that is still current and no Notion page yet. */
export async function retryMissingUsageTasks(
  supabase: ServiceClient,
  now = new Date()
): Promise<UsageTaskRetryResult> {
  const earliest = shiftIsoDate(utcToday(now), -1);
  const { data, error } = await supabase
    .from('submissions')
    .select('id')
    .gte('usage_end_date', earliest)
    .is('notion_page_id', null);
  if (error) throw new Error(error.message);
  if (!process.env.NOTION_API_KEY) {
    console.warn('Usage task retry skipped: NOTION_API_KEY is not set');
    return { created: 0, failed: 0, missingKey: (data || []).length, failures: [], warnings: [] };
  }

  let created = 0;
  let failed = 0;
  let missingKey = 0;
  const failures: UsageTaskFailure[] = [];
  const warnings: UsageTaskFailure[] = [];
  for (const row of data || []) {
    const result = await runUsageTaskSync(supabase, row.id);
    if (result.warnings?.length) warnings.push(...result.warnings);
    if (result.action === 'created') created += 1;
    else if (result.action === 'missing_key') missingKey += 1;
    else if (!result.ok) {
      failed += 1;
      failures.push(result.failure);
    }
  }
  return { created, failed, missingKey, failures, warnings };
}
