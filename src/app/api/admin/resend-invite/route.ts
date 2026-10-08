import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ensureUserWithInviteLink } from '@/lib/invite';
import { sendInviteEmail } from '@/lib/invite-mail';
import { invitePermissionError } from '@/lib/invite-status';
import { exposeActionLink, resendInviteBlock } from '@/lib/invite-access';

export const dynamic = 'force-dynamic';

/**
 * POST { userId }
 * Sends a fresh set-password email to someone who already has an account.
 * Admins can resend for any brand. A founder can resend only for their brand.
 */
export async function POST(request: NextRequest) {
  const supabase = serviceClient();
  if (!supabase) return NextResponse.json({ error: 'Server config error' }, { status: 500 });

  const caller = await loadCaller(supabase, request);
  if (!caller.ok) return caller.response;

  const body = await request.json().catch(() => ({}));
  const userId = String(body.userId || '').trim();
  if (!userId) return NextResponse.json({ error: 'userId is required' }, { status: 400 });

  const { data: target, error: targetError } = await supabase
    .from('users_profile')
    .select('id, email, full_name, role, brand_id')
    .eq('id', userId)
    .maybeSingle();

  if (targetError) return NextResponse.json({ error: targetError.message }, { status: 500 });
  if (!target?.email) return NextResponse.json({ error: 'That member was not found' }, { status: 404 });

  const denied = invitePermissionError(caller, target.brand_id);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });

  let lastSignInAt: string | null = null;
  if (caller.role !== 'admin') {
    const { data: authUser, error: authLookupError } = await supabase.auth.admin.getUserById(target.id);
    if (authLookupError || !authUser?.user) {
      return NextResponse.json({ error: 'Could not check that member' }, { status: 500 });
    }
    lastSignInAt = authUser.user.last_sign_in_at ?? null;
    const resendDenied = resendInviteBlock(caller, {
      role: target.role,
      brandId: target.brand_id,
      lastSignInAt,
    });
    if (resendDenied) return NextResponse.json({ error: resendDenied }, { status: 403 });
  }

  let brandName: string | undefined;
  if (target.brand_id) {
    const { data: brand } = await supabase.from('brands').select('name').eq('id', target.brand_id).maybeSingle();
    brandName = brand?.name;
  }

  try {
    const invited = await ensureUserWithInviteLink(supabase, target.email, {
      fullName: target.full_name || undefined,
    });
    const sent = await sendInviteEmail(supabase, {
      to: target.email,
      name: target.full_name || target.email.split('@')[0],
      role: target.role || 'strategist',
      brandName,
      inviteLink: invited.actionLink,
      invitedBy: caller.email || undefined,
      userId: target.id,
      brandId: target.brand_id,
      invitedById: caller.id,
      linkType: invited.linkType,
      source: 'resend',
    });

    return NextResponse.json({
      ok: true,
      email: target.email,
      delivery: sent.delivery,
      logError: sent.logError,
      actionLink: exposeActionLink(caller.role, invited.actionLink, sent.delivery.showCopyLink),
      linkError: invited.linkError,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Could not resend the invite' }, { status: 400 });
  }
}

function serviceClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function loadCaller(
  supabase: SupabaseClient,
  request: NextRequest
): Promise<
  | { ok: true; id: string; email: string | null; role: string; brandId: string | null }
  | { ok: false; response: NextResponse }
> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  const token = authHeader.replace('Bearer ', '');
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);
  if (error || !user) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  const { data: profile } = await supabase
    .from('users_profile')
    .select('role, brand_id')
    .eq('id', user.id)
    .single();
  if (!profile) {
    return { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return {
    ok: true,
    id: user.id,
    email: user.email || null,
    role: profile.role,
    brandId: profile.brand_id || null,
  };
}
