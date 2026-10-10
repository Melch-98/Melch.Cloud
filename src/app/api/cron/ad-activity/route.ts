import { NextRequest, NextResponse } from 'next/server';
import { syncAllActivity } from '@/lib/ad-activity/ingest';
import { createServiceClient } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Pull Meta ad-account activities and Google Ads change events for every
 * active brand. GET is the Vercel cron (every 15 minutes, Bearer CRON_SECRET).
 * One brand's failure is recorded and does not stop the others.
 */
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get('authorization');
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json(
      { error: 'Server config error: missing Supabase credentials' },
      { status: 500 }
    );
  }

  try {
    const started = Date.now();
    const { results, deferred } = await syncAllActivity(supabase, started);
    const failures = results.filter((result) => !result.ok && !result.skipped);
    return NextResponse.json({
      ok: failures.length === 0,
      results,
      deferred,
      synced_at: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Activity sync failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
