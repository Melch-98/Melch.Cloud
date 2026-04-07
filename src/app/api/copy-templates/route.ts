import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authenticateRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * GET  /api/copy-templates?brand_id=...
 * POST /api/copy-templates   { brand_id, title, primary_texts, headlines, descriptions, landing_page_url }
 * PUT  /api/copy-templates   { id, ...fields }
 * DELETE /api/copy-templates?id=...
 */

function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// ─── GET: list templates for a brand ────────────────────────────
export async function GET(request: NextRequest) {
  const { auth, error, status } = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error }, { status: status || 401 });

  const brandId = new URL(request.url).searchParams.get('brand_id');
  if (!brandId) {
    return NextResponse.json({ error: 'brand_id required' }, { status: 400 });
  }

  // Strategists can only see their own brand
  if (auth.role === 'strategist' && auth.brand_id !== brandId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data, error: dbErr } = await supabase()
    .from('copy_templates')
    .select('*')
    .eq('brand_id', brandId)
    .order('created_at', { ascending: false });

  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });
  return NextResponse.json({ templates: data });
}

// ─── POST: create a new template ────────────────────────────────
export async function POST(request: NextRequest) {
  const { auth, error, status } = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error }, { status: status || 401 });

  if (!['admin', 'strategist'].includes(auth.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json();
  const { brand_id, title, primary_texts, headlines, descriptions, landing_page_url } = body;

  if (!brand_id || !title) {
    return NextResponse.json({ error: 'brand_id and title required' }, { status: 400 });
  }

  // Strategists can only create for their brand
  if (auth.role === 'strategist' && auth.brand_id !== brand_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data, error: dbErr } = await supabase()
    .from('copy_templates')
    .insert({
      brand_id,
      title,
      primary_texts: primary_texts || [],
      headlines: headlines || [],
      descriptions: descriptions || [],
      landing_page_url: landing_page_url || '',
      created_by: auth.user_id,
    })
    .select()
    .single();

  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });
  return NextResponse.json({ template: data });
}

// ─── PUT: update an existing template ───────────────────────────
export async function PUT(request: NextRequest) {
  const { auth, error, status } = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error }, { status: status || 401 });

  if (!['admin', 'strategist'].includes(auth.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json();
  const { id, ...updates } = body;

  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }

  // If strategist, verify template belongs to their brand
  if (auth.role === 'strategist') {
    const { data: existing } = await supabase()
      .from('copy_templates')
      .select('brand_id')
      .eq('id', id)
      .single();
    if (!existing || existing.brand_id !== auth.brand_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  const { data, error: dbErr } = await supabase()
    .from('copy_templates')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });
  return NextResponse.json({ template: data });
}

// ─── DELETE: remove a template ──────────────────────────────────
export async function DELETE(request: NextRequest) {
  const { auth, error, status } = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error }, { status: status || 401 });

  if (!['admin', 'strategist'].includes(auth.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const id = new URL(request.url).searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }

  // If strategist, verify template belongs to their brand
  if (auth.role === 'strategist') {
    const { data: existing } = await supabase()
      .from('copy_templates')
      .select('brand_id')
      .eq('id', id)
      .single();
    if (!existing || existing.brand_id !== auth.brand_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  const { error: dbErr } = await supabase()
    .from('copy_templates')
    .delete()
    .eq('id', id);

  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
