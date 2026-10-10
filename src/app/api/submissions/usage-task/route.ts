import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase-server';
import { loadUsageSubmission, runUsageTaskSync, saveUsageEndDate, UsageDateError } from '@/lib/usage-task-sync';

// Next.js 14 caches GET fetch in the data cache. force-dynamic alone does
// not stop that, so a later read can replay the first Supabase response.
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

/**
 * Create or update the Agency Tasks page for a batch usage end date.
 * The upload has already been saved. This route always answers 200 once
 * the caller is allowed, including when Notion is down or the key is unset.
 */
export async function POST(request: NextRequest) {
  const { auth, error: authError, status } = await authenticateRequest(request);
  if (!auth) {
    return NextResponse.json({ error: authError }, { status: status || 401 });
  }

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: 'Server config error' }, { status: 500 });
  }

  let body: { submission_id?: string; usage_end_date?: string | null } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const submissionId = body.submission_id;
  if (!submissionId) {
    return NextResponse.json({ error: 'submission_id is required' }, { status: 400 });
  }

  try {
    const existing = await loadUsageSubmission(supabase, submissionId);
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const allowed =
      auth.role === 'admin' ||
      auth.user_id === existing.userId ||
      (auth.brand_id && auth.brand_id === existing.brandId);
    if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    if ('usage_end_date' in body) {
      const next = body.usage_end_date ? String(body.usage_end_date).slice(0, 10) : null;
      await saveUsageEndDate(supabase, submissionId, next);
      if (!next) {
        return NextResponse.json({ ok: true, action: 'skipped', usage_end_date: null });
      }
    }

    const result = await runUsageTaskSync(supabase, submissionId);
    const payload: Record<string, unknown> = {
      ok: true,
      saved: true,
      action: result.action,
      taskOk: result.ok,
      usage_end_date: result.usageEndDate,
      notion_page_id: result.notionPageId,
      notion_page_url: result.notionPageUrl,
    };
    if (auth.role === 'admin') {
      if (!result.ok && result.failure) payload.failure = result.failure;
      if (result.clientLookupFailure) payload.warning = result.clientLookupFailure;
    }
    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof UsageDateError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.warn('Usage task route failed', {
      submissionId,
      error: error instanceof Error ? error.message : 'usage task',
    });
    return NextResponse.json({ ok: true, saved: true, action: 'failed', taskOk: false });
  }
}
