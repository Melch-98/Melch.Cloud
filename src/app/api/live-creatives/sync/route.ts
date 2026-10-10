import { NextRequest, NextResponse } from 'next/server';
import { actorDenied, liveCreativeActor } from '@/lib/live-creatives/actor';
import { readMetaToken, syncLiveCreatives } from '@/lib/live-creatives/sync';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 300;

/** Admin-only manual run of the live creative product sync. */
export async function POST(request: NextRequest) {
  const auth = await liveCreativeActor(request);
  const denied = actorDenied(auth);
  if (denied) return denied;
  const { supabase, role } = auth as Exclude<typeof auth, { error: NextResponse }>;
  if (role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let body: { brandId?: string } = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const token = await readMetaToken(supabase);
  if (!token) {
    return NextResponse.json({ error: 'Meta: META_ACCESS_TOKEN not configured' }, { status: 400 });
  }

  try {
    const started = Date.now();
    const { results, deferred } = await syncLiveCreatives({
      supabase,
      token,
      now: new Date(started),
      budgetMs: 240_000,
      brandId: body.brandId?.trim() || null,
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
