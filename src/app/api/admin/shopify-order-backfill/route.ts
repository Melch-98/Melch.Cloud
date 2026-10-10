import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { backfillAuth } from '@/lib/bfcm/goals-access';
import { backfillBrandOrders } from '@/lib/shopify/order-backfill';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const BUDGET_MS = 240_000;

type BrandRow = { id: string; name: string; archived_at: string | null };

/**
 * Backfill shopify_orders for one brand and a shop-local date range.
 * Admin session or Bearer CRON_SECRET. Paged, time-budgeted, and resumable:
 * call the same body again while `truncated` is true. Does not rebuild daily_pnl
 * and does not run on a schedule.
 *
 *   POST /api/admin/shopify-order-backfill
 *   { "brand_name": "Mintier", "start_date": "2025-11-15", "end_date": "2025-12-05" }
 */
export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: 'Server config error' }, { status: 500 });
  }
  const supabase = createClient(supabaseUrl, serviceKey);
  const header = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  let decision = backfillAuth({ authorization: header, cronSecret, role: null });
  if (decision === 'unauthorized' || decision === 'forbidden') {
    const token = header?.replace('Bearer ', '') || '';
    const {
      data: { user },
      error: authError,
    } = token ? await supabase.auth.getUser(token) : { data: { user: null }, error: { message: 'missing' } };
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { data: profile } = await supabase.from('users_profile').select('role').eq('id', user.id).single();
    decision = backfillAuth({ authorization: header, cronSecret, role: profile?.role ?? null });
  }
  if (decision === 'unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (decision !== 'admin' && decision !== 'cron') {
    return NextResponse.json({ error: 'Forbidden — admin only' }, { status: 403 });
  }

  let body: { brand_id?: string; brand_name?: string; start_date?: string; end_date?: string } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const brandId = body.brand_id?.trim() || '';
  const brandName = body.brand_name?.trim() || '';
  const startDate = body.start_date?.trim() || '';
  const endDate = body.end_date?.trim() || '';
  if ((!brandId && !brandName) || !startDate || !endDate) {
    return NextResponse.json(
      { error: 'brand_id or brand_name, start_date, and end_date are required' },
      { status: 400 }
    );
  }

  let brand: BrandRow | null = null;
  if (brandId) {
    const { data, error } = await supabase
      .from('brands')
      .select('id, name, archived_at')
      .eq('id', brandId)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    brand = (data as BrandRow | null) ?? null;
  } else {
    const { data, error } = await supabase
      .from('brands')
      .select('id, name, archived_at')
      .ilike('name', brandName)
      .is('archived_at', null);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    const rows = (data || []) as BrandRow[];
    if (rows.length > 1) {
      return NextResponse.json(
        {
          error: `More than one brand matches "${brandName}". Pass brand_id.`,
          matches: rows.map((row) => ({ id: row.id, name: row.name })),
        },
        { status: 409 }
      );
    }
    brand = rows[0] ?? null;
  }
  if (!brand || brand.archived_at) {
    return NextResponse.json({ error: brandName ? `No brand named "${brandName}"` : 'Brand not found' }, { status: 404 });
  }

  try {
    const result = await backfillBrandOrders(supabase, {
      brandId: brand.id,
      startDate,
      endDate,
      deadlineMs: Date.now() + BUDGET_MS,
    });
    if (result.error && result.upserted === 0 && !result.truncated) {
      const status = result.error.includes('YYYY-MM-DD') || result.error.includes('No Shopify') ? 400 : 502;
      return NextResponse.json({ ok: false, ...result }, { status });
    }
    return NextResponse.json({ ok: !result.error, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Backfill failed';
    const status = message.includes('YYYY-MM-DD') || message.includes('Backfill at most') ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
