import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authorizeBrandSync } from '@/lib/sync-brand-access';
import {
  runTripleWhaleBrandSync,
  type TripleWhalePnlSyncInput,
} from '@/lib/shopify/run-triplewhale-brand-sync';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Admin or cron secret: any brand. Founder: users_profile.brand_id only.
  const auth = await authorizeBrandSync(request, supabase, 'brandId');
  if ('error' in auth) return auth.error;
  return runTripleWhaleBrandSync(supabase, auth.body as TripleWhalePnlSyncInput);
}
