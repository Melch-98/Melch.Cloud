import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createServiceClient } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

/**
 * POST /api/submissions/mark-launched
 * Body: { submission_id: string, launched?: boolean }
 *
 * Flips a submission to launched (or back to not-launched if launched=false).
 * Admin-only.
 */
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const authClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authErr } = await authClient.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { submission_id?: string; launched?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!body.submission_id) {
    return NextResponse.json({ error: 'submission_id required' }, { status: 400 });
  }

  const launched = body.launched !== false;
  const supabase = createServiceClient();
  const { error } = await supabase
    .from('submissions')
    .update({ launched_at: launched ? new Date().toISOString() : null })
    .eq('id', body.submission_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, launched });
}
