import { layout, card, escapeHtml } from './_layout';

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

  // Role-specific onboarding pointers
  let roleBlurb: string;
  let nextSteps: string[];

  switch (data.role) {
    case 'founder':
      roleBlurb = data.brandName
        ? `You now have access to <strong style="color:#F5F5F8;">${escapeHtml(data.brandName)}</strong>'s command center — a single place to see live ad performance, daily P&L, and campaign results across Meta and Google.`
        : `You now have access to your brand's command center — a single place to see live ad performance, daily P&L, and campaign results across Meta and Google.`;
      nextSteps = [
        'Open your <strong>Dashboard</strong> for a live spend + ROAS snapshot',
        'Check <strong>Daily P&L</strong> to see revenue, ad spend, and contribution margin by day',
        'Review <strong>Campaigns</strong> to see how each campaign is performing',
      ];
      break;
    case 'strategist':
      roleBlurb =
        'You now have access to melch.cloud — your hub for uploading creative, managing the pipeline, and keeping client campaigns moving.';
      nextSteps = [
        'Head to <strong>Upload</strong> to submit new creative batches',
        'Use <strong>Pipeline</strong> to track everything in flight',
        'Pull inspiration from <strong>Copy Templates</strong> when drafting ads',
      ];
      break;
    case 'admin':
      roleBlurb = 'You now have full admin access to melch.cloud.';
      nextSteps = [
        'Manage users from the <strong>Team</strong> page',
        'Review submissions in the <strong>Creative Queue</strong>',
        'Check <strong>Statistics</strong> for cross-brand performance',
      ];
      break;
    default:
      roleBlurb = 'You now have access to melch.cloud.';
      nextSteps = ['Sign in and explore the dashboard'];
  }

  const stepsHtml = nextSteps
    .map(
      (s, i) =>
        `<li style="color:#F5F5F8;font-size:13px;padding:6px 0;line-height:1.5;">${s}</li>`
    )
    .join('');

  const body = `
    <h2 style="font-size:20px;font-weight:600;margin:0 0 12px 0;color:#F5F5F8;">
      Welcome, ${escapeHtml(firstName)} 👋
    </h2>
    <p style="color:#ABABAB;font-size:14px;line-height:1.6;margin:0 0 16px 0;">
      ${roleBlurb}
    </p>

    ${card(
      `
      <div style="font-size:13px;font-weight:600;color:#C8B89A;margin-bottom:8px;">Get started</div>
      <ol style="margin:0;padding-left:20px;">${stepsHtml}</ol>
    `
    )}

    ${
      data.invitedBy
        ? `<p style="color:#666;font-size:12px;line-height:1.6;margin-top:20px;">
             Questions? Reply to this email or reach out to ${escapeHtml(data.invitedBy)}.
           </p>`
        : `<p style="color:#666;font-size:12px;line-height:1.6;margin-top:20px;">
             Questions? Just reply to this email.
           </p>`
    }
  `;

  return {
    subject: `Welcome to melch.cloud${data.brandName ? ` — ${data.brandName}` : ''}`,
    html: layout({
      preheader: `Your melch.cloud account is ready, ${firstName}.`,
      body,
      ctaLabel: 'Sign in to melch.cloud',
      ctaUrl: loginUrl,
    }),
  };
}
