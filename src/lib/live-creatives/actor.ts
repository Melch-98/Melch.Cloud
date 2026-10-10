import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';

export type LiveCreativeActor =
  | { error: NextResponse }
  | { supabase: any; userId: string; role: string; brandId: string | null };

export async function liveCreativeActor(request: NextRequest): Promise<LiveCreativeActor> {
  const supabase = createServiceClient();
  if (!supabase) {
    return { error: NextResponse.json({ error: 'Server config error' }, { status: 500 }) };
  }
  const header = request.headers.get('authorization');
  const token = header?.replace('Bearer ', '') || '';
  if (!token || token === header) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(token);
  if (authError || !user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  const { data: profile } = await supabase
    .from('users_profile')
    .select('role, brand_id')
    .eq('id', user.id)
    .single();
  if (!profile) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  return {
    supabase,
    userId: user.id,
    role: profile.role as string,
    brandId: (profile.brand_id as string | null) ?? null,
  };
}

export function actorDenied(result: LiveCreativeActor): NextResponse | null {
  return 'error' in result ? result.error : null;
}
