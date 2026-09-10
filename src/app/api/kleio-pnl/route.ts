import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  TALLOW_TWINS_BRAND_ID,
  fetchKleioPnL,
  isTallowTwinsBrand,
  type KleioPeriod,
} from '@/lib/kleio';

export const dynamic = 'force-dynamic';

/**
 * GET /api/kleio-pnl?brandId=...&period=mtd|last_7|last_30|custom&start=YYYY-MM-DD&end=YYYY-MM-DD
 *
 * Auth: admin + founder (Tallow Twins only).
 * Does NOT write to daily_pnl. Kleio MCP is chat-side; this route uses optional
 * KLEIO_API_KEY + KLEIO_API_BASE_URL when present, else returns kleio_not_configured.
 */
export async function GET(request: NextRequest) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const authHeader = request.headers.get('authorization');
  if (!authHeader) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const token = authHeader.replace('Bearer ', '');
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from('users_profile')
    .select('role, brand_id')
    .eq('id', user.id)
    .single();

  if (!profile || !['admin', 'founder'].includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const brandId = searchParams.get('brandId') || TALLOW_TWINS_BRAND_ID;
  const period = (searchParams.get('period') || 'mtd') as KleioPeriod;
  const start = searchParams.get('start') || undefined;
  const end = searchParams.get('end') || undefined;

  if (!['mtd', 'last_7', 'last_30', 'custom'].includes(period)) {
    return NextResponse.json({ error: 'Invalid period' }, { status: 400 });
  }

  // Non-admins may only query their own brand
  if (profile.role !== 'admin' && profile.brand_id !== brandId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data: brand } = await supabase
    .from('brands')
    .select('id, slug, name')
    .eq('id', brandId)
    .single();

  if (!brand || !isTallowTwinsBrand(brand.id, brand.slug)) {
    return NextResponse.json(
      {
        error: 'tallow_twins_only',
        message: 'Kleio P&L test is Tallow Twins only.',
        brand_id: brandId,
      },
      { status: 403 }
    );
  }

  const payload = await fetchKleioPnL({
    brandId: brand.id,
    period,
    startDate: start,
    endDate: end,
  });

  const httpStatus =
    payload.status === 'kleio_not_configured'
      ? 503
      : payload.status === 'kleio_upstream_error'
        ? 502
        : 200;

  return NextResponse.json(payload, { status: httpStatus });
}
