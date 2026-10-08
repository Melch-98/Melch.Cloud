/**
 * Invite / set-password link helpers.
 * generateLink only mints a token. It does not send mail.
 * The app emails a link to /auth/set-password through Resend.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildSetPasswordUrl } from '@/lib/invite-status';

export type InviteLinkResult = {
  userId: string;
  isExisting: boolean;
  /** First-party set-password URL. Shown in the admin UI only when email fails. */
  actionLink: string | null;
  linkType: 'invite' | 'recovery' | null;
  tokenHash: string | null;
  linkError?: string;
};

type GeneratedProps = {
  action_link?: string;
  hashed_token?: string;
  verification_type?: string;
};

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || 'https://melch.cloud').replace(/\/$/, '');
}

function setPasswordRedirect(): string {
  return `${appUrl()}/auth/set-password`;
}

function readGenerated(
  data: { properties?: GeneratedProps | null; action_link?: string; user?: { id?: string } | null } | null,
  fallbackType: 'invite' | 'recovery'
): { actionLink: string | null; tokenHash: string | null; linkType: 'invite' | 'recovery' } {
  const props = data?.properties || {};
  const tokenHash = props.hashed_token || null;
  const rawType = (props.verification_type || fallbackType).toLowerCase();
  const linkType: 'invite' | 'recovery' = rawType === 'invite' ? 'invite' : 'recovery';
  const appLink = tokenHash ? buildSetPasswordUrl(appUrl(), tokenHash, linkType) : null;
  const supabaseLink = props.action_link || data?.action_link || null;
  return {
    actionLink: appLink || supabaseLink,
    tokenHash,
    linkType,
  };
}

/**
 * Ensure an auth user exists and return a set-password link.
 * Never returns a plaintext password. Does not send email.
 */
export async function ensureUserWithInviteLink(
  supabase: SupabaseClient,
  email: string,
  meta?: { fullName?: string }
): Promise<InviteLinkResult> {
  const redirectTo = setPasswordRedirect();
  const normalized = email.trim().toLowerCase();

  const { data: inviteData, error: inviteError } = await supabase.auth.admin.generateLink({
    type: 'invite',
    email: normalized,
    options: {
      data: meta?.fullName ? { full_name: meta.fullName } : undefined,
      redirectTo,
    },
  });

  if (!inviteError && inviteData?.user?.id) {
    const parsed = readGenerated(inviteData, 'invite');
    return {
      userId: inviteData.user.id,
      isExisting: false,
      actionLink: parsed.actionLink,
      linkType: 'invite',
      tokenHash: parsed.tokenHash,
    };
  }

  const already =
    inviteError?.message?.toLowerCase().includes('already') ||
    inviteError?.message?.toLowerCase().includes('registered') ||
    inviteError?.status === 422;

  if (!already && inviteError) {
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
        tokenHash: recovery.tokenHash,
        linkError: recovery.linkError,
      };
    }
  }

  const { data: listData, error: listError } = await supabase.auth.admin.listUsers({
    perPage: 1000,
  });
  if (listError) throw new Error(listError.message);

  const existing = listData.users.find((u) => u.email?.toLowerCase() === normalized);
  if (!existing) {
    throw new Error(inviteError?.message || 'Could not create or find auth user for invite');
  }

  const recovery = await generateRecoveryLink(supabase, normalized, redirectTo);
  return {
    userId: existing.id,
    isExisting: true,
    actionLink: recovery.actionLink,
    linkType: 'recovery',
    tokenHash: recovery.tokenHash,
    linkError: recovery.linkError,
  };
}

/**
 * New set-password link for someone who already has an auth user.
 * Returns null when that email is not registered. Does not create a user.
 */
export async function recoveryLinkForExisting(
  supabase: SupabaseClient,
  email: string
): Promise<InviteLinkResult | null> {
  const normalized = email.trim().toLowerCase();
  const recovery = await generateRecoveryLink(supabase, normalized, setPasswordRedirect());
  if (!recovery.userId || !recovery.actionLink) return null;
  return {
    userId: recovery.userId,
    isExisting: true,
    actionLink: recovery.actionLink,
    linkType: 'recovery',
    tokenHash: recovery.tokenHash,
    linkError: recovery.linkError,
  };
}

async function generateRecoveryLink(
  supabase: SupabaseClient,
  email: string,
  redirectTo: string
): Promise<{
  userId: string | null;
  actionLink: string | null;
  tokenHash: string | null;
  linkError?: string;
}> {
  const { data, error } = await supabase.auth.admin.generateLink({
    type: 'recovery',
    email,
    options: { redirectTo },
  });
  if (error || !data?.user?.id) {
    return { userId: null, actionLink: null, tokenHash: null, linkError: error?.message || 'Could not create a set-password link' };
  }
  const parsed = readGenerated(data, 'recovery');
  return {
    userId: data.user.id,
    actionLink: parsed.actionLink,
    tokenHash: parsed.tokenHash,
  };
}

export { appUrl };
