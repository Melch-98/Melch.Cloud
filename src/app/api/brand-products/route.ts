import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

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
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const brandId = request.nextUrl.searchParams.get('brand_id');
  if (!brandId) {
    return NextResponse.json({ error: 'brand_id required' }, { status: 400 });
  }

  const { data: products } = await supabase
    .from('shopify_products')
    .select('shopify_product_id, title, product_type, handle')
    .eq('brand_id', brandId)
    .eq('status', 'active')
    .order('product_type')
    .order('title');

  // Prepend the "Brand / General" option
  const result = [
    { shopify_product_id: '__brand_general__', title: 'Brand / General', product_type: '', handle: '' },
    ...(products || []),
  ];

  return NextResponse.json({ products: result });
}
