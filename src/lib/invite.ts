/**
 * Invite / set-password link helpers for admin user creation.
 * Prefer generateLink (invite/recovery) + Resend welcome email over
 * discarding temp passwords nobody sees.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export type InviteLinkResult = {
  userId: string;
  isExisting: boolean;
  /** One-time action link (invite or recovery). Show in admin UI if email fails. */
  actionLink: string | null;
  linkType: 'invite' | 'recovery' | null;
  linkError?: string;
};

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || 'https://melch.cloud').replace(/\/$/, '');
}

/**
 * Ensure an auth user exists and return a set-password / invite action link.
 * Never returns a plaintext password.
 */
export async function ensureUserWithInviteLink(
  supabase: SupabaseClient,
  email: string,
  meta?: { fullName?: string }
): Promise<InviteLinkResult> {
  const redirectTo = `${appUrl()}/`;
  const normalized = email.trim().toLowerCase();

  // Prefer invite link (creates user if missing)
  const { data: inviteData, error: inviteError } = await supabase.auth.admin.generateLink({
    type: 'invite',
    email: normalized,
    options: {
      data: meta?.fullName ? { full_name: meta.fullName } : undefined,
      redirectTo,
    },
  });

  if (!inviteError && inviteData?.user?.id) {
    const actionLink =
      (inviteData as any).properties?.action_link ||
      (inviteData as any).action_link ||
      null;
    return {
      userId: inviteData.user.id,
      isExisting: false,
      actionLink,
      linkType: 'invite',
    };
  }

  // User already registered — look up + recovery (set-password) link
  const already =
    inviteError?.message?.toLowerCase().includes('already') ||
    inviteError?.message?.toLowerCase().includes('registered') ||
    inviteError?.status === 422;

  if (!already && inviteError) {
    // Try createUser without password, then recovery
    const { data: created, error: createError } = await supabase.auth.admin.createUser({
      email: normalized,
      email_confirm: true,
      user_metadata: meta?.fullName ? { full_name: meta.fullName } : undefined,
    });

    if (createError) {
      const exists =
        createError.message?.includes('already been registered') ||
        createError.message?.includes('already exists');
      if (!exists) {
        throw new Error(createError.message || inviteError.message);
      }
    } else if (created?.user?.id) {
      const recovery = await generateRecoveryLink(supabase, normalized, redirectTo);
      return {
        userId: created.user.id,
        isExisting: false,
        actionLink: recovery.actionLink,
        linkType: 'recovery',
        linkError: recovery.linkError,
      };
    }
  }

  const { data: listData, error: listError } = await supabase.auth.admin.listUsers({
    perPage: 1000,
  });
  if (listError) throw new Error(listError.message);

  const existing = listData.users.find(
    (u) => u.email?.toLowerCase() === normalized
  );
  if (!existing) {
    throw new Error(
      inviteError?.message || 'Could not create or find auth user for invite'
    );
  }

  const recovery = await generateRecoveryLink(supabase, normalized, redirectTo);
  return {
    userId: existing.id,
    isExisting: true,
    actionLink: recovery.actionLink,
    linkType: 'recovery',
    linkError: recovery.linkError,
  };
}

async function generateRecoveryLink(
  supabase: SupabaseClient,
  email: string,
  redirectTo: string
): Promise<{ actionLink: string | null; linkError?: string }> {
  const { data, error } = await supabase.auth.admin.generateLink({
    type: 'recovery',
    email,
    options: { redirectTo },
  });
  if (error) {
    return { actionLink: null, linkError: error.message };
  }
  const actionLink =
    (data as any)?.properties?.action_link || (data as any)?.action_link || null;
  return { actionLink };
}

export { appUrl };
