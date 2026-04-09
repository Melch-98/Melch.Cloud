import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import JSZip from 'jszip';
import { authenticateRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    // ─── Auth + permission check ─────────────────────────────────
    const { auth, error: authError, status } = await authenticateRequest(request);
    if (!auth) {
      return NextResponse.json({ error: authError }, { status: status || 401 });
    }

    if (!auth.permissions.can_download) {
      return NextResponse.json(
        { error: 'You do not have permission to download files.' },
        { status: 403 }
      );
    }

    const submissionId = request.nextUrl.searchParams.get('id');
    if (!submissionId) {
      return NextResponse.json({ error: 'Missing submission id' }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Get submission info
    const { data: submission, error: subError } = await supabase
      .from('submissions')
      .select('batch_name, brand_id')
      .eq('id', submissionId)
      .single();

    if (subError || !submission) {
      return NextResponse.json(
        { error: `Submission not found: ${subError?.message || 'no data'}` },
        { status: 404 }
      );
    }

    // Non-admins can only download their own brand's submissions
    if (auth.role !== 'admin' && auth.brand_id && submission.brand_id !== auth.brand_id) {
      return NextResponse.json(
        { error: 'You can only download submissions for your assigned brand.' },
        { status: 403 }
      );
    }

    // Get all files for this submission
    const { data: files, error: filesError } = await supabase
      .from('submission_files')
      .select('file_name, file_url')
      .eq('submission_id', submissionId);

    if (filesError) {
      return NextResponse.json(
        { error: `Files query failed: ${filesError.message}` },
        { status: 500 }
      );
    }

    if (!files || files.length === 0) {
      return NextResponse.json({ error: 'No files found for this submission' }, { status: 404 });
    }

    // Build ZIP
    const zip = new JSZip();
    const errors: string[] = [];

    for (const file of files) {
      const { data: fileData, error: downloadError } = await supabase.storage
        .from('creatives')
        .download(file.file_url);

      if (downloadError || !fileData) {
        errors.push(`${file.file_name}: ${downloadError?.message || 'no data'} (path: ${file.file_url})`);
        continue;
      }

      const arrayBuffer = await fileData.arrayBuffer();
      zip.file(file.file_name, arrayBuffer);
    }

    // If ALL files failed, return error with details
    if (errors.length === files.length) {
      return NextResponse.json(
        { error: `All file downloads failed`, details: errors },
        { status: 500 }
      );
    }

    const zipBuffer = await zip.generateAsync({ type: 'arraybuffer' });

    // Update batch_status to 'building'
    await supabase
      .from('submissions')
      .update({ batch_status: 'building' })
      .eq('id', submissionId);

    const safeName = submission.batch_name.replace(/[^a-zA-Z0-9_-]/g, '_');

    return new NextResponse(zipBuffer, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${safeName}.zip"`,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: `Server error: ${err.message}` },
      { status: 500 }
    );
  }
}
