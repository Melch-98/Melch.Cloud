import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authenticateRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    // ─── Auth check ──────────────────────────────────────────────
    const { auth, error: authError, status } = await authenticateRequest(request);
    if (!auth) {
      return NextResponse.json({ error: authError }, { status: status || 401 });
    }

    // Only admins can change batch status
    if (auth.role !== 'admin') {
      return NextResponse.json(
        { error: 'Only admins can update batch status.' },
        { status: 403 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const body = await request.json();
    const { submissionId, status: newStatus } = body;

    if (!submissionId || !newStatus) {
      return NextResponse.json({ error: 'Missing submissionId or status' }, { status: 400 });
    }

    const validStatuses = ['new', 'building', 'ready', 'launched'];
    if (!validStatuses.includes(newStatus)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }

    const updateData: any = { batch_status: newStatus };

    // Stamp launched_at when marking as launched
    if (newStatus === 'launched') {
      updateData.launched_at = new Date().toISOString();
    }

    const { error } = await supabase
      .from('submissions')
      .update(updateData)
      .eq('id', submissionId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, status: newStatus });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
