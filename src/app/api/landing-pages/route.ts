import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

/**
 * GET /api/landing-pages?brand_id=...&days=7
 *
 * Returns landing page performance data grouped by landing_site path.
 * Compares the current period (last N days) against the previous period
 * (the N days before that) to calculate % change.
 */
export async function GET(request: NextRequest) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Auth check
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

  if (!profile || !['admin', 'strategist', 'founder'].includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const brandId = searchParams.get('brand_id');
  const days = parseInt(searchParams.get('days') || '7', 10);

  if (!brandId) {
    return NextResponse.json({ error: 'brand_id is required' }, { status: 400 });
  }

  // Role-based access
  if (['strategist', 'founder'].includes(profile.role) && profile.brand_id !== brandId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const now = new Date();
  const currentStart = new Date(now);
  currentStart.setDate(currentStart.getDate() - days);
  const previousStart = new Date(currentStart);
  previousStart.setDate(previousStart.getDate() - days);

  try {
    // Fetch orders for both periods in one query
    const { data: orders, error } = await supabase
      .from('shopify_orders')
      .select('landing_site, total_price, shopify_created_at, customer_id')
      .eq('brand_id', brandId)
      .gte('shopify_created_at', previousStart.toISOString())
      .lte('shopify_created_at', now.toISOString())
      .not('landing_site', 'is', null);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Parse landing_site to just the path (strip query params + domain)
    function parsePath(landingSite: string): string {
      try {
        // landing_site can be a full URL or just a path
        if (landingSite.startsWith('http')) {
          const url = new URL(landingSite);
          return url.pathname;
        }
        // Strip query string
        return landingSite.split('?')[0] || '/';
      } catch {
        return landingSite.split('?')[0] || '/';
      }
    }

    interface PageBucket {
      conversions: number;
      revenue: number;
      customers: Set<string | number>;
    }

    const currentPeriod = new Map<string, PageBucket>();
    const previousPeriod = new Map<string, PageBucket>();

    const currentStartMs = currentStart.getTime();

    for (const order of orders || []) {
      if (!order.landing_site) continue;

      const path = parsePath(order.landing_site);
      const orderDate = new Date(order.shopify_created_at).getTime();
      const isCurrent = orderDate >= currentStartMs;
      const bucket = isCurrent ? currentPeriod : previousPeriod;

      if (!bucket.has(path)) {
        bucket.set(path, { conversions: 0, revenue: 0, customers: new Set() });
      }

      const b = bucket.get(path)!;
      b.conversions += 1;
      b.revenue += parseFloat(order.total_price || '0');
      if (order.customer_id) b.customers.add(order.customer_id);
    }

    // Combine into response
    const allPaths = new Set([...currentPeriod.keys(), ...previousPeriod.keys()]);

    const pages = Array.from(allPaths).map((path) => {
      const curr = currentPeriod.get(path);
      const prev = previousPeriod.get(path);

      const conversions = curr?.conversions ?? 0;
      const revenue = Math.round((curr?.revenue ?? 0) * 100) / 100;
      const aov = conversions > 0 ? Math.round((revenue / conversions) * 100) / 100 : 0;

      const prevConversions = prev?.conversions ?? 0;
      const prevRevenue = Math.round((prev?.revenue ?? 0) * 100) / 100;
      const prevAov = prevConversions > 0 ? Math.round((prevRevenue / prevConversions) * 100) / 100 : 0;

      const pctChange = (curr: number, prev: number) => {
        if (prev === 0) return curr > 0 ? null : 0; // null = new (no prior data)
        return Math.round(((curr - prev) / prev) * 10000) / 100;
      };

      return {
        page_path: path,
        page_name: path === '/' ? 'Homepage' : path,
        conversions,
        revenue,
        aov,
        unique_customers: curr?.customers.size ?? 0,
        conversions_change: pctChange(conversions, prevConversions),
        revenue_change: pctChange(revenue, prevRevenue),
        aov_change: pctChange(aov, prevAov),
        prev_conversions: prevConversions,
        prev_revenue: prevRevenue,
        prev_aov: prevAov,
      };
    });

    // Sort by revenue descending
    pages.sort((a, b) => b.revenue - a.revenue);

    return NextResponse.json({
      pages,
      period: {
        current: { start: currentStart.toISOString().split('T')[0], end: now.toISOString().split('T')[0] },
        previous: { start: previousStart.toISOString().split('T')[0], end: currentStart.toISOString().split('T')[0] },
      },
      days,
      total_orders: orders?.length ?? 0,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
