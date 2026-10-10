import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ensureUserWithInviteLink } from '@/lib/invite';
import { sendInviteEmail } from '@/lib/invite-mail';
import { describeInviteDelivery, invitePermissionError } from '@/lib/invite-status';
import {
  EXISTING_ACCOUNT_MESSAGE,
  existingAccountBlock,
  exposeActionLink,
  findAccountByEmail,
  mustSendWelcomeEmail,
  tempPasswordAllowed,
} from '@/lib/invite-access';
import { rolePermissionDefaults } from '@/lib/role-defaults';

export const dynamic = 'force-dynamic';

/**
 * Invite / create a user.
 * POST { email, fullName, role, brandId?, sendWelcomeEmail?, tempPassword? }
 *
 * Mints a Supabase invite or recovery link, then sends it with Resend.
 * tempPassword is a legacy fallback only.
 */
export async function POST(request: NextRequest) {
  const supabase = serviceClient();
  if (!supabase) {
    return NextResponse.json({ error: 'Server config error' }, { status: 500 });
  }

  const caller = await loadCaller(supabase, request);
  if (!caller.ok) return caller.response;

  const body = await request.json();
  const { email, fullName, role, brandId, tempPassword, sendWelcomeEmail } = body;

  if (!email || !role) {
    return NextResponse.json({ error: 'email and role are required' }, { status: 400 });
  }

  if (!['admin', 'strategist', 'founder'].includes(role)) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
  }

  if (role === 'admin' && caller.role !== 'admin') {
    return NextResponse.json({ error: 'Only an admin can invite another admin' }, { status: 403 });
  }

  const targetBrandId = brandId || null;
  const denied = invitePermissionError(caller, targetBrandId);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });

  const normalizedEmail = String(email).trim().toLowerCase();
  const displayName = (fullName || normalizedEmail.split('@')[0]).trim();

  if (caller.role !== 'admin') {
    try {
      const found = await findAccountByEmail(supabase, normalizedEmail);
      const blocked = existingAccountBlock(caller.role, found);
      if (blocked) return NextResponse.json({ error: blocked }, { status: 409 });
    } catch (e: any) {
      return NextResponse.json(
        { error: e?.message || 'Could not check that email' },
        { status: 500 }
      );
    }
  }

  let userId: string;
  let isExisting = false;
  let actionLink: string | null = null;
  let linkType: 'invite' | 'recovery' | null = null;
  let linkError: string | undefined;

  try {
    const invited = await ensureUserWithInviteLink(supabase, normalizedEmail, {
      fullName: displayName,
    });
    userId = invited.userId;
    isExisting = invited.isExisting;
    actionLink = invited.actionLink;
    linkType = invited.linkType;
    linkError = invited.linkError;
  } catch (e: any) {
    if (!tempPasswordAllowed(caller.role) || !tempPassword || String(tempPassword).length < 8) {
      return NextResponse.json(
        { error: e?.message || 'Invite link generation failed' },
        { status: 400 }
      );
    }

    const created = await createWithTempPassword(supabase, normalizedEmail, String(tempPassword));
    if (!created.ok) return created.response;
    userId = created.userId;
    isExisting = created.isExisting;
  }

  if (caller.role !== 'admin' && isExisting) {
    return NextResponse.json({ error: EXISTING_ACCOUNT_MESSAGE }, { status: 409 });
  }

  const profileRow = {
    id: userId,
    email: normalizedEmail,
    full_name: displayName,
    role,
    brand_id: targetBrandId,
  };
  const { error: profileError } =
    caller.role === 'admin'
      ? await supabase.from('users_profile').upsert(profileRow, { onConflict: 'id' })
      : await supabase.from('users_profile').insert(profileRow);

  if (profileError) {
    if (!isExisting) {
      try {
        await supabase.auth.admin.deleteUser(userId);
      } catch {
        /* ignore */
      }
    }
    return NextResponse.json(
      { error: `Profile creation failed: ${profileError.message}` },
      { status: 500 }
    );
  }

  const perms = rolePermissionDefaults(role);
  const permsRow = { user_id: userId, ...perms };
  const { error: permsError } =
    caller.role === 'admin'
      ? await supabase.from('user_permissions').upsert(permsRow, { onConflict: 'user_id' })
      : await supabase.from('user_permissions').insert(permsRow);

  if (permsError) {
    console.error('Permissions upsert failed (non-fatal):', permsError.message);
  }

  const shouldEmail = mustSendWelcomeEmail(caller.role, sendWelcomeEmail);
  let brandName: string | undefined;
  if (targetBrandId) {
    const { data: brand } = await supabase.from('brands').select('name').eq('id', targetBrandId).single();
    brandName = brand?.name;
  }

  if (!shouldEmail) {
    const delivery = describeInviteDelivery(normalizedEmail, null, { attempted: false });
    return NextResponse.json({
      ok: true,
      isExisting,
      delivery,
      welcomeEmail: null,
      invite: {
        linkType,
        actionLink: exposeActionLink(caller.role, actionLink, true),
        linkError,
        emailSent: false,
      },
      user: {
        id: userId,
        email: normalizedEmail,
        fullName: displayName,
        role,
        brandId: targetBrandId,
      },
    });
  }

  const sent = await sendInviteEmail(supabase, {
    to: normalizedEmail,
    name: displayName,
    role,
    brandName,
    inviteLink: actionLink,
    invitedBy: caller.email || undefined,
    userId,
    brandId: targetBrandId,
    invitedById: caller.id,
    linkType,
    source: 'team',
  });

  return NextResponse.json({
    ok: true,
    isExisting,
    delivery: sent.delivery,
    logError: sent.logError,
    welcomeEmail: {
      sent: sent.delivery.delivered,
      error: sent.delivery.delivered ? undefined : sent.delivery.message,
      id: sent.delivery.resendMessageId,
    },
    invite: {
      linkType,
      actionLink: exposeActionLink(caller.role, actionLink, sent.delivery.showCopyLink),
      linkError,
      emailSent: sent.delivery.delivered,
      resendMessageId: sent.delivery.resendMessageId,
    },
    user: {
      id: userId,
      email: normalizedEmail,
      fullName: displayName,
      role,
      brandId: targetBrandId,
    },
  });
}

function serviceClient(): SupabaseClient | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return null;
  return createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) },
  });
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
    error: authError,
  } = await supabase.auth.getUser(token);

  if (authError || !user) {
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

async function createWithTempPassword(
  supabase: SupabaseClient,
  email: string,
  tempPassword: string
): Promise<
  | { ok: true; userId: string; isExisting: boolean }
  | { ok: false; response: NextResponse }
> {
  const { data: newAuthUser, error: createError } = await supabase.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
  });

  if (!createError && newAuthUser?.user?.id) {
    return { ok: true, userId: newAuthUser.user.id, isExisting: false };
  }

  if (
    createError &&
    (createError.message?.includes('already been registered') ||
      createError.message?.includes('already exists'))
  ) {
    return {
      ok: false,
      response: NextResponse.json({ error: EXISTING_ACCOUNT_MESSAGE }, { status: 409 }),
    };
  }

  return {
    ok: false,
    response: NextResponse.json({ error: createError?.message || 'Invite failed' }, { status: 400 }),
  };
}
