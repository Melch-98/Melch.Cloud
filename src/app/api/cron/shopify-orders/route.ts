import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { ensureCustomAppOrderWebhooks } from '@/lib/shopify/ensure-order-webhooks';
import { syncConnectedBrandOrders } from '@/lib/shopify/order-sync';
import { PNL_BUDGET_MS, refreshDailyPnl } from '@/lib/shopify/refresh-daily-pnl';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Scheduled Shopify ingestion.
 *
 * Every 2 hours (Vercel already runs the Dropbox cron every 5 minutes, so
 * sub-daily crons are allowed on this project):
 * 1. Idempotently register order webhooks for custom-app brands.
 * 2. Refresh daily_pnl from the earlier of (today minus 3) and (newest row
 *    minus 1), capped at 45 days. A gap longer than 10 days is the oldest
 *    slice only; the next run continues. Same functions as the manual routes.
 * 3. Pull shopify_orders since the newest stored row (48 hour floor, 45 day
 *    cap). A longer gap is the oldest 10 days, then the next run continues.
 *
 * A missing webhook scope or one brand's sync error is logged and does not
 * fail the rest of the run. GET is the Vercel cron (Bearer CRON_SECRET).
 * POST accepts the same secret or an admin session.
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
    const started = Date.now();
    const webhooks = await ensureCustomAppOrderWebhooks(supabase);
    const pnl = await refreshDailyPnl(supabase, new Date(), started + PNL_BUDGET_MS);
    const orders = await syncConnectedBrandOrders(supabase, started + 270_000);
    const orderFailures = orders.filter((brand) => brand.error).length;
    const pnlFailures = pnl.brands.filter((brand) => !brand.ok && !brand.skipped).length;
    return NextResponse.json({
      ok: orderFailures === 0 && pnlFailures === 0,
      webhooks,
      pnl,
      orders,
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
