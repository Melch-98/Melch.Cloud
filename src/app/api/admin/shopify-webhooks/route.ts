import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { registerBrandOrderWebhooks, listBrandOrderWebhooks } from '@/lib/shopify/brand-webhooks';
import { exchangeClientCredentials } from '@/lib/shopify/client-credentials';
import { normalizeShopDomain } from '@/lib/shopify/config';
import { saveWebhookStatus, statusFromRegistration } from '@/lib/shopify/webhook-status';

export const dynamic = 'force-dynamic';

type BrandRow = {
  id: string;
  name: string;
  shopify_store_domain: string | null;
  shopify_client_id: string | null;
  shopify_client_secret: string | null;
  archived_at?: string | null;
};

const BRAND_COLUMNS =
  'id, name, shopify_store_domain, shopify_client_id, shopify_client_secret, archived_at';

/**
 * Admin-only registration and listing of order webhooks for a brand's own
 * Shopify custom app.
 *
 *   GET  /api/admin/shopify-webhooks?brandName=Tallow%20Twins
 *   POST /api/admin/shopify-webhooks   { "brandName": "Tallow Twins" }
 *
 * POST is idempotent: a topic that already points at this app is left alone.
 * refunds/create is not registered; that handler does not persist refunds.
 * A token that cannot create webhooks returns 403 and names the missing scope.
 */
async function requireAdmin(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return { error: NextResponse.json({ error: 'Server config error' }, { status: 500 }) };
  }
  const supabase = createClient(supabaseUrl, serviceKey);
  const authHeader = request.headers.get('authorization');
  if (!authHeader) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  const token = authHeader.replace('Bearer ', '');
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  const { data: profile } = await supabase
    .from('users_profile')
    .select('role')
    .eq('id', user.id)
    .single();
  if (!profile || profile.role !== 'admin') {
    return { error: NextResponse.json({ error: 'Forbidden — admin only' }, { status: 403 }) };
  }
  return { supabase };
}

async function findBrand(
  supabase: { from: (table: string) => any },
  brandId: string | null,
  brandName: string | null
): Promise<{ brand: BrandRow } | { error: NextResponse }> {
  if (!brandId && !brandName) {
    return {
      error: NextResponse.json({ error: 'brandId or brandName is required' }, { status: 400 }),
    };
  }

  if (brandId) {
    const { data, error } = await supabase
      .from('brands')
      .select(BRAND_COLUMNS)
      .eq('id', brandId)
      .maybeSingle();
    if (error) return { error: NextResponse.json({ error: error.message }, { status: 400 }) };
    if (!data || (data as BrandRow).archived_at) {
      return { error: NextResponse.json({ error: 'Brand not found' }, { status: 404 }) };
    }
    return { brand: data as BrandRow };
  }

  const { data, error } = await supabase
    .from('brands')
    .select(BRAND_COLUMNS)
    .ilike('name', brandName!)
    .is('archived_at', null);
  if (error) return { error: NextResponse.json({ error: error.message }, { status: 400 }) };
  const rows = (data || []) as BrandRow[];
  if (rows.length === 0) {
    return { error: NextResponse.json({ error: `No brand named "${brandName}"` }, { status: 404 }) };
  }
  if (rows.length > 1) {
    return {
      error: NextResponse.json(
        {
          error: `More than one brand matches "${brandName}". Pass brandId.`,
          matches: rows.map((row) => ({ id: row.id, name: row.name })),
        },
        { status: 409 }
      ),
    };
  }
  return { brand: rows[0] };
}

function redact(message: string, secret: string | null): string {
  if (!secret) return message;
  return message.split(secret).join('[redacted]');
}

async function manage(request: NextRequest, action: 'list' | 'register') {
  const auth = await requireAdmin(request);
  if (auth.error) return auth.error;
  const { supabase } = auth;

  let brandId: string | null = null;
  let brandName: string | null = null;
  if (action === 'list') {
    brandId = request.nextUrl.searchParams.get('brandId') || request.nextUrl.searchParams.get('brand_id');
    brandName =
      request.nextUrl.searchParams.get('brandName') || request.nextUrl.searchParams.get('brand_name');
  } else {
    let body: { brandId?: string; brand_id?: string; brandName?: string; brand_name?: string } = {};
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    brandId = body.brandId || body.brand_id || null;
    brandName = body.brandName || body.brand_name || null;
  }

  const found = await findBrand(supabase, brandId, brandName);
  if ('error' in found) return found.error;
  const brand = found.brand;

  const domain = normalizeShopDomain(brand.shopify_store_domain);
  let accessToken: string | null = null;
  let grantedScopes = '';

  if (brand.shopify_client_id && brand.shopify_client_secret) {
    if (!domain) {
      return NextResponse.json(
        {
          error: `Brand shop domain is missing or not a *.myshopify.com host (stored value: ${brand.shopify_store_domain || 'empty'}).`,
        },
        { status: 400 }
      );
    }
    try {
      const exchanged = await exchangeClientCredentials(
        domain,
        brand.shopify_client_id,
        brand.shopify_client_secret
      );
      accessToken = exchanged.accessToken;
      grantedScopes = exchanged.scope;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Shopify token exchange failed';
      return NextResponse.json(
        { error: redact(message, brand.shopify_client_secret) },
        { status: 502 }
      );
    }
  } else if (domain) {
    const { data: store } = await supabase
      .from('shopify_stores')
      .select('access_token, scopes, uninstalled_at')
      .eq('shop_domain', domain)
      .maybeSingle();
    const installToken = store?.access_token as string | undefined;
    if (installToken && installToken !== 'gadget-managed' && !store?.uninstalled_at) {
      accessToken = installToken;
      grantedScopes = (store?.scopes as string | null) || '';
    } else if (installToken === 'gadget-managed' && !store?.uninstalled_at) {
      return NextResponse.json(
        {
          ok: false,
          connection: 'gadget',
          brand: { id: brand.id, name: brand.name, shop_domain: domain },
          error:
            `${brand.name} is linked to a gadget-managed Shopify install. That row has no Admin API token, so webhooks cannot be registered from it. Add the brand's custom-app client id and secret.`,
        },
        { status: 400 }
      );
    } else {
      return NextResponse.json(
        {
          ok: false,
          connection: 'triple_whale',
          brand: { id: brand.id, name: brand.name, shop_domain: domain },
          error:
            `${brand.name} has no Shopify custom-app client id/secret and no usable Melch.Cloud install token. ` +
            `Its orders are loaded from Triple Whale (shop id ${domain}). That API key cannot register Shopify webhooks. ` +
            `The daily safety-net sync pulls Triple Whale orders for this brand.`,
        },
        { status: 400 }
      );
    }
  } else {
    return NextResponse.json(
      {
        ok: false,
        connection: 'none',
        error: `${brand.name} has no Shopify shop domain and no custom-app credentials.`,
      },
      { status: 400 }
    );
  }

  if (!accessToken || !domain) {
    return NextResponse.json({ error: 'Shopify is not connected for this brand' }, { status: 400 });
  }

  try {
    const result =
      action === 'register'
        ? await registerBrandOrderWebhooks(domain, accessToken, grantedScopes || null)
        : await listBrandOrderWebhooks(domain, accessToken, grantedScopes || null);

    const missingScope = result.scopeError?.scopes[0] ?? null;
    const stored = statusFromRegistration(domain, result.topics, missingScope);
    const statusSaved = await saveWebhookStatus(supabase, brand.id, stored);
    const registered = result.topics.every(
      (topic) => topic.status === 'already_registered' || topic.status === 'created'
    );

    const payload = {
      ok: !result.scopeError && registered,
      action,
      brand: { id: brand.id, name: brand.name, shop_domain: domain },
      granted_scopes: grantedScopes || null,
      topics: result.topics,
      webhooks: result.webhooks.map((webhook) => ({
        id: webhook.id,
        topic: webhook.topic,
        address: webhook.address,
        created_at: webhook.created_at ?? null,
      })),
      status_saved: statusSaved,
      ...(result.scopeError
        ? {
            error: result.scopeError.message,
            missing_scope: missingScope,
            missing_scopes: result.scopeError.scopes,
          }
        : {}),
    };

    if (result.scopeError) {
      return NextResponse.json(payload, { status: 403 });
    }
    if (action === 'register' && !registered) {
      return NextResponse.json(payload, { status: 502 });
    }
    return NextResponse.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Webhook request failed';
    return NextResponse.json({ error: redact(message, brand.shopify_client_secret) }, { status: 502 });
  }
}

export async function GET(request: NextRequest) {
  return manage(request, 'list');
}

export async function POST(request: NextRequest) {
  return manage(request, 'register');
}
