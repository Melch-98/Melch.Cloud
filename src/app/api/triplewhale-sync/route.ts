import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  getSyncRateLimiter,
  acquireSyncLock,
  releaseSyncLock,
  invalidatePnlCache,
} from '@/lib/redis';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// ─── Helpers ───────────────────────────────────────────────────

const round2 = (val: number) => Math.round(val * 100) / 100;

const META_CHANNELS = ['facebook-ads'];
const GOOGLE_CHANNELS = ['google-ads'];

async function tripleWhaleSQL(
  apiKey: string,
  shopId: string,
  query: string,
  startDate: string,
  endDate: string
): Promise<any[]> {
  const res = await fetch('https://api.triplewhale.com/api/v2/orcabase/api/sql', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      shopId,
      query,
      currency: 'USD',
      period: { startDate, endDate },
    }),
  });

  if (res.status === 429) {
    const retryAfter = res.headers.get('Retry-After') || '60';
    throw new Error(`Triple Whale rate limited. Retry after ${retryAfter}s`);
  }

  if (res.status === 403) {
    throw new Error('Triple Whale API key is invalid or expired. Generate a new key at triplewhale.com');
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Triple Whale API ${res.status}: ${body}`);
  }

  const json = await res.json();
  if (!json.success) {
    throw new Error(`Triple Whale query failed: ${JSON.stringify(json)}`);
  }

  return json.data || [];
}

// ─── POST handler ──────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Auth check — admin/founder only
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
    .select('role')
    .eq('id', user.id)
    .single();

  if (!profile || !['admin', 'founder'].includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden — admin/founder only' }, { status: 403 });
  }

  // Parse body
  const body = await request.json();
  const { brandId, startDate, endDate } = body;

  if (!brandId) {
    return NextResponse.json({ error: 'brandId is required' }, { status: 400 });
  }

  const twApiKey = process.env.TRIPLEWHALE_API_KEY;
  if (!twApiKey) {
    return NextResponse.json(
      { error: 'TRIPLEWHALE_API_KEY is not configured' },
      { status: 500 }
    );
  }

  // Get brand
  const { data: brand, error: brandError } = await supabase
    .from('brands')
    .select('id, name, shopify_store_domain')
    .eq('id', brandId)
    .single();

  if (brandError || !brand) {
    return NextResponse.json({ error: 'Brand not found' }, { status: 404 });
  }

  if (!brand.shopify_store_domain) {
    return NextResponse.json(
      { error: 'Brand has no shopify_store_domain set — this is required as the Triple Whale shopId' },
      { status: 400 }
    );
  }

  // Rate limit: 5 syncs per minute per brand
  const limiter = getSyncRateLimiter();
  if (limiter) {
    const { success, reset } = await limiter.limit(`brand:${brand.id}`);
    if (!success) {
      const retryAfter = Math.ceil((reset - Date.now()) / 1000);
      return NextResponse.json(
        { error: 'Rate limit exceeded — try again in a moment.', retry_after_seconds: retryAfter },
        { status: 429 }
      );
    }
  }

  // Acquire per-brand lock
  const gotLock = await acquireSyncLock(brand.id, 120);
  if (!gotLock) {
    return NextResponse.json(
      { error: 'A sync is already running for this brand. Wait for it to finish.' },
      { status: 409 }
    );
  }

  // Default date range: last 7 days
  const now = new Date();
  const defaultStart = new Date(now);
  defaultStart.setDate(defaultStart.getDate() - 7);

  const start = startDate || defaultStart.toISOString().split('T')[0];
  const end = endDate || now.toISOString().split('T')[0];

  try {
    // Call 1: Blended stats (orders + revenue + NC/RC)
    const blendedData = await tripleWhaleSQL(
      twApiKey,
      brand.shopify_store_domain,
      'SELECT event_date, orders_count, new_customer_orders, new_customer_revenue, gross_product_sales, order_revenue, discounts, refund_money, taxes, shipping_price, spend FROM blended_stats_tvf WHERE event_date BETWEEN @startDate AND @endDate',
      start,
      end
    );

    // Call 2: Per-channel ad spend
    const adsData = await tripleWhaleSQL(
      twApiKey,
      brand.shopify_store_domain,
      'SELECT event_date, channel, SUM(spend) AS spend FROM ads_table WHERE event_date BETWEEN @startDate AND @endDate GROUP BY event_date, channel',
      start,
      end
    );

    // Build spend maps by channel
    const metaSpendMap = new Map<string, number>();
    const googleSpendMap = new Map<string, number>();
    const otherSpendMap = new Map<string, number>();

    for (const row of adsData) {
      const existing = (map: Map<string, number>) => map.get(row.event_date) || 0;
      if (META_CHANNELS.includes(row.channel)) {
        metaSpendMap.set(row.event_date, existing(metaSpendMap) + row.spend);
      } else if (GOOGLE_CHANNELS.includes(row.channel)) {
        googleSpendMap.set(row.event_date, existing(googleSpendMap) + row.spend);
      } else {
        otherSpendMap.set(row.event_date, existing(otherSpendMap) + row.spend);
      }
    }

    // Build daily_pnl rows
    const rows = blendedData.map((day) => ({
      brand_id: brand.id,
      date: day.event_date,
      nc_orders: day.new_customer_orders || 0,
      nc_revenue: round2(day.new_customer_revenue || 0),
      rc_orders: (day.orders_count || 0) - (day.new_customer_orders || 0),
      rc_revenue: round2((day.order_revenue || 0) - (day.new_customer_revenue || 0)),
      gross_sales: round2(day.gross_product_sales || 0),
      discounts: round2(-(day.discounts || 0)),
      refunds: round2(-(day.refund_money || 0)),
      taxes: round2(day.taxes || 0),
      shipping: round2(day.shipping_price || 0),
      ...(metaSpendMap.has(day.event_date) ? { meta_spend: round2(metaSpendMap.get(day.event_date)!) } : {}),
      ...(googleSpendMap.has(day.event_date) ? { google_spend: round2(googleSpendMap.get(day.event_date)!) } : {}),
      ...(otherSpendMap.has(day.event_date) ? { other_spend: round2(otherSpendMap.get(day.event_date)!) } : {}),
      synced_at: new Date().toISOString(),
    }));

    if (blendedData.length === 0) {
      console.warn(`Triple Whale returned no blended stats for ${brand.name} (${start} to ${end})`);
    }

    // Upsert spend-only dates (dates with ad spend but no blended stats)
    const blendedDates = new Set(blendedData.map((d) => d.event_date));
    const allAdDates = new Set([...Array.from(metaSpendMap.keys()), ...Array.from(googleSpendMap.keys()), ...Array.from(otherSpendMap.keys())]);
    const spendOnlyRows = [];

    for (const date of Array.from(allAdDates)) {
      if (!blendedDates.has(date)) {
        spendOnlyRows.push({
          brand_id: brand.id,
          date,
          ...(metaSpendMap.has(date) ? { meta_spend: round2(metaSpendMap.get(date)!) } : {}),
          ...(googleSpendMap.has(date) ? { google_spend: round2(googleSpendMap.get(date)!) } : {}),
          ...(otherSpendMap.has(date) ? { other_spend: round2(otherSpendMap.get(date)!) } : {}),
        });
      }
    }

    const allRows = [...rows, ...spendOnlyRows];

    if (allRows.length > 0) {
      const { error: upsertError } = await supabase
        .from('daily_pnl')
        .upsert(allRows, { onConflict: 'brand_id,date' });

      if (upsertError) {
        console.error('Upsert error:', upsertError);
        return NextResponse.json(
          { error: 'Failed to save data', details: upsertError.message },
          { status: 500 }
        );
      }
    }

    // Invalidate cached P&L
    await invalidatePnlCache(brand.id);

    return NextResponse.json({
      success: true,
      brand: brand.name,
      daysUpserted: allRows.length,
      dateRange: { start, end },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Triple Whale sync error:', message);

    // Fire-and-forget alert email
    try {
      const { sendEmail } = await import('@/lib/email');
      await sendEmail({
        to: process.env.ADMIN_NOTIFICATION_EMAIL || 'melch@melch.media',
        template: {
          name: 'sync-failure',
          data: {
            brandName: brand.name,
            brandId: brand.id,
            source: 'triplewhale',
            errorMessage: message,
            context: {
              'Start Date': start,
              'End Date': end,
            },
          },
        },
        dedupeKey: `sync-failure:triplewhale:${brand.id}`,
        dedupeTtlSeconds: 3600,
      });
    } catch (alertErr) {
      console.error('Failed to send sync failure alert:', alertErr);
    }

    return NextResponse.json(
      { error: 'Triple Whale sync failed', details: message },
      { status: 500 }
    );
  } finally {
    await releaseSyncLock(brand.id);
  }
}
