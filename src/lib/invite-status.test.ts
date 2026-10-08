import { describe, expect, it } from 'vitest';
import {
  buildSetPasswordUrl,
  describeInviteDelivery,
  invitePermissionError,
} from './invite-status';

describe('describeInviteDelivery', () => {
  it('is delivered only when Resend returns a message id', () => {
    const state = describeInviteDelivery('ada@brand.com', { sent: true, id: 're_abc123' });
    expect(state).toEqual({
      delivered: true,
      message: 'Invite email delivered to ada@brand.com',
      showCopyLink: false,
      resendMessageId: 're_abc123',
    });
  });

  it('does not treat a send without an id as delivered', () => {
    const state = describeInviteDelivery('ada@brand.com', { sent: true, id: '  ' });
    expect(state.delivered).toBe(false);
    expect(state.showCopyLink).toBe(true);
    expect(state.message).toBe('Resend did not return a message id');
    expect(state.resendMessageId).toBeNull();
  });

  it('shows the missing env var when the key is absent', () => {
    const state = describeInviteDelivery('ada@brand.com', { sent: false, skipped: 'no-api-key' });
    expect(state.delivered).toBe(false);
    expect(state.showCopyLink).toBe(true);
    expect(state.message).toBe('RESEND_API_KEY is not set');
  });

  it('shows Resend’s error message and the copy link', () => {
    const state = describeInviteDelivery('ada@brand.com', {
      sent: false,
      error: 'You can only send testing emails to your own email address.',
    });
    expect(state.delivered).toBe(false);
    expect(state.showCopyLink).toBe(true);
    expect(state.message).toBe('You can only send testing emails to your own email address.');
    expect(state.resendMessageId).toBeNull();
  });

  it('prefers the error string over a skipped code', () => {
    const state = describeInviteDelivery('ada@brand.com', {
      sent: false,
      skipped: 'no-api-key',
      error: 'domain is not verified',
    });
    expect(state.message).toBe('domain is not verified');
  });

  it('says the email was not requested when the caller skipped it', () => {
    const state = describeInviteDelivery('ada@brand.com', null, { attempted: false });
    expect(state.delivered).toBe(false);
    expect(state.showCopyLink).toBe(true);
    expect(state.message).toBe('Welcome email was not requested');
  });
});

describe('invitePermissionError', () => {
  it('lets an admin invite to any brand, including none', () => {
    expect(invitePermissionError({ role: 'admin', brandId: null }, 'brand-1')).toBeNull();
    expect(invitePermissionError({ role: 'admin', brandId: 'brand-9' }, null)).toBeNull();
  });

  it('lets a founder invite only to their own brand', () => {
    expect(invitePermissionError({ role: 'founder', brandId: 'brand-1' }, 'brand-1')).toBeNull();
    expect(invitePermissionError({ role: 'founder', brandId: 'brand-1' }, 'brand-2')).toMatch(/own brand/);
  });

  it('fails closed when a non-admin has no brand', () => {
    expect(invitePermissionError({ role: 'founder', brandId: null }, 'brand-1')).toMatch(/No brand/);
    expect(invitePermissionError({ role: 'founder', brandId: '' }, null)).toMatch(/No brand/);
  });

  it('rejects strategists and unknown roles', () => {
    expect(invitePermissionError({ role: 'strategist', brandId: 'brand-1' }, 'brand-1')).toMatch(/admin/);
    expect(invitePermissionError({ role: null, brandId: 'brand-1' }, 'brand-1')).toMatch(/admin/);
  });
});

describe('buildSetPasswordUrl', () => {
  it('builds a first-party link and drops a trailing slash on the app url', () => {
    expect(buildSetPasswordUrl('https://melch.cloud/', 'hash/with space', 'invite')).toBe(
      'https://melch.cloud/auth/set-password?token_hash=hash%2Fwith+space&type=invite'
    );
  });

  it('refuses an unknown token type', () => {
    expect(buildSetPasswordUrl('https://melch.cloud', 'abc', 'email_change_current')).toBeNull();
    expect(buildSetPasswordUrl('https://melch.cloud', '  ', 'invite')).toBeNull();
  });
});
