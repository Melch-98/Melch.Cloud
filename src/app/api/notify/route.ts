import { NextResponse } from 'next/server';
import { Resend } from 'resend';

export const dynamic = 'force-dynamic';

// ─── Slack Helper ──────────────────────────────────────────────
async function sendSlackNotification({
  batchName,
  creatorName,
  fileCount,
  brandName,
}: {
  batchName: string;
  creatorName: string;
  fileCount: number;
  brandName: string;
}) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    console.warn('SLACK_WEBHOOK_URL not set — skipping Slack notification');
    return { skipped: true };
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://melch.cloud';

  const payload = {
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '🎨 New Creative Submission',
          emoji: true,
        },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Batch*\n${batchName}` },
          { type: 'mrkdwn', text: `*Brand*\n${brandName}` },
          { type: 'mrkdwn', text: `*Creator*\n${creatorName}` },
          { type: 'mrkdwn', text: `*Files*\n${fileCount} file${fileCount !== 1 ? 's' : ''}` },
        ],
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Review in Dashboard', emoji: true },
            url: `${appUrl}/admin`,
            style: 'primary',
          },
        ],
      },
    ],
  };

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error('Slack webhook error:', res.status, await res.text());
      return { error: 'Slack webhook failed' };
    }
    return { success: true };
  } catch (err) {
    console.error('Slack notification error:', err);
    return { error: 'Slack notification failed' };
  }
}

// ─── Main Handler ──────────────────────────────────────────────
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { batchName, creatorName, fileCount, brandName } = body;

    // Fire both notifications in parallel
    const [emailResult, slackResult] = await Promise.allSettled([
      // Email via Resend
      (async () => {
        const apiKey = process.env.RESEND_API_KEY;
        if (!apiKey) {
          console.warn('RESEND_API_KEY not set — skipping email notification');
          return { skipped: true };
        }

        const resend = new Resend(apiKey);
        const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL || 'melch@melch.media';
        const fromEmail = process.env.NOTIFICATION_FROM_EMAIL || 'noreply@melch.cloud';

        const { data, error } = await resend.emails.send({
          from: `melch.cloud <${fromEmail}>`,
          to: [adminEmail],
          subject: `New Creative Submission: ${batchName}`,
          html: `
            <div style="font-family: 'Helvetica Neue', sans-serif; background-color: #0A0A0A; color: #F5F5F8; padding: 40px; border-radius: 12px;">
              <div style="max-width: 500px; margin: 0 auto;">
                <h1 style="font-size: 24px; font-weight: 700; margin-bottom: 4px;">
                  <span style="color: #F5F5F8;">melch</span><span style="color: #C8B89A;">.cloud</span>
                </h1>
                <p style="color: #ABABAB; font-size: 13px; margin-bottom: 32px;">New creative submission received</p>

                <div style="background: #222222; border-radius: 12px; padding: 24px; border: 1px solid rgba(255,255,255,0.1);">
                  <table style="width: 100%; border-collapse: collapse;">
                    <tr>
                      <td style="color: #ABABAB; font-size: 13px; padding: 8px 0;">Batch</td>
                      <td style="color: #F5F5F8; font-size: 13px; font-weight: 600; text-align: right;">${batchName}</td>
                    </tr>
                    <tr>
                      <td style="color: #ABABAB; font-size: 13px; padding: 8px 0;">Brand</td>
                      <td style="color: #F5F5F8; font-size: 13px; font-weight: 600; text-align: right;">${brandName}</td>
                    </tr>
                    <tr>
                      <td style="color: #ABABAB; font-size: 13px; padding: 8px 0;">Creator</td>
                      <td style="color: #F5F5F8; font-size: 13px; font-weight: 600; text-align: right;">${creatorName}</td>
                    </tr>
                    <tr>
                      <td style="color: #ABABAB; font-size: 13px; padding: 8px 0;">Files</td>
                      <td style="color: #C8B89A; font-size: 13px; font-weight: 600; text-align: right;">${fileCount} file${fileCount !== 1 ? 's' : ''}</td>
                    </tr>
                  </table>
                </div>

                <a href="${process.env.NEXT_PUBLIC_APP_URL || 'https://melch.cloud'}/admin"
                   style="display: block; text-align: center; background-color: #C8B89A; color: #0A0A0A; padding: 12px 24px; border-radius: 12px; text-decoration: none; font-weight: 600; font-size: 14px; margin-top: 24px;">
                  Review in Dashboard
                </a>

                <p style="color: #666; font-size: 11px; text-align: center; margin-top: 32px;">
                  melch.cloud Creative Upload Portal
                </p>
              </div>
            </div>
          `,
        });

        if (error) {
          console.error('Resend error:', error);
          return { error: 'Email failed' };
        }
        return { success: true, id: data?.id };
      })(),

      // Slack webhook
      sendSlackNotification({ batchName, creatorName, fileCount, brandName }),
    ]);

    return NextResponse.json({
      success: true,
      email:
        emailResult.status === 'fulfilled' ? emailResult.value : { error: 'Email failed' },
      slack:
        slackResult.status === 'fulfilled' ? slackResult.value : { error: 'Slack failed' },
    });
  } catch (err) {
    console.error('Notification error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
