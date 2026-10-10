import { createNotionUsageClient } from '@/lib/notion-usage';
import { isUsageEndDateAllowed, shiftIsoDate, utcToday } from '@/lib/usage-end-date';
import {
  syncUsageTask,
  type UsageSubmissionRow,
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

export async function rememberNotionPage(
  supabase: ServiceClient,
  submissionId: string,
  page: { id: string; url: string }
): Promise<void> {
  const { error } = await supabase
    .from('submissions')
    .update({ notion_page_id: page.id, notion_page_url: page.url })
    .eq('id', submissionId)
    .is('notion_page_id', null);
  if (error) throw new Error(error.message);
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
  if (!row) return { ok: false, action: 'failed', error: 'not_found', notionPageId: null, notionPageUrl: null, usageEndDate: null };

  const result = await syncUsageTask({ row, notion: createNotionUsageClient() });
  if (result.ok && result.action === 'created' && result.page) {
    try {
      await rememberNotionPage(supabase, submissionId, result.page);
    } catch (error) {
      console.warn('Usage task was created but not saved on the batch', {
        submissionId,
        error: error instanceof Error ? error.message : 'save',
      });
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

/** Batches with a usage end date that is still current and no Notion page yet. */
export async function retryMissingUsageTasks(
  supabase: ServiceClient,
  now = new Date()
): Promise<{ created: number; failed: number; missingKey: number }> {
  const earliest = shiftIsoDate(utcToday(now), -1);
  const { data, error } = await supabase
    .from('submissions')
    .select('id')
    .gte('usage_end_date', earliest)
    .is('notion_page_id', null);
  if (error) throw new Error(error.message);
  if (!process.env.NOTION_API_KEY) {
    console.warn('Usage task retry skipped: NOTION_API_KEY is not set');
    return { created: 0, failed: 0, missingKey: (data || []).length };
  }

  let created = 0;
  let failed = 0;
  let missingKey = 0;
  for (const row of data || []) {
    const result = await runUsageTaskSync(supabase, row.id);
    if (result.action === 'created') created += 1;
    else if (result.action === 'missing_key') missingKey += 1;
    else if (!result.ok) failed += 1;
  }
  return { created, failed, missingKey };
}
