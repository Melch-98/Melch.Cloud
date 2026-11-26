import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { goalAccess } from '@/lib/bfcm/goals-access';
import { normalizeHour, normalizeHourNote } from '@/lib/bfcm/hour-note';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

async function actor(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return { error: NextResponse.json({ error: 'Server config error' }, { status: 500 }) };
  }
  const supabase = createClient(supabaseUrl, serviceKey, {
    global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) },
  });
  const header = request.headers.get('authorization');
  const token = header?.replace('Bearer ', '') || '';
  if (!token || token === header) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  const { data: profile } = await supabase
    .from('users_profile')
    .select('role, brand_id')
    .eq('id', user.id)
    .single();
  if (!profile) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  return { supabase, userId: user.id, role: profile.role as string, brandId: (profile.brand_id as string | null) ?? null };
}

function missingTable(message: string): boolean {
  return /bfcm_hour_notes/i.test(message);
}

export async function GET(request: NextRequest) {
  const auth = await actor(request);
  if ('error' in auth && auth.error) return auth.error;
  const { supabase, role, brandId: userBrandId } = auth as Exclude<typeof auth, { error: NextResponse }>;
  const { searchParams } = new URL(request.url);
  const brandId = searchParams.get('brandId') || '';
  const date = searchParams.get('date') || '';
  if (!brandId || !DATE.test(date)) {
    return NextResponse.json({ error: 'brandId and date (YYYY-MM-DD) are required' }, { status: 400 });
  }
  if (goalAccess(role, userBrandId, brandId) === 'none') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { data, error } = await supabase
    .from('bfcm_hour_notes')
    .select('hour, note, updated_at')
    .eq('brand_id', brandId)
    .eq('date', date)
    .order('hour', { ascending: true });
  if (error) {
    return NextResponse.json(
      { error: missingTable(error.message) ? 'bfcm_hour_notes is not applied yet' : error.message },
      { status: missingTable(error.message) ? 503 : 500 }
    );
  }
  return NextResponse.json({
    notes: (data || []).map((row) => ({
      hour: row.hour,
      note: typeof row.note === 'string' ? row.note : '',
      updatedAt: row.updated_at,
    })),
    access: goalAccess(role, userBrandId, brandId),
  });
}

export async function PUT(request: NextRequest) {
  const auth = await actor(request);
  if ('error' in auth && auth.error) return auth.error;
  const { supabase, userId, role, brandId: userBrandId } = auth as Exclude<typeof auth, { error: NextResponse }>;
  let body: { brandId?: string; date?: string; hour?: unknown; note?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const brandId = body.brandId?.trim() || '';
  const date = body.date?.trim() || '';
  const hour = normalizeHour(body.hour);
  const note = normalizeHourNote(body.note);
  if (!brandId || !DATE.test(date) || hour == null) {
    return NextResponse.json({ error: 'brandId, date (YYYY-MM-DD), and hour 0-23 are required' }, { status: 400 });
  }
  if (!note.ok) return NextResponse.json({ error: note.error }, { status: 400 });
  if (goalAccess(role, userBrandId, brandId) !== 'write') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (note.note === '') {
    const { error } = await supabase
      .from('bfcm_hour_notes')
      .delete()
      .eq('brand_id', brandId)
      .eq('date', date)
      .eq('hour', hour);
    if (error) {
      return NextResponse.json(
        { error: missingTable(error.message) ? 'bfcm_hour_notes is not applied yet' : error.message },
        { status: missingTable(error.message) ? 503 : 500 }
      );
    }
    return NextResponse.json({ hour, note: '' });
  }
  const { error } = await supabase
    .from('bfcm_hour_notes')
    .upsert(
      {
        brand_id: brandId,
        date,
        hour,
        note: note.note,
        updated_by: userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'brand_id,date,hour' }
    );
  if (error) {
    return NextResponse.json(
      { error: missingTable(error.message) ? 'bfcm_hour_notes is not applied yet' : error.message },
      { status: missingTable(error.message) ? 503 : 500 }
    );
  }
  return NextResponse.json({ hour, note: note.note });
}
