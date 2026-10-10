import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { readMetaToken, syncLiveCreatives } from '@/lib/live-creatives/sync';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 300;

/**
 * Tag active Meta ads with the product their landing URL points at.
 * GET is the Vercel cron (hourly, Bearer CRON_SECRET).
 * One brand's failure is recorded and does not stop the others.
 * A dead Meta token stops the rest of the run.
 * Each brand result includes none (rows still product_kind none) and noneAdIds (up to 5).
 */
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get('authorization');
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: 'Server config error: missing Supabase credentials' }, { status: 500 });
  }

  const token = await readMetaToken(supabase);
  if (!token) {
    return NextResponse.json({ error: 'Meta: META_ACCESS_TOKEN not configured' }, { status: 500 });
  }

  try {
    const started = Date.now();
    const { results, deferred } = await syncLiveCreatives({
      supabase,
      token,
      now: new Date(started),
      budgetMs: 240_000,
    });
    const failures = results.filter((result) => !result.ok);
    return NextResponse.json({
      ok: failures.length === 0,
      results,
      deferred,
      synced_at: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Live creative sync failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
