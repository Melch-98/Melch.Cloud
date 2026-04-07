import { layout, escapeHtml } from './_layout';

export interface WelcomeData {
  name: string;
  role: 'admin' | 'strategist' | 'founder' | string;
  brandName?: string;
  /** Sign-in URL — defaults to NEXT_PUBLIC_APP_URL */
  loginUrl?: string;
  /** Invited by / agency contact for reply-to context */
  invitedBy?: string;
}

export function renderWelcome(data: WelcomeData): { subject: string; html: string } {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://melch.cloud';
  const loginUrl = data.loginUrl || appUrl;
  const firstName = data.name?.split(' ')[0] || 'there';

  const brandLine = data.brandName
    ? `Everything for <strong style="color:#F5F5F8;">${escapeHtml(data.brandName)}</strong> lives here now`
    : `Everything lives here now`;

  const body = `
    <h2 style="font-size:20px;font-weight:600;margin:0 0 12px 0;color:#F5F5F8;">
      Hey ${escapeHtml(firstName)},
    </h2>
    <p style="color:#ABABAB;font-size:14px;line-height:1.6;margin:0 0 14px 0;">
      I built melch.cloud to get us out of the tool-hopping and spreadsheet chaos.
      ${brandLine} — drop creative, see what's live, track how it's performing, all in one spot.
    </p>
    <p style="color:#ABABAB;font-size:14px;line-height:1.6;margin:0 0 20px 0;">
      Poke around and let me know what's missing.
    </p>
    <p style="color:#ABABAB;font-size:14px;line-height:1.6;margin:0 0 4px 0;">— Melch</p>
  `;

  return {
    subject: `You're in — welcome to melch.cloud`,
    html: layout({
      preheader: `You're in, ${firstName}. Everything for ${data.brandName || 'your brand'} lives here now.`,
      body,
      ctaLabel: 'Sign in',
      ctaUrl: loginUrl,
    }),
  };
}
