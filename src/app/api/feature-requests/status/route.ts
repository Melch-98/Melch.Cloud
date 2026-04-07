// ─── /api/feature-requests/status ───────────────────────────────
// PATCH — admin updates status and/or admin_note on a feature request

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authenticateRequest } from '@/lib/auth';

const VALID_STATUSES = ['open', 'planned', 'in_progress', 'shipped', 'declined'];

export async function PATCH(request: NextRequest) {
  const { auth, error, status: authStatus } = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error }, { status: authStatus || 401 });

  if (auth.role !== 'admin') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  }

  const body = await request.json();
  const { feature_id, status, admin_note } = body;

  if (!feature_id) {
    return NextResponse.json({ error: 'feature_id is required' }, { status: 400 });
  }

  const updates: Record<string, any> = { updated_at: new Date().toISOString() };
  if (status && VALID_STATUSES.includes(status)) {
    updates.status = status;
  }
  if (admin_note !== undefined) {
    updates.admin_note = admin_note;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const supabase = createClient(supabaseUrl, serviceKey);

  const { data, error: updateErr } = await supabase
    .from('feature_requests')
    .update(updates)
    .eq('id', feature_id)
    .select()
    .single();

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({ request: data });
}
