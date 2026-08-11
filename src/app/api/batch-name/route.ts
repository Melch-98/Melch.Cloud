import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const BRAND_CODES: Record<string, string> = {
  'tallow-twins': 'TLW',
  'fond-regenerative': 'FND',
  'seven-weeks-coffee-co': 'SWC',
  'organic-jaguar': 'OJG',
};

function getBrandCode(slug: string): string {
  return BRAND_CODES[slug] || slug.replace(/[^a-z]/g, '').slice(0, 3).toUpperCase() || 'XXX';
}

function yymmdd(date: Date = new Date()): string {
  const yy = String(date.getFullYear()).slice(-2);
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yy}${mm}${dd}`;
}

/**
 * POST /api/batch-name
 * Body: { brand_id: string, reserved?: string[] }
 *
 * Atomically generates the next batch name for a brand on today's date.
 * Pass `reserved` with batch names already claimed in this form session
 * so the API skips them when computing the next sequence number.
 *
 * Returns: { batch_name: string }
 */
export async function POST(request: NextRequest) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Auth check — require any authenticated user
  const authHeader = request.headers.get('authorization');
  if (!authHeader) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { brand_id, reserved = [] } = body as { brand_id: string; reserved?: string[] };

  if (!brand_id) {
    return NextResponse.json({ error: 'brand_id is required' }, { status: 400 });
  }

  // Look up brand slug to get the brand code
  const { data: brand, error: brandError } = await supabase
    .from('brands')
    .select('slug')
    .eq('id', brand_id)
    .single();

  if (brandError || !brand) {
    return NextResponse.json({ error: 'Brand not found' }, { status: 404 });
  }

  const code = getBrandCode(brand.slug);
  const prefix = `${code}_${yymmdd()}`;
  const pattern = `${prefix}_%`;

  // Find the highest existing sequence number for today
  const { data: rows } = await supabase
    .from('submissions')
    .select('batch_name')
    .eq('brand_id', brand_id)
    .like('batch_name', pattern)
    .order('batch_name', { ascending: false })
    .limit(1);

  let max = 0;

  // Check DB max
  const seqPattern = new RegExp(`^${prefix}_(\\d{4})$`);
  if (rows && rows.length > 0) {
    const match = rows[0].batch_name.match(seqPattern);
    if (match) {
      max = parseInt(match[1], 10);
    }
  }

  // Also check reserved names from the current form session
  for (const name of reserved) {
    const match = name.match(seqPattern);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > max) max = num;
    }
  }

  const batchName = `${prefix}_${String(max + 1).padStart(4, '0')}`;

  return NextResponse.json({ batch_name: batchName });
}
