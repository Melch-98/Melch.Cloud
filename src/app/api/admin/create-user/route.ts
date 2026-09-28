import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendEmail } from '@/lib/email';
import { ensureUserWithInviteLink, appUrl } from '@/lib/invite';
import { rolePermissionDefaults } from '@/lib/role-defaults';

export const dynamic = 'force-dynamic';

/**
 * Admin-only endpoint to invite / create a new user.
 * POST { email, fullName, role, brandId?, sendWelcomeEmail?, tempPassword? }
 *
 * Prefer Supabase generateLink invite/recovery + Resend welcome email with
 * set-password link. tempPassword is accepted only as a legacy fallback when
 * the client still sends one (not required).
 */
export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: 'Server config error' }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  const authHeader = request.headers.get('authorization');
  if (!authHeader) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const token = authHeader.replace('Bearer ', '');
  const {
    data: { user: caller },
    error: authError,
  } = await supabase.auth.getUser(token);

  if (authError || !caller) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: callerProfile } = await supabase
    .from('users_profile')
    .select('role')
    .eq('id', caller.id)
    .single();

  if (!callerProfile || callerProfile.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden — admin only' }, { status: 403 });
  }

  const body = await request.json();
  const { email, fullName, role, brandId, tempPassword, sendWelcomeEmail } = body;

  if (!email || !role) {
    return NextResponse.json(
      { error: 'email and role are required' },
      { status: 400 }
    );
  }

  if (!['admin', 'strategist', 'founder'].includes(role)) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const displayName = (fullName || normalizedEmail.split('@')[0]).trim();

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
    if (!tempPassword || String(tempPassword).length < 8) {
      return NextResponse.json(
        { error: e?.message || 'Invite link generation failed' },
        { status: 400 }
      );
    }

    const { data: newAuthUser, error: createError } =
      await supabase.auth.admin.createUser({
        email: normalizedEmail,
        password: tempPassword,
        email_confirm: true,
      });

    if (createError) {
      if (
        createError.message?.includes('already been registered') ||
        createError.message?.includes('already exists')
      ) {
        const { data: listData, error: listError } =
          await supabase.auth.admin.listUsers({ perPage: 1000 });
        if (listError) {
          return NextResponse.json({ error: listError.message }, { status: 500 });
        }
        const existingUser = listData.users.find(
          (u) => u.email?.toLowerCase() === normalizedEmail
        );
        if (!existingUser) {
          return NextResponse.json(
            { error: 'User reported as existing but could not be found' },
            { status: 500 }
          );
        }
        userId = existingUser.id;
        isExisting = true;
        const { error: updateError } = await supabase.auth.admin.updateUserById(
          userId,
          { password: tempPassword }
        );
        if (updateError) {
          return NextResponse.json(
            { error: `Password reset failed: ${updateError.message}` },
            { status: 500 }
          );
        }
      } else {
        return NextResponse.json({ error: createError.message }, { status: 400 });
      }
    } else {
      userId = newAuthUser.user.id;
    }
  }

  const { error: profileError } = await supabase.from('users_profile').upsert(
    {
      id: userId,
      email: normalizedEmail,
      full_name: displayName,
      role,
      brand_id: brandId || null,
    },
    { onConflict: 'id' }
  );

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
  const { error: permsError } = await supabase.from('user_permissions').upsert(
    { user_id: userId, ...perms },
    { onConflict: 'user_id' }
  );

  if (permsError) {
    console.error('Permissions upsert failed (non-fatal):', permsError.message);
  }

  let welcomeEmailResult: {
    sent: boolean;
    error?: string;
    skipped?: string;
  } | null = null;

  const shouldEmail = sendWelcomeEmail !== false;
  if (shouldEmail) {
    let brandName: string | undefined;
    if (brandId) {
      const { data: brand } = await supabase
        .from('brands')
        .select('name')
        .eq('id', brandId)
        .single();
      brandName = brand?.name;
    }

    const result = await sendEmail({
      to: normalizedEmail,
      template: {
        name: 'welcome',
        data: {
          name: displayName,
          role,
          brandName,
          loginUrl: appUrl(),
          inviteLink: actionLink || undefined,
          invitedBy: caller.email || undefined,
        },
      },
    });
    welcomeEmailResult = {
      sent: result.sent,
      error: result.error,
      skipped: result.skipped,
    };
  }

  const emailOk = welcomeEmailResult?.sent === true;
  const showLinkFallback = !shouldEmail || !emailOk;

  return NextResponse.json({
    ok: true,
    isExisting,
    welcomeEmail: welcomeEmailResult,
    invite: {
      linkType,
      actionLink: showLinkFallback ? actionLink : null,
      linkError,
      emailSent: emailOk,
    },
    user: {
      id: userId,
      email: normalizedEmail,
      fullName: displayName,
      role,
      brandId: brandId || null,
    },
  });
}
