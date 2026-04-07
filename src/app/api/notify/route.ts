// ─── /api/notify ──────────────────────────────────────────────
// Sends creative-upload notifications to Slack + email.
// Email goes through the central email module. Slack stays inline.

import { NextResponse } from 'next/server';
import { sendEmail } from '@/lib/email';
import type {
  CreativeUploadBatch,
  CreativeUploadData,
} from '@/lib/email/templates/creative-upload';

export const dynamic = 'force-dynamic';

// ─── Slack notification ───────────────────────────────────────
async function sendSlackNotification(body: CreativeUploadData) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    console.warn('SLACK_WEBHOOK_URL not set — skipping Slack notification');
    return { skipped: true };
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://melch.cloud';
  const { brandName, batchCount, totalFiles, batches } = body;

  const headerText =
    batchCount === 1
      ? `🎨 New Creative Submission — ${brandName}`
      : `🎨 ${batchCount} New Creative Batches — ${brandName}`;

  const summaryFields = [
    { type: 'mrkdwn', text: `*Brand*\n${brandName}` },
    { type: 'mrkdwn', text: `*Batches*\n${batchCount}` },
    { type: 'mrkdwn', text: `*Total Files*\n${totalFiles}` },
    {
      type: 'mrkdwn',
      text: `*Creators*\n${Array.from(new Set(batches.map((b) => b.creatorName))).join(', ')}`,
    },
  ];

  const batchBlocks = batches.flatMap((b) => {
    const fileList =
      b.fileNames.length > 0
        ? b.fileNames
            .slice(0, 8)
            .map((n) => `• ${n}`)
            .join('\n') +
          (b.fileNames.length > 8 ? `\n…and ${b.fileNames.length - 8} more` : '')
        : '_no files_';

    const meta: string[] = [
      `*${b.batchName}*`,
      `Type: ${b.creativeType || '—'}`,
      `Creator: ${b.creatorName}${b.creatorSocialHandle ? ` (${b.creatorSocialHandle})` : ''}`,
      `Files: ${b.fileCount}`,
    ];
    if (b.landingPageUrl) meta.push(`LP: ${b.landingPageUrl}`);

    return [
      { type: 'divider' },
      { type: 'section', text: { type: 'mrkdwn', text: meta.join('\n') } },
      { type: 'section', text: { type: 'mrkdwn', text: fileList } },
    ];
  });

  const payload = {
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: headerText, emoji: true } },
      { type: 'section', fields: summaryFields },
      ...batchBlocks,
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

// ─── Main handler ─────────────────────────────────────────────
export async function POST(request: Request) {
  try {
    const raw = await request.json();

    const data: CreativeUploadData = {
      brandName: raw.brandName || 'Unknown brand',
      batchCount: raw.batchCount ?? (raw.batches?.length || 1),
      totalFiles:
        raw.totalFiles ??
        (raw.batches?.reduce(
          (s: number, b: CreativeUploadBatch) => s + (b.fileCount || 0),
          0
        ) || 0),
      batches: Array.isArray(raw.batches) ? raw.batches : [],
    };

    const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL || 'melch@melch.media';

    const [emailResult, slackResult] = await Promise.allSettled([
      sendEmail({
        to: adminEmail,
        template: { name: 'creative-upload', data },
      }),
      sendSlackNotification(data),
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
