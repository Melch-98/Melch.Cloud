import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { rebuildDailyPnlFromStoredOrders } from '@/lib/shopify/rebuild-daily-pnl';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

type BrandRow = { id: string; name: string; archived_at: string | null };

/**
 * Rebuild daily_pnl for one brand from stored shopify_orders and the existing
 * Meta/Google spend fetch. Admin session or Bearer CRON_SECRET.
 *
 *   POST /api/admin/rebuild-daily-pnl
 *   { "brand_name": "Mintier", "start_date": "2026-09-20", "end_date": "2026-10-09" }
 *
 * The in-progress shop-local day is not written.
 */
async function authorize(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return { error: NextResponse.json({ error: 'Server config error' }, { status: 500 }) };
  }
  const supabase = createClient(supabaseUrl, serviceKey);
  const cronSecret = process.env.CRON_SECRET;
  const header = request.headers.get('authorization');
  if (cronSecret && header === `Bearer ${cronSecret}`) return { supabase };

  const token = header?.replace('Bearer ', '');
  if (!token) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(token);
  if (authError || !user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  const { data: profile } = await supabase.from('users_profile').select('role').eq('id', user.id).single();
  if (!profile || profile.role !== 'admin') {
    return { error: NextResponse.json({ error: 'Forbidden — admin only' }, { status: 403 }) };
  }
  return { supabase };
}

export async function POST(request: NextRequest) {
  const auth = await authorize(request);
  if ('error' in auth && auth.error) return auth.error;
  const supabase = auth.supabase!;

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
    const result = await rebuildDailyPnlFromStoredOrders(supabase, {
      brandId: brand.id,
      startDate,
      endDate,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Rebuild failed';
    const status = message.includes('already running') ? 409 : message.includes('YYYY-MM-DD') ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
