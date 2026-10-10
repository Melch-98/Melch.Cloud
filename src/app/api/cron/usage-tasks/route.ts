import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { retryMissingUsageTasks } from '@/lib/usage-task-sync';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Create Agency Tasks pages for batches that have a usage end date and no
 * Notion page yet. GET is the hourly Vercel cron (Bearer CRON_SECRET).
 * A missing key or a Notion error is counted and does not fail the run.
 */
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get('authorization');
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: 'Server config error' }, { status: 500 });
  }

  try {
    const result = await retryMissingUsageTasks(supabase);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.warn('Usage task retry failed', {
      error: error instanceof Error ? error.message : 'usage task',
    });
    return NextResponse.json({ ok: true, created: 0, failed: 0, missingKey: 0, error: 'retry failed' });
  }
}
