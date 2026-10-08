import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authenticateRequest } from '@/lib/auth';
import { aggregateSummaryRows } from '@/lib/creative-matrix';

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

  const rows = aggregateSummaryRows(
    (data || []).map((row) => ({
      product_name: (row as { product_name: string | null }).product_name,
      creative_type: (row as { creative_type: string | null }).creative_type,
      fidelity: (row as { fidelity: string | null }).fidelity,
    }))
  );

  return NextResponse.json({ rows });
}
