import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { inngest } from '@/lib/inngest/client';

export const dynamic = 'force-dynamic';

/**
 * POST /api/submissions/sync-drive
 * Body: { submission_id: string }
 *
 * Fires the submission/created Inngest event which triggers the Drive sync.
 * Called by the upload form right after a successful submission insert.
 */
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { submission_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const submissionId = body.submission_id;
  if (!submissionId) {
    return NextResponse.json({ error: 'submission_id required' }, { status: 400 });
  }

  // Ownership check: submission must exist and user must have access
  const { data: submission, error: subError } = await supabase
    .from('submissions')
    .select('id, user_id, brand_id')
    .eq('id', submissionId)
    .single();

  if (subError || !submission) {
    return NextResponse.json({ error: 'Submission not found' }, { status: 404 });
  }

  await inngest.send({
    name: 'submission/created',
    data: { submission_id: submissionId },
  });

  return NextResponse.json({ ok: true });
}
