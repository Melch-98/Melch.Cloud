// ─── /api/feature-requests/vote ─────────────────────────────────
// POST — cast / change / remove a vote on a feature request

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authenticateRequest } from '@/lib/auth';

export async function POST(request: NextRequest) {
  const { auth, error, status } = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error }, { status: status || 401 });

  const body = await request.json();
  const { feature_id, vote } = body; // vote: 1, -1, or 0 (remove)

  if (!feature_id) {
    return NextResponse.json({ error: 'feature_id is required' }, { status: 400 });
  }

  if (![1, -1, 0].includes(vote)) {
    return NextResponse.json({ error: 'vote must be 1, -1, or 0' }, { status: 400 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const supabase = createClient(supabaseUrl, serviceKey);

  if (vote === 0) {
    // Remove vote
    await supabase
      .from('feature_votes')
      .delete()
      .eq('feature_id', feature_id)
      .eq('user_id', auth.user_id);
  } else {
    // Upsert vote
    const { error: upsertErr } = await supabase
      .from('feature_votes')
      .upsert(
        {
          feature_id,
          user_id: auth.user_id,
          vote,
        },
        { onConflict: 'feature_id,user_id' }
      );

    if (upsertErr) {
      return NextResponse.json({ error: upsertErr.message }, { status: 500 });
    }
  }

  return NextResponse.json({ success: true });
}
