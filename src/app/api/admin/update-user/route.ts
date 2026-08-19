import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

/**
 * Admin-only endpoint to update an existing user's role and/or brand assignment.
 * POST { action: 'update_role', userId, role }
 * POST { action: 'update_brand', userId, brandId }
 *
 * Writes through the service role key (bypasses RLS) because users_profile has
 * no UPDATE policy for the browser/anon client — direct client-side writes
 * silently no-op.
 */
export async function POST(request: NextRequest) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Verify admin auth
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('users_profile')
    .select('role')
    .eq('id', user.id)
    .single();

  if (!profile || profile.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden — admin only' }, { status: 403 });
  }

  const body = await request.json();
  const { action } = body;

  if (action === 'update_role') {
    const { userId, role } = body;
    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });
    if (!['admin', 'strategist', 'founder'].includes(role)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('users_profile')
      .update({ role })
      .eq('id', userId)
      .select('id, email, role');

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, updated: data });
  }

  if (action === 'update_brand') {
    const { userId, brandId } = body;
    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });

    const { data, error } = await supabase
      .from('users_profile')
      .update({ brand_id: brandId || null })
      .eq('id', userId)
      .select('id, email, brand_id');

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, updated: data });
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
}
