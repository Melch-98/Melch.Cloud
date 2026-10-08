/**
 * Send a welcome / set-password email through the shared Resend helper
 * and write one invite_sends row (message id or the error).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { sendEmail } from '@/lib/email';
import { describeInviteDelivery, type InviteDeliveryState } from '@/lib/invite-status';
import { appUrl } from '@/lib/invite';

export type InviteEmailSource = 'team' | 'onboard' | 'resend' | 'self-service';

export async function sendInviteEmail(
  supabase: SupabaseClient,
  input: {
    to: string;
    name: string;
    role: string;
    brandName?: string;
    inviteLink?: string | null;
    invitedBy?: string;
    userId?: string | null;
    brandId?: string | null;
    invitedById?: string | null;
    linkType?: string | null;
    source: InviteEmailSource;
  }
): Promise<{ delivery: InviteDeliveryState; logError?: string }> {
  if (!input.inviteLink?.trim()) {
    const delivery = describeInviteDelivery(input.to, {
      sent: false,
      error: 'Could not create a set-password link',
    });
    const logError = await recordInviteSend(supabase, {
      userId: input.userId || null,
      email: input.to,
      brandId: input.brandId || null,
      invitedBy: input.invitedById || null,
      linkType: input.linkType || null,
      resendMessageId: null,
      error: delivery.message,
      source: input.source,
    });
    return { delivery, logError };
  }

  const result = await sendEmail({
    to: input.to,
    template: {
      name: 'welcome',
      data: {
        name: input.name,
        role: input.role,
        brandName: input.brandName,
        loginUrl: `${appUrl()}/auth/set-password`,
        inviteLink: input.inviteLink || undefined,
        invitedBy: input.invitedBy,
      },
    },
  });

  const delivery = describeInviteDelivery(input.to, {
    sent: result.sent,
    id: result.id,
    error: result.error,
    skipped: result.skipped,
  });

  const logError = await recordInviteSend(supabase, {
    userId: input.userId || null,
    email: input.to,
    brandId: input.brandId || null,
    invitedBy: input.invitedById || null,
    linkType: input.linkType || null,
    resendMessageId: delivery.resendMessageId,
    error: delivery.delivered ? null : delivery.message,
    source: input.source,
  });

  return { delivery, logError };
}

export async function recordInviteSend(
  supabase: SupabaseClient,
  row: {
    userId: string | null;
    email: string;
    brandId: string | null;
    invitedBy: string | null;
    linkType: string | null;
    resendMessageId: string | null;
    error: string | null;
    source: InviteEmailSource;
  }
): Promise<string | undefined> {
  const { error } = await supabase.from('invite_sends').insert({
    user_id: row.userId,
    email: row.email,
    brand_id: row.brandId,
    invited_by: row.invitedBy,
    link_type: row.linkType,
    resend_message_id: row.resendMessageId,
    error: row.error,
    source: row.source,
  });
  if (error) {
    console.error('[invite] could not record invite send:', error.message);
    return error.message;
  }
  return undefined;
}

export async function recentSelfServiceSend(
  supabase: SupabaseClient,
  email: string,
  withinMs: number
): Promise<boolean> {
  const since = new Date(Date.now() - withinMs).toISOString();
  const { data, error } = await supabase
    .from('invite_sends')
    .select('id')
    .eq('email', email)
    .eq('source', 'self-service')
    .gte('created_at', since)
    .limit(1);
  if (error) return false;
  return (data || []).length > 0;
}
