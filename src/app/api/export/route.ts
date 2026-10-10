import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
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
        { error: 'You do not have permission to export data.' },
        { status: 403 }
      );
    }

    // ─── Fetch data ──────────────────────────────────────────────
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    let query = supabase
      .from('file_tracker')
      .select('*')
      .order('submitted_at', { ascending: false });

    // Non-admins can only export their own brand's data
    if (auth.role !== 'admin' && auth.brand_id) {
      query = query.eq('brand_id', auth.brand_id);
    }

    const { data: files, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const headers = [
      'File Name', 'Batch', 'Brand', 'Creator', 'Type', 'Format', 'Aspect Ratio',
      'Status', 'Landing Page', 'Copy Headline', 'Copy Title',
      'Launch Date', 'Launch Time', 'Ad Name', 'Notes',
      'Carousel', 'Flexible', 'Whitelist', 'Creator Handle', 'Submitted'
    ];

    const rows = (files || []).map((f: any) => [
      f.file_name, f.batch_name, f.brand_name, f.creator_name, f.creative_type,
      f.media_format || '', f.aspect_ratio || '',
      f.status, f.landing_page_url || '', f.copy_headline || '', f.copy_title || '',
      f.launch_date || '', f.launch_time || '', f.ad_name || '', f.notes || '',
      f.is_carousel ? 'Yes' : 'No', f.is_flexible ? 'Yes' : 'No',
      f.is_whitelist ? 'Yes' : 'No', f.creator_social_handle || '',
      f.submitted_at
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map((row: string[]) =>
        row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')
      ),
    ].join('\n');

    return new NextResponse(csvContent, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="melch-cloud-export-${new Date().toISOString().split('T')[0]}.csv"`,
      },
    });
  } catch (err) {
    console.error('Export error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
