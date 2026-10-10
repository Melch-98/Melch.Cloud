import { sendEmail } from '@/lib/email';
import type { CreativeUploadData } from '@/lib/email/templates/creative-upload';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ServiceClient = any;

/**
 * Email + Slack for a creative upload. Failures are returned, not thrown,
 * so Dropbox sync can keep going.
 */
export async function deliverCreativeUploadNotice(
  data: CreativeUploadData
): Promise<{ email: unknown; slack: unknown }> {
  const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL || 'melch@melch.media';
  const [emailResult, slackResult] = await Promise.allSettled([
    sendEmail({
      to: adminEmail,
      template: { name: 'creative-upload', data },
    }),
    sendSlackNotification(data),
  ]);
  return {
    email: emailResult.status === 'fulfilled' ? emailResult.value : { error: 'Email failed' },
    slack: slackResult.status === 'fulfilled' ? slackResult.value : { error: 'Slack failed' },
  };
}

/** Email + Slack after a batch is saved. Dropbox keeps the uploaded file names. */
export async function notifySubmissionNamed(
  supabase: ServiceClient,
  submissionId: string
): Promise<void> {
  const { data: submission, error } = await supabase
    .from('submissions')
    .select(
      `batch_name, creative_type, creator_name, creator_social_handle, landing_page_url,
       brands:brand_id (name)`
    )
    .eq('id', submissionId)
    .single();
  if (error || !submission) return;

  const { data: files } = await supabase
    .from('submission_files')
    .select('file_name')
    .eq('submission_id', submissionId);

  const list = (files || []) as Array<{ file_name: string }>;
  const brand = submission.brands as { name?: string } | { name?: string }[] | null;
  const brandName = (Array.isArray(brand) ? brand[0]?.name : brand?.name) || 'Unknown brand';

  await deliverCreativeUploadNotice({
    brandName,
    batchCount: 1,
    totalFiles: list.length,
    batches: [
      {
        batchName: submission.batch_name || 'Batch',
        creativeType: submission.creative_type || '',
        creatorName: submission.creator_name || 'Unknown',
        creatorSocialHandle: submission.creator_social_handle || null,
        landingPageUrl: submission.landing_page_url || null,
        fileCount: list.length,
        fileNames: list.map((file) => file.file_name),
      },
    ],
  });
}

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
