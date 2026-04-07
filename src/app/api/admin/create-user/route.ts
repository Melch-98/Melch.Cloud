import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendEmail } from '@/lib/email';

export const dynamic = 'force-dynamic';

/**
 * Admin-only endpoint to create a new user.
 * POST { email, fullName, role, brandId?, tempPassword }
 *
 * Uses Supabase auth.admin.createUser() with the service role key,
 * then inserts rows into users_profile and user_permissions.
 */
export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: 'Server config error' }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  // ── Verify caller is admin ──
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

  // ── Parse body ──
  const body = await request.json();
  const { email, fullName, role, brandId, tempPassword, sendWelcomeEmail } = body;

  if (!email || !tempPassword || !role) {
    return NextResponse.json(
      { error: 'email, role, and tempPassword are required' },
      { status: 400 }
    );
  }

  if (!['admin', 'strategist', 'founder'].includes(role)) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
  }

  if (tempPassword.length < 8) {
    return NextResponse.json(
      { error: 'Password must be at least 8 characters' },
      { status: 400 }
    );
  }

  // ── Create or recover the auth user ──
  let userId: string;
  let isExisting = false;

  const { data: newAuthUser, error: createError } =
    await supabase.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true, // skip email confirmation
    });

  if (createError) {
    // If user already exists in auth, look them up and reset their password
    if (
      createError.message?.includes('already been registered') ||
      createError.message?.includes('already exists')
    ) {
      // Find the existing auth user by email
      const { data: listData, error: listError } =
        await supabase.auth.admin.listUsers({ perPage: 1000 });

      if (listError) {
        return NextResponse.json({ error: listError.message }, { status: 500 });
      }

      const existingUser = listData.users.find(
        (u) => u.email?.toLowerCase() === email.toLowerCase()
      );

      if (!existingUser) {
        return NextResponse.json(
          { error: 'User reported as existing but could not be found' },
          { status: 500 }
        );
      }

      userId = existingUser.id;
      isExisting = true;

      // Reset their password to the new temp password
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

  // ── Upsert users_profile row ──
  // Use upsert so it works for both new users and existing ones missing a profile
  const { error: profileError } = await supabase.from('users_profile').upsert(
    {
      id: userId,
      email,
      full_name: fullName || email.split('@')[0],
      role,
      brand_id: brandId || null,
    },
    { onConflict: 'id' }
  );

  if (profileError) {
    // Only clean up auth if we just created them
    if (!isExisting) {
      await supabase.auth.admin.deleteUser(userId);
    }
    return NextResponse.json(
      { error: `Profile creation failed: ${profileError.message}` },
      { status: 500 }
    );
  }

  // ── Upsert user_permissions row with defaults based on role ──
  const isAdmin = role === 'admin';
  const isFounder = role === 'founder';

  const { error: permsError } = await supabase.from('user_permissions').upsert(
    {
      user_id: userId,
      can_upload: isAdmin || isFounder,
      can_view_pipeline: isAdmin || isFounder,
      can_download: isAdmin || isFounder,
      can_delete: isAdmin,
      is_active: true,
    },
    { onConflict: 'user_id' }
  );

  if (permsError) {
    console.error('Permissions upsert failed (non-fatal):', permsError.message);
  }

  // ── Optional welcome email ──
  let welcomeEmailResult: { sent: boolean; error?: string } | null = null;
  if (sendWelcomeEmail) {
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
      to: email,
      template: {
        name: 'welcome',
        data: {
          name: fullName || email.split('@')[0],
          role,
          brandName,
          loginUrl: process.env.NEXT_PUBLIC_APP_URL || 'https://melch.cloud',
          invitedBy: caller.email || undefined,
        },
      },
    });
    welcomeEmailResult = { sent: result.sent, error: result.error };
  }

  return NextResponse.json({
    ok: true,
    isExisting,
    welcomeEmail: welcomeEmailResult,
    user: {
      id: userId,
      email,
      fullName: fullName || email.split('@')[0],
      role,
      brandId: brandId || null,
    },
  });
}
