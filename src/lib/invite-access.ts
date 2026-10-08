/**
 * Invite authorization. Non-admins can invite a brand-new person onto their
 * own brand. They cannot change an existing account, and they never receive
 * the one-time link.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export const EXISTING_ACCOUNT_MESSAGE = 'That email already has an account; ask an admin.';

export type AccountLookup = {
  authUser: boolean;
  profile: boolean;
};

export function accountAlreadyExists(found: AccountLookup): boolean {
  return found.authUser || found.profile;
}

/** Non-admins may invite only an email that has neither an auth user nor a profile. */
export function existingAccountBlock(
  callerRole: string | null | undefined,
  found: AccountLookup
): string | null {
  if (callerRole === 'admin') return null;
  if (accountAlreadyExists(found)) return EXISTING_ACCOUNT_MESSAGE;
  return null;
}

/** Copyable set-password links are admin-only, including when Resend did not accept the send. */
export function exposeActionLink(
  callerRole: string | null | undefined,
  link: string | null | undefined,
  showCopyLink: boolean
): string | null {
  if (callerRole !== 'admin') return null;
  if (!showCopyLink) return null;
  const value = link?.trim();
  return value || null;
}

/** A non-admin cannot skip the email and take the link instead. */
export function mustSendWelcomeEmail(
  callerRole: string | null | undefined,
  sendWelcomeEmail: unknown
): boolean {
  if (callerRole !== 'admin') return true;
  return sendWelcomeEmail !== false;
}

export function tempPasswordAllowed(callerRole: string | null | undefined): boolean {
  return callerRole === 'admin';
}

/**
 * Founder resend: own brand, never signed in, not an admin.
 * Admins are not limited here.
 */
export function resendInviteBlock(
  caller: { role: string | null | undefined; brandId: string | null | undefined },
  target: { role: string | null | undefined; brandId: string | null | undefined; lastSignInAt: string | null | undefined }
): string | null {
  if (caller.role === 'admin') return null;
  if (caller.role !== 'founder') return 'Only an admin can resend an invite';
  if (!caller.brandId) return 'No brand is assigned to your account';
  if (!target.brandId || target.brandId !== caller.brandId) {
    return 'You can only resend an invite for your own brand';
  }
  if (target.role === 'admin') return 'Only an admin can resend an invite for an admin';
  if (target.lastSignInAt) return 'That person has already signed in';
  return null;
}

const ADMIN_ONLY_ONBOARD = new Set(['create_brand', 'archive_brand', 'restore_brand']);
const OWN_BRAND_ONBOARD = new Set(['set_integrations', 'set_dropbox']);

/** create_brand, archive, and restore are admin-only. Integration and Dropbox edits are own-brand for a founder. */
export function onboardActionBlock(
  caller: { role: string | null | undefined; brandId: string | null | undefined },
  action: string,
  brandId: string | null | undefined
): string | null {
  if (caller.role === 'admin') return null;
  if (caller.role !== 'founder') return 'Only an admin can do that';
  if (ADMIN_ONLY_ONBOARD.has(action)) return 'Only an admin can do that';
  if (OWN_BRAND_ONBOARD.has(action)) {
    if (!caller.brandId) return 'No brand is assigned to your account';
    if (!brandId || brandId !== caller.brandId) return 'You can only change your own brand';
    return null;
  }
  return null;
}

/**
 * Look up an email in users_profile and auth.users.
 * A match on either one is an existing account.
 */
export async function findAccountByEmail(
  supabase: SupabaseClient,
  email: string
): Promise<AccountLookup> {
  const normalized = email.trim().toLowerCase();

  const { data: profiles, error: profileError } = await supabase
    .from('users_profile')
    .select('id, email')
    .ilike('email', normalized)
    .limit(20);

  if (profileError) throw new Error(profileError.message);

  const profile = (profiles || []).some(
    (row: { email?: string | null }) => (row.email || '').toLowerCase() === normalized
  );

  let authUser = false;
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(error.message);
    const users = data?.users || [];
    if (users.some((user) => (user.email || '').toLowerCase() === normalized)) {
      authUser = true;
      break;
    }
    if (users.length < 200) break;
  }

  return { authUser, profile };
}
