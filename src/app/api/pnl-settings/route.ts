import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

/**
 * GET  /api/pnl-settings?brand_id=...&month=2026-04
 * POST /api/pnl-settings { brand_id, month, settings: { otherSpend, otherSpendLocked, offShopify, offShopifyLocked, grossMargin } }
 *
 * Stores P&L monthly settings in app_settings table with key: pnl_{brand_id}_{month}
 */

function settingsKey(brandId: string, month: string) {
  return `pnl_${brandId}_${month}`;
}

async function authCheck(request: NextRequest, supabase: any) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return null;
  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;

  const { data: profile } = await supabase
    .from('users_profile')
    .select('role, brand_id')
    .eq('id', user.id)
    .single();

  if (!profile || !['admin', 'founder'].includes(profile.role)) return null;
  return { user, profile };
}

export async function GET(request: NextRequest) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const auth = await authCheck(request, supabase);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const brandId = searchParams.get('brand_id');
  const month = searchParams.get('month');

  if (!brandId || !month) {
    return NextResponse.json({ error: 'brand_id and month required' }, { status: 400 });
  }

  // Founders can only read their own brand
  if (auth.profile.role === 'founder' && auth.profile.brand_id !== brandId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const key = settingsKey(brandId, month);
  const { data } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', key)
    .single();

  if (data?.value) {
    try {
      return NextResponse.json({ settings: JSON.parse(data.value) });
    } catch {
      return NextResponse.json({ settings: null });
    }
  }

  return NextResponse.json({ settings: null });
}

export async function POST(request: NextRequest) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const auth = await authCheck(request, supabase);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { brand_id, month, settings } = body;

  if (!brand_id || !month || !settings) {
    return NextResponse.json({ error: 'brand_id, month, and settings required' }, { status: 400 });
  }

  // Founders can only write their own brand
  if (auth.profile.role === 'founder' && auth.profile.brand_id !== brand_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const key = settingsKey(brand_id, month);
  const value = JSON.stringify(settings);

  const { error } = await supabase
    .from('app_settings')
    .upsert({ key, value }, { onConflict: 'key' });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
