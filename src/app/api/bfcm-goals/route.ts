import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { goalAccess } from '@/lib/bfcm/goals-access';

export const dynamic = 'force-dynamic';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

type GoalRow = {
  date: string;
  revenue_goal: number | string | null;
  spend_budget: number | string | null;
  amer_target: number | string | null;
  updated_at: string | null;
};

function numOrNull(value: unknown): number | null {
  if (value == null || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function goalJson(row: GoalRow) {
  return {
    date: row.date,
    revenueGoal: numOrNull(row.revenue_goal),
    spendBudget: numOrNull(row.spend_budget),
    amerTarget: numOrNull(row.amer_target),
    updatedAt: row.updated_at,
  };
}

async function actor(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return { error: NextResponse.json({ error: 'Server config error' }, { status: 500 }) };
  }
  const supabase = createClient(supabaseUrl, serviceKey);
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
  return { supabase, userId: user.id, role: profile.role as string, brandId: (profile.brand_id as string | null) ?? null };
}

export async function GET(request: NextRequest) {
  const auth = await actor(request);
  if ('error' in auth && auth.error) return auth.error;
  const { supabase, role, brandId: userBrandId } = auth as Exclude<typeof auth, { error: NextResponse }>;
  const { searchParams } = new URL(request.url);
  const brandId = searchParams.get('brandId') || '';
  const from = searchParams.get('from') || '';
  const to = searchParams.get('to') || '';
  if (!brandId || !DATE.test(from) || !DATE.test(to) || to < from) {
    return NextResponse.json({ error: 'brandId, from, and to (YYYY-MM-DD) are required' }, { status: 400 });
  }
  if (goalAccess(role, userBrandId, brandId) === 'none') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { data, error } = await supabase
    .from('bfcm_goals')
    .select('date, revenue_goal, spend_budget, amer_target, updated_at')
    .eq('brand_id', brandId)
    .gte('date', from)
    .lte('date', to)
    .order('date', { ascending: true });
  if (error) {
    const missing = /bfcm_goals/i.test(error.message);
    return NextResponse.json(
      { error: missing ? 'bfcm_goals is not applied yet' : error.message },
      { status: missing ? 503 : 500 }
    );
  }
  return NextResponse.json({
    goals: ((data || []) as GoalRow[]).map(goalJson),
    access: goalAccess(role, userBrandId, brandId),
  });
}

export async function PUT(request: NextRequest) {
  const auth = await actor(request);
  if ('error' in auth && auth.error) return auth.error;
  const { supabase, userId, role, brandId: userBrandId } = auth as Exclude<typeof auth, { error: NextResponse }>;
  let body: {
    brandId?: string;
    date?: string;
    revenueGoal?: unknown;
    spendBudget?: unknown;
    amerTarget?: unknown;
    revenue_goal?: unknown;
    spend_budget?: unknown;
    amer_target?: unknown;
  } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const brandId = body.brandId?.trim() || '';
  const date = body.date?.trim() || '';
  if (!brandId || !DATE.test(date)) {
    return NextResponse.json({ error: 'brandId and date (YYYY-MM-DD) are required' }, { status: 400 });
  }
  if (goalAccess(role, userBrandId, brandId) !== 'write') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const revenueGoal = numOrNull(body.revenueGoal ?? body.revenue_goal);
  const spendBudget = numOrNull(body.spendBudget ?? body.spend_budget);
  const amerTarget = numOrNull(body.amerTarget ?? body.amer_target);
  const invalid = [body.revenueGoal ?? body.revenue_goal, body.spendBudget ?? body.spend_budget, body.amerTarget ?? body.amer_target]
    .filter((value) => value != null && value !== '')
    .some((value) => !Number.isFinite(Number(value)) || Number(value) < 0);
  if (invalid || (revenueGoal != null && revenueGoal < 0) || (spendBudget != null && spendBudget < 0) || (amerTarget != null && amerTarget < 0)) {
    return NextResponse.json({ error: 'Goals must be blank or a number that is zero or greater' }, { status: 400 });
  }
  const { data, error } = await supabase
    .from('bfcm_goals')
    .upsert(
      {
        brand_id: brandId,
        date,
        revenue_goal: revenueGoal,
        spend_budget: spendBudget,
        amer_target: amerTarget,
        created_by: userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'brand_id,date' }
    )
    .select('date, revenue_goal, spend_budget, amer_target, updated_at')
    .single();
  if (error) {
    const missing = /bfcm_goals/i.test(error.message);
    return NextResponse.json(
      { error: missing ? 'bfcm_goals is not applied yet' : error.message },
      { status: missing ? 503 : 500 }
    );
  }
  return NextResponse.json({ goal: goalJson(data as GoalRow) });
}
