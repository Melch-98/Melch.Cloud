// ─── /api/trybe/integration ─────────────────────────────────────
// GET  — status for a brand (never returns raw api_key)
// POST — upsert Trybe API key + optional metadata (admin only)

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authenticateRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export async function GET(request: NextRequest) {
  const { auth, error, status } = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error }, { status: status || 401 });

  const brandId = new URL(request.url).searchParams.get('brand_id');
  if (!brandId) {
    return NextResponse.json({ error: 'brand_id required' }, { status: 400 });
  }

  if (auth.role !== 'admin' && auth.brand_id !== brandId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const supabase = serviceClient();
  const { data, error: qErr } = await supabase
    .from('brand_integrations')
    .select('id, brand_id, provider, label, metadata, updated_at, api_key')
    .eq('brand_id', brandId)
    .eq('provider', 'trybe')
    .maybeSingle();

  if (qErr) {
    return NextResponse.json({ error: qErr.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({
      configured: false,
      brand_id: brandId,
      metadata: {},
    });
  }

  const key: string = data.api_key || '';
  const masked =
    key.length > 8 ? `${key.slice(0, 7)}…${key.slice(-4)}` : key ? '••••' : null;

  return NextResponse.json({
    configured: !!key,
    brand_id: brandId,
    label: data.label,
    metadata: data.metadata || {},
    api_key_masked: masked,
    updated_at: data.updated_at,
  });
}

export async function POST(request: NextRequest) {
  const { auth, error, status } = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error }, { status: status || 401 });

  if (auth.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden — admin only' }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const brand_id = body.brand_id as string | undefined;
  const api_key = typeof body.api_key === 'string' ? body.api_key.trim() : undefined;
  const label = typeof body.label === 'string' ? body.label.trim() : undefined;
  const clear_key = body.clear_key === true;

  if (!brand_id) {
    return NextResponse.json({ error: 'brand_id required' }, { status: 400 });
  }

  const metadataPatch: Record<string, unknown> = {};
  if (body.trybe_brand_id !== undefined) {
    metadataPatch.trybe_brand_id = body.trybe_brand_id || null;
  }
  if (body.trybe_program_id !== undefined) {
    metadataPatch.trybe_program_id = body.trybe_program_id || null;
  }
  if (body.trybe_program_name !== undefined) {
    metadataPatch.trybe_program_name = body.trybe_program_name || null;
  }
  if (body.metadata && typeof body.metadata === 'object') {
    Object.assign(metadataPatch, body.metadata);
  }

  const supabase = serviceClient();

  // Load existing row so we can merge metadata / keep key if blank save
  const { data: existing } = await supabase
    .from('brand_integrations')
    .select('id, api_key, metadata, label')
    .eq('brand_id', brand_id)
    .eq('provider', 'trybe')
    .maybeSingle();

  const mergedMeta = {
    ...(existing?.metadata && typeof existing.metadata === 'object' ? existing.metadata : {}),
    ...metadataPatch,
  };

  let nextKey = existing?.api_key || '';
  if (clear_key) nextKey = '';
  else if (api_key) nextKey = api_key;

  if (!nextKey && !existing) {
    return NextResponse.json(
      { error: 'api_key required for first-time Trybe setup' },
      { status: 400 },
    );
  }

  if (!nextKey && clear_key) {
    const { error: delErr } = await supabase
      .from('brand_integrations')
      .delete()
      .eq('brand_id', brand_id)
      .eq('provider', 'trybe');
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
    return NextResponse.json({ ok: true, configured: false, cleared: true });
  }

  const row = {
    brand_id,
    provider: 'trybe',
    api_key: nextKey,
    label: label ?? existing?.label ?? 'Trybe',
    metadata: mergedMeta,
    updated_at: new Date().toISOString(),
  };

  const { error: upErr } = await supabase
    .from('brand_integrations')
    .upsert(row, { onConflict: 'brand_id,provider' });

  if (upErr) {
    // If metadata column missing, retry without it and surface a hint
    if (upErr.message?.toLowerCase().includes('metadata')) {
      const { error: upErr2 } = await supabase.from('brand_integrations').upsert(
        {
          brand_id,
          provider: 'trybe',
          api_key: nextKey,
          label: row.label,
          updated_at: row.updated_at,
        },
        { onConflict: 'brand_id,provider' },
      );
      if (upErr2) return NextResponse.json({ error: upErr2.message }, { status: 500 });
      return NextResponse.json({
        ok: true,
        configured: true,
        warning: 'Saved key but metadata column missing — run add_brand_integrations_metadata.sql',
      });
    }
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    configured: true,
    metadata: mergedMeta,
    api_key_masked: nextKey.length > 8 ? `${nextKey.slice(0, 7)}…${nextKey.slice(-4)}` : '••••',
  });
}
