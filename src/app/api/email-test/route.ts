import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendEmail, TEMPLATE_NAMES, type TemplateName, type EmailTemplate } from '@/lib/email';

export const dynamic = 'force-dynamic';

/**
 * Admin-only endpoint to preview/send any email template with sample data.
 * GET /api/email-test?template=welcome&to=melch@melch.media
 * Defaults: template=welcome, to=caller's email.
 */
export async function GET(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: 'Server config error' }, { status: 500 });
  }
  const supabase = createClient(supabaseUrl, serviceKey);

  // ── Verify caller is admin ──
  const authHeader = request.headers.get('authorization');
  if (!authHeader) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const token = authHeader.replace('Bearer ', '');
  const {
    data: { user: caller },
    error: authError,
  } = await supabase.auth.getUser(token);
  if (authError || !caller) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: callerProfile } = await supabase
    .from('users_profile')
    .select('role, full_name')
    .eq('id', caller.id)
    .single();

  if (!callerProfile || callerProfile.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden — admin only' }, { status: 403 });
  }

  // ── Parse query ──
  const { searchParams } = new URL(request.url);
  const templateParam = (searchParams.get('template') || 'welcome') as TemplateName;
  const to = searchParams.get('to') || caller.email || '';

  if (!TEMPLATE_NAMES.includes(templateParam)) {
    return NextResponse.json(
      { error: `Unknown template. Valid: ${TEMPLATE_NAMES.join(', ')}` },
      { status: 400 }
    );
  }
  if (!to) {
    return NextResponse.json({ error: 'Missing recipient' }, { status: 400 });
  }

  // ── Build sample payload ──
  const template = buildSampleTemplate(templateParam, callerProfile.full_name || 'Melch');

  const result = await sendEmail({ to, template });

  return NextResponse.json({
    template: templateParam,
    to,
    ...result,
  });
}

function buildSampleTemplate(name: TemplateName, callerName: string): EmailTemplate {
  const loginUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://melch.cloud';
  switch (name) {
    case 'welcome':
      return {
        name: 'welcome',
        data: {
          name: callerName,
          role: 'strategist',
          brandName: 'Nimi Skincare',
          loginUrl,
          invitedBy: 'Melch',
        },
      };
    case 'creative-upload':
      return {
        name: 'creative-upload',
        data: {
          brandName: 'Nimi Skincare',
          batchCount: 2,
          totalFiles: 5,
          batches: [
            {
              batchName: 'April UGC — Hero Set',
              creativeType: 'UGC Video',
              creatorName: 'Jane Creator',
              creatorSocialHandle: '@janecreator',
              landingPageUrl: 'https://nimi.example.com/hero',
              fileCount: 3,
              fileNames: ['hero_01.mp4', 'hero_02.mp4', 'hero_03.mp4'],
            },
            {
              batchName: 'April Statics',
              creativeType: 'Static Image',
              creatorName: 'In-house',
              creatorSocialHandle: null,
              landingPageUrl: null,
              fileCount: 2,
              fileNames: ['static_a.jpg', 'static_b.jpg'],
            },
          ],
        },
      };
    case 'sync-failure':
      return {
        name: 'sync-failure',
        data: {
          brandName: 'Nimi Skincare',
          brandId: 'sample-brand-id',
          source: 'shopify',
          errorMessage: 'Sample error — rate limited by Shopify Admin API (429).',
          occurredAt: new Date().toISOString(),
          context: {
            'Since Date': '2026-04-01',
            'Until Date': '2026-04-07',
          },
        },
      };
  }
}
