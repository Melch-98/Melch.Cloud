import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authenticateRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    // ─── Auth + permission check ─────────────────────────────────
    const { auth, error: authError, status } = await authenticateRequest(request);
    if (!auth) {
      return NextResponse.json({ error: authError }, { status: status || 401 });
    }

    if (!auth.permissions.can_delete) {
      return NextResponse.json(
        { error: 'You do not have permission to delete submissions.' },
        { status: 403 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const { submissionId } = await request.json();

    if (!submissionId) {
      return NextResponse.json({ error: 'Missing submissionId' }, { status: 400 });
    }

    // Verify brand ownership for strategists
    if (auth.role === 'strategist' && auth.brand_id) {
      const { data: sub } = await supabase
        .from('submissions')
        .select('brand_id')
        .eq('id', submissionId)
        .single();

      if (sub && sub.brand_id !== auth.brand_id) {
        return NextResponse.json(
          { error: 'You can only delete submissions for your assigned brand.' },
          { status: 403 }
        );
      }
    }

    // Get file paths so we can delete from storage too
    const { data: files } = await supabase
      .from('submission_files')
      .select('file_url')
      .eq('submission_id', submissionId);

    // Delete files from storage
    if (files && files.length > 0) {
      const paths = files.map((f) => f.file_url).filter(Boolean);
      if (paths.length > 0) {
        await supabase.storage.from('creatives').remove(paths);
      }
    }

    // Delete submission_files rows
    await supabase
      .from('submission_files')
      .delete()
      .eq('submission_id', submissionId);

    // Delete the submission itself
    const { error: deleteError } = await supabase
      .from('submissions')
      .delete()
      .eq('id', submissionId);

    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
