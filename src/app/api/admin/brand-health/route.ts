import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { currencyFromShopInfo, resolveReportingCurrency } from '@/lib/currency';
import { resolvePipeboardToken } from '@/lib/pipeboard-google';

export const dynamic = 'force-dynamic';

type ChipStatus = 'green' | 'yellow' | 'red' | 'gray';

type HealthChip = {
  key: string;
  label: string;
  status: ChipStatus;
  detail: string;
};

type BrandHealth = {
  brandId: string;
  brandName: string;
  chips: HealthChip[];
};

/**
 * GET /api/admin/brand-health?brandId=optional
 * Read-only connection health for brand cards. No secrets in response.
 */
export async function GET(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: 'Server config error' }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  const authHeader = request.headers.get('authorization');
  if (!authHeader) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const token = authHeader.replace('Bearer ', '');
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

  const brandIdFilter = request.nextUrl.searchParams.get('brandId');

  let brandQuery = supabase
    .from('brands')
    .select(
      'id, name, website_url, meta_ad_account_id, google_ads_customer_id, shopify_store_domain, shopify_client_id, shopify_client_secret, dropbox_folder_path'
    )
    .is('archived_at', null)
    .order('name');

  if (brandIdFilter) brandQuery = brandQuery.eq('id', brandIdFilter);

  const { data: brands, error: brandsError } = await brandQuery;
  if (brandsError) {
    return NextResponse.json({ error: brandsError.message }, { status: 400 });
  }
  if (!brands || brands.length === 0) {
    return NextResponse.json({ brands: [] as BrandHealth[], checked_at: new Date().toISOString() });
  }

  const brandIds = brands.map((b) => b.id);

  // Shopify OAuth installs (no tokens returned)
  const { data: stores } = await supabase
    .from('shopify_stores')
    .select('brand_id, shop_domain, uninstalled_at, shop_info')
    .in('brand_id', brandIds);

  const storesByBrand = new Map<string, any[]>();
  for (const s of stores || []) {
    if (!s.brand_id) continue;
    const list = storesByBrand.get(s.brand_id) || [];
    list.push(s);
    storesByBrand.set(s.brand_id, list);
  }

  // Latest daily_pnl sync per brand
  const lastSyncByBrand = new Map<string, string>();
  for (const id of brandIds) {
    const { data: row } = await supabase
      .from('daily_pnl')
      .select('synced_at')
      .eq('brand_id', id)
      .not('synced_at', 'is', null)
      .order('synced_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (row?.synced_at) lastSyncByBrand.set(id, row.synced_at);
  }

  // Dropbox app connection (global)
  const { data: dropboxRow } = await supabase
    .from('integrations')
    .select('refresh_token, access_token_expires_at, updated_at')
    .eq('service', 'dropbox')
    .maybeSingle();
  const dropboxAppConnected = !!(dropboxRow && (dropboxRow as any).refresh_token);

  // Meta token health (boolean only — no token material)
  const metaHealth = await checkMetaTokenHealth(supabase);

  // Google / Pipeboard token present?
  const pipeboardToken = await resolvePipeboardToken(
    process.env.PIPEBOARD_API_TOKEN,
    async (key) => {
      const { data } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', key)
        .maybeSingle();
      return data?.value || null;
    }
  );
  const googleTokenOk = !!pipeboardToken;

  const results: BrandHealth[] = brands.map((brand) => {
    const chips: HealthChip[] = [];

    // Shopify
    const brandStores = (storesByBrand.get(brand.id) || []).filter(
      (s) => !s.uninstalled_at
    );
    const hasOauth = brandStores.length > 0;
    const hasCustom =
      !!(brand.shopify_client_id && brand.shopify_client_secret) ||
      !!brand.shopify_store_domain;
    if (hasOauth) {
      chips.push({
        key: 'shopify',
        label: 'Shopify',
        status: 'green',
        detail: `OAuth connected (${brandStores[0].shop_domain || 'store'})`,
      });
    } else if (brand.shopify_client_id && brand.shopify_client_secret) {
      chips.push({
        key: 'shopify',
        label: 'Shopify',
        status: 'yellow',
        detail: 'Custom-app credentials set (no OAuth install)',
      });
    } else if (brand.shopify_store_domain) {
      chips.push({
        key: 'shopify',
        label: 'Shopify',
        status: 'yellow',
        detail: `Domain set (${brand.shopify_store_domain}) — missing OAuth/creds`,
      });
    } else {
      chips.push({
        key: 'shopify',
        label: 'Shopify',
        status: 'red',
        detail: 'Not connected',
      });
    }

    // Meta
    if (!brand.meta_ad_account_id) {
      chips.push({
        key: 'meta',
        label: 'Meta',
        status: 'red',
        detail: 'No ad account ID',
      });
    } else if (metaHealth.status === 'critical' || !metaHealth.valid) {
      chips.push({
        key: 'meta',
        label: 'Meta',
        status: 'red',
        detail: `Ad account set — token ${metaHealth.message}`,
      });
    } else if (metaHealth.status === 'warning') {
      chips.push({
        key: 'meta',
        label: 'Meta',
        status: 'yellow',
        detail: `Ad account set — ${metaHealth.message}`,
      });
    } else {
      chips.push({
        key: 'meta',
        label: 'Meta',
        status: 'green',
        detail: 'Ad account + token healthy',
      });
    }

    // Google
    if (!brand.google_ads_customer_id) {
      chips.push({
        key: 'google',
        label: 'Google',
        status: 'red',
        detail: 'No customer ID',
      });
    } else if (!googleTokenOk) {
      chips.push({
        key: 'google',
        label: 'Google',
        status: 'yellow',
        detail: 'Customer ID set — Pipeboard token missing',
      });
    } else {
      chips.push({
        key: 'google',
        label: 'Google',
        status: 'green',
        detail: 'Customer ID + Pipeboard token configured',
      });
    }

    // Dropbox
    if (!dropboxAppConnected && !brand.dropbox_folder_path) {
      chips.push({
        key: 'dropbox',
        label: 'Dropbox',
        status: 'red',
        detail: 'App not connected; no brand folder',
      });
    } else if (!dropboxAppConnected) {
      chips.push({
        key: 'dropbox',
        label: 'Dropbox',
        status: 'yellow',
        detail: `Folder ${brand.dropbox_folder_path} — app not connected`,
      });
    } else if (!brand.dropbox_folder_path) {
      chips.push({
        key: 'dropbox',
        label: 'Dropbox',
        status: 'yellow',
        detail: 'App connected — brand folder path missing',
      });
    } else {
      chips.push({
        key: 'dropbox',
        label: 'Dropbox',
        status: 'green',
        detail: `Connected · ${brand.dropbox_folder_path}`,
      });
    }

    // Triple Whale (optional): used when shopify_store_domain is the TW shopId
    // and the brand has no direct Shopify connection (OAuth or custom-app creds).
    // Do not treat website_url / domain-alone as "healthy TW".
    const hasShopifyCreds = !!(brand.shopify_client_id && brand.shopify_client_secret);
    const twConfigured = !!brand.shopify_store_domain && !hasOauth && !hasShopifyCreds;
    const twApiKeyConfigured = !!process.env.TRIPLEWHALE_API_KEY;
    if (!twConfigured) {
      chips.push({
        key: 'triple_whale',
        label: 'Triple Whale',
        status: 'gray',
        detail: 'N/A — not configured (no TW shopId without Shopify path)',
      });
    } else if (!twApiKeyConfigured) {
      chips.push({
        key: 'triple_whale',
        label: 'Triple Whale',
        status: 'yellow',
        detail: `shopId set (${brand.shopify_store_domain}) — TRIPLEWHALE_API_KEY missing`,
      });
    } else {
      chips.push({
        key: 'triple_whale',
        label: 'Triple Whale',
        status: 'green',
        detail: `Configured · shopId ${brand.shopify_store_domain}`,
      });
    }

    // Currency
    const shopInfo =
      brandStores.find((s) => s.shop_info)?.shop_info ||
      (storesByBrand.get(brand.id) || []).find((s) => s.shop_info)?.shop_info;
    const shopCurrency = currencyFromShopInfo(shopInfo);
    const reporting = resolveReportingCurrency({ shopCurrency });
    if (reporting.source === 'shop') {
      chips.push({
        key: 'currency',
        label: 'Currency',
        status: 'green',
        detail: `${reporting.code} (Shopify settlement)`,
      });
    } else if (reporting.source === 'default_usd' && !hasOauth && !hasCustom) {
      chips.push({
        key: 'currency',
        label: 'Currency',
        status: 'red',
        detail: 'Unknown — no Shopify source',
      });
    } else {
      chips.push({
        key: 'currency',
        label: 'Currency',
        status: 'yellow',
        detail: `${reporting.code} (${reporting.source})`,
      });
    }

    // Last sync
    const syncedAt = lastSyncByBrand.get(brand.id);
    if (!syncedAt) {
      chips.push({
        key: 'last_sync',
        label: 'Last sync',
        status: 'red',
        detail: 'No daily_pnl sync yet',
      });
    } else {
      const ageMs = Date.now() - new Date(syncedAt).getTime();
      const ageHours = ageMs / (1000 * 60 * 60);
      const when = new Date(syncedAt).toISOString().replace('T', ' ').slice(0, 16) + 'Z';
      if (ageHours <= 36) {
        chips.push({
          key: 'last_sync',
          label: 'Last sync',
          status: 'green',
          detail: when,
        });
      } else if (ageHours <= 24 * 7) {
        chips.push({
          key: 'last_sync',
          label: 'Last sync',
          status: 'yellow',
          detail: when,
        });
      } else {
        chips.push({
          key: 'last_sync',
          label: 'Last sync',
          status: 'red',
          detail: when,
        });
      }
    }

    return { brandId: brand.id, brandName: brand.name, chips };
  });

  return NextResponse.json({
    brands: results,
    meta_token: { status: metaHealth.status, valid: metaHealth.valid },
    dropbox_app_connected: dropboxAppConnected,
    google_token_configured: googleTokenOk,
    checked_at: new Date().toISOString(),
  });
}

async function checkMetaTokenHealth(supabase: any): Promise<{
  status: 'healthy' | 'warning' | 'critical' | 'missing';
  valid: boolean;
  message: string;
}> {
  let metaToken = process.env.META_ACCESS_TOKEN || '';
  if (!metaToken) {
    const { data: settings } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'meta_access_token')
      .maybeSingle();
    metaToken = settings?.value || '';
  }

  if (!metaToken) {
    return { status: 'missing', valid: false, message: 'not configured' };
  }

  try {
    const debugRes = await fetch(
      `https://graph.facebook.com/v21.0/debug_token?input_token=${encodeURIComponent(metaToken)}&access_token=${encodeURIComponent(metaToken)}`
    );
    if (!debugRes.ok) {
      return { status: 'critical', valid: false, message: 'debug failed' };
    }
    const debugData = await debugRes.json();
    const tokenData = debugData.data;
    const valid = !!tokenData?.is_valid;
    if (!valid) return { status: 'critical', valid: false, message: 'invalid/expired' };

    if (tokenData?.expires_at && tokenData.expires_at !== 0) {
      const days = Math.floor(
        (tokenData.expires_at * 1000 - Date.now()) / (1000 * 60 * 60 * 24)
      );
      if (days <= 0) return { status: 'critical', valid: false, message: 'expired' };
      if (days <= 14) {
        return { status: 'warning', valid: true, message: `expires in ${days}d` };
      }
    }
    return { status: 'healthy', valid: true, message: 'healthy' };
  } catch {
    return { status: 'critical', valid: false, message: 'check failed' };
  }
}
