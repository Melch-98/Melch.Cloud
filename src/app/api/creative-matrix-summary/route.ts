import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authenticateRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/creative-matrix-summary?brand_id=...
 *
 * Returns counts of existing creatives for a brand grouped by
 * creative_type, fidelity and product_name — used by the upload page
 * "Creative Coverage" mini-matrix.
 */

function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(request: NextRequest) {
  const { auth, error, status } = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error }, { status: status || 401 });

  const brandId = new URL(request.url).searchParams.get('brand_id');
  if (!brandId) {
    return NextResponse.json({ error: 'brand_id required' }, { status: 400 });
  }

  // Non-admins can only see their own brand
  if (auth.role !== 'admin' && auth.brand_id !== brandId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Pull the raw rows and aggregate server-side (Supabase JS has no GROUP BY)
  const { data, error: dbErr } = await supabase()
    .from('submission_files')
    .select('creative_type, fidelity, product_name, submissions!inner(brand_id)')
    .eq('submissions.brand_id', brandId)
    .not('creative_type', 'is', null);

  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });

  // Aggregate: { [product_name]: { [creative_type]: count } } plus fidelity map
  const counts: Record<string, number> = {};
  for (const row of data || []) {
    const product = (row as any).product_name || 'Unassigned';
    const type = (row as any).creative_type as string;
    const fidelity = ((row as any).fidelity as string) || 'other';
    const key = `${product}|||${type}|||${fidelity}`;
    counts[key] = (counts[key] || 0) + 1;
  }

  const rows = Object.entries(counts).map(([key, count]) => {
    const [product_name, creative_type, fidelity] = key.split('|||');
    return { product_name, creative_type, fidelity, count };
  });

  return NextResponse.json({ rows });
}
