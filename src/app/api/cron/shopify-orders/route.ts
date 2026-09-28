import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { syncConnectedBrandOrders } from '@/lib/shopify/order-sync';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Daily safety net for shopify_orders.
 *
 * Webhooks are the fast path for brands with a Shopify Admin token.
 * This job covers every active brand with a shop domain: Admin API when the
 * brand has custom-app credentials or a live install token, Triple Whale when
 * the domain is the only Shopify identifier (Organic Jaguar). It pulls since
 * the newest stored order and at least the last 48 hours.
 *
 * GET is the Vercel cron (Authorization: Bearer CRON_SECRET).
 * POST accepts the same cron secret or an admin session.
 */

async function runSync() {
  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json(
      { error: 'Server config error: missing Supabase credentials' },
      { status: 500 }
    );
  }

  try {
    const brands = await syncConnectedBrandOrders(supabase);
    const failed = brands.filter((brand) => brand.error).length;
    return NextResponse.json({
      ok: failed === 0,
      brands,
      synced_at: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Order sync failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function cronAuthorized(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get('authorization');
  return !!cronSecret && authHeader === `Bearer ${cronSecret}`;
}

export async function GET(req: NextRequest) {
  if (!cronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return runSync();
}

export async function POST(req: NextRequest) {
  if (cronAuthorized(req)) return runSync();

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json(
      { error: 'Server config error: missing Supabase credentials' },
      { status: 500 }
    );
  }
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(token);
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('users_profile')
    .select('role')
    .eq('id', user.id)
    .single();
  if (!profile || profile.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden — admin only' }, { status: 403 });
  }

  return runSync();
}
