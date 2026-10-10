import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { fetchGrantedScopeHandles, hasReadAllOrdersScope } from '@/lib/shopify/access-scopes';
import { resolveOrderConnection } from '@/lib/shopify/order-connection';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

type BrandRow = {
  id: string;
  name: string;
  archived_at: string | null;
  shopify_store_domain: string | null;
  shopify_client_id: string | null;
  shopify_client_secret: string | null;
};

/**
 * Granted Shopify scopes for one brand.
 * Admin session or Bearer CRON_SECRET. The token and client secret are not returned.
 *
 *   GET /api/admin/shopify-scopes?brand_name=Mintier
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

export async function GET(request: NextRequest) {
  const auth = await authorize(request);
  if ('error' in auth && auth.error) return auth.error;
  const supabase = auth.supabase!;

  const brandName = request.nextUrl.searchParams.get('brand_name')?.trim() || '';
  if (!brandName) {
    return NextResponse.json({ error: 'brand_name is required' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('brands')
    .select('id, name, archived_at, shopify_store_domain, shopify_client_id, shopify_client_secret')
    .ilike('name', brandName)
    .is('archived_at', null);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  const rows = (data || []) as BrandRow[];
  if (rows.length > 1) {
    return NextResponse.json(
      {
        error: `More than one brand matches "${brandName}".`,
        matches: rows.map((row) => ({ id: row.id, name: row.name })),
      },
      { status: 409 }
    );
  }
  const brand = rows[0];
  if (!brand || brand.archived_at) {
    return NextResponse.json({ error: `No brand named "${brandName}"` }, { status: 404 });
  }

  const connection = await resolveOrderConnection(supabase, brand);
  if (!connection.domain || !connection.token) {
    return NextResponse.json(
      {
        error: 'Shopify Admin token is not available for this brand',
        brand: brand.name,
        shop_domain: connection.domain,
      },
      { status: 400 }
    );
  }

  let granted: string[];
  try {
    granted = await fetchGrantedScopeHandles(connection.domain, connection.token);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Shopify access scopes failed';
    const secret = brand.shopify_client_secret;
    const safe = secret ? message.split(secret).join('[redacted]') : message;
    return NextResponse.json(
      { error: safe.split(connection.token).join('[redacted]') },
      { status: 502 }
    );
  }

  const tokenScopes = connection.tokenScope || '';
  return NextResponse.json({
    brand: brand.name,
    shop_domain: connection.domain,
    token_scopes: tokenScopes,
    granted_scopes: granted,
    has_read_all_orders_token: hasReadAllOrdersScope(tokenScopes),
    has_read_all_orders_granted: granted.includes('read_all_orders'),
  });
}
