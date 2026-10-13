import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { SHOPIFY_CONFIG } from '@/lib/shopify/config';
import { shopifyProductTags, shopifyProductsFromPayload } from '@/lib/shopify/rest-payload';
import { authorizeBrandSync, brandIdFromBody } from '@/lib/sync-brand-access';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Admin or cron secret: any brand, including every credentialed brand when brand_id is omitted.
  // Founder: brand_id is required and must be users_profile.brand_id.
  const auth = await authorizeBrandSync(request, supabase, 'brand_id', {
    founderMissingBrandStatus: 400,
  });
  if ('error' in auth) return auth.error;
  const targetBrandId = brandIdFromBody(auth.body, 'brand_id');

  // Query brands that have Shopify configured
  let query = supabase
    .from('brands')
    .select('id, name, shopify_store_domain, shopify_client_id, shopify_client_secret')
    .is('archived_at', null)
    .not('shopify_store_domain', 'is', null)
    .not('shopify_client_id', 'is', null)
    .not('shopify_client_secret', 'is', null);

  if (targetBrandId) {
    query = query.eq('id', targetBrandId);
  }

  const { data: brands } = await query;

  const results = [];

  for (const brand of brands || []) {
    try {
      // Get Shopify access token via client credentials grant
      const tokenRes = await fetch(
        `https://${brand.shopify_store_domain}/admin/oauth/access_token`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: brand.shopify_client_id,
            client_secret: brand.shopify_client_secret,
          }),
        }
      );

      if (!tokenRes.ok) {
        results.push({ brand: brand.name, error: `Token exchange failed: ${tokenRes.status}`, products: 0 });
        continue;
      }

      const { access_token } = await tokenRes.json();

      let allProducts: any[] = [];
      let url: string | null =
        `https://${brand.shopify_store_domain}/admin/api/${SHOPIFY_CONFIG.apiVersion}/products.json?limit=250&status=active`;

      while (url) {
        const res: Response = await fetch(url, {
          headers: {
            'X-Shopify-Access-Token': access_token,
            'Content-Type': 'application/json',
          },
        });

        if (!res.ok) {
          results.push({ brand: brand.name, error: `HTTP ${res.status}`, products: 0 });
          break;
        }

        const data = await res.json();
        allProducts = allProducts.concat(shopifyProductsFromPayload(data));

        // Handle Shopify Link header pagination
        const linkHeader: string | null = res.headers.get('link');
        const nextMatch: RegExpMatchArray | null | undefined = linkHeader?.match(/<([^>]+)>;\s*rel="next"/);
        url = nextMatch ? nextMatch[1] : null;

        // Rate limit pause
        await new Promise((r) => setTimeout(r, 100));
      }

      // Upsert each product
      for (const product of allProducts) {
        await supabase.from('shopify_products').upsert(
          {
            shop_domain: brand.shopify_store_domain,
            brand_id: brand.id,
            shopify_product_id: product.id,
            title: product.title,
            handle: product.handle,
            status: product.status,
            product_type: product.product_type || '',
            vendor: product.vendor || '',
            tags: shopifyProductTags(product.tags),
            variants: product.variants || [],
            images: product.images || [],
            shopify_created_at: product.created_at,
            shopify_updated_at: product.updated_at,
            raw: product,
            updated_at: new Date().toISOString(),
          },
          {
            onConflict: 'shop_domain,shopify_product_id',
          }
        );
      }

      results.push({ brand: brand.name, products: allProducts.length, error: null });
    } catch (err: any) {
      results.push({ brand: brand.name, error: err.message, products: 0 });
    }
  }

  return NextResponse.json({ results });
}
