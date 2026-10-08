/**
 * Pure mapping from a Resend send result to what Team and Onboard should show.
 * Delivered means Resend returned a message id. Anything else is a failure,
 * and the copy-link fallback is only for that case.
 */

export type InviteSendLike = {
  sent?: boolean;
  id?: string | null;
  error?: string | null;
  skipped?: string | null;
};

export type InviteDeliveryState = {
  delivered: boolean;
  /** Shown as-is. Success names the recipient. Failure is the exact reason. */
  message: string;
  showCopyLink: boolean;
  resendMessageId: string | null;
};

export function failureReason(result: InviteSendLike | null | undefined): string {
  if (!result) return 'Invite email was not sent';
  const error = result.error?.trim();
  if (error) return error;
  if (result.skipped === 'no-api-key') return 'RESEND_API_KEY is not set';
  if (result.skipped === 'empty-recipients') return 'No email address to send to';
  if (result.skipped === 'deduped') return 'A welcome email was already sent for this address a moment ago';
  if (result.skipped) return `Email skipped (${result.skipped})`;
  if (result.sent && !result.id?.trim()) return 'Resend did not return a message id';
  return 'Invite email was not sent';
}

export function describeInviteDelivery(
  email: string,
  result: InviteSendLike | null | undefined,
  opts?: { attempted?: boolean }
): InviteDeliveryState {
  if (opts?.attempted === false) {
    return {
      delivered: false,
      message: 'Welcome email was not requested',
      showCopyLink: true,
      resendMessageId: null,
    };
  }

  const id = result?.id?.trim() || '';
  if (result?.sent === true && id) {
    return {
      delivered: true,
      message: `Invite email delivered to ${email}`,
      showCopyLink: false,
      resendMessageId: id,
    };
  }

  return {
    delivered: false,
    message: failureReason(result),
    showCopyLink: true,
    resendMessageId: null,
  };
}

/** Who may invite. Admins: any brand. Founders: their own brand only. Everyone else fails closed. */
export function invitePermissionError(
  caller: { role: string | null | undefined; brandId: string | null | undefined },
  targetBrandId: string | null | undefined
): string | null {
  if (caller.role === 'admin') return null;
  if (caller.role !== 'founder') return 'Only an admin can invite people';
  if (!caller.brandId) return 'No brand is assigned to your account';
  if (!targetBrandId || targetBrandId !== caller.brandId) {
    return 'You can only invite people to your own brand';
  }
  return null;
}

const APP_LINK_TYPES = new Set(['signup', 'invite', 'magiclink', 'recovery', 'email']);

export function buildSetPasswordUrl(appBase: string, tokenHash: string, otpType: string): string | null {
  const hash = tokenHash.trim();
  const type = otpType.trim().toLowerCase();
  if (!hash || !APP_LINK_TYPES.has(type)) return null;
  const base = appBase.replace(/\/$/, '');
  const query = new URLSearchParams({ token_hash: hash, type });
  return `${base}/auth/set-password?${query.toString()}`;
}
