import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(request: NextRequest) {
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
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Check admin role
  const { data: profile } = await supabase
    .from('users_profile')
    .select('role')
    .eq('id', user.id)
    .single();

  if (!profile || !['admin', 'founder'].includes(profile.role)) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const targetBrandId = body.brand_id;

  // Query brands that have Shopify configured
  let query = supabase
    .from('brands')
    .select('id, name, shopify_store_domain, shopify_client_id, shopify_client_secret')
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
        `https://${brand.shopify_store_domain}/admin/api/2024-01/products.json?limit=250&status=active`;

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
        allProducts = allProducts.concat(data.products || []);

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
            shopify_product_id: `gid://shopify/Product/${product.id}`,
            title: product.title,
            handle: product.handle,
            status: product.status,
            product_type: product.product_type || '',
            vendor: product.vendor || '',
            tags: product.tags ? product.tags.split(', ') : [],
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
