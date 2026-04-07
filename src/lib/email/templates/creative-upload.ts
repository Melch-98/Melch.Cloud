import { layout, card, kv, escapeHtml } from './_layout';

export interface CreativeUploadBatch {
  batchName: string;
  creativeType: string;
  creatorName: string;
  creatorSocialHandle: string | null;
  landingPageUrl: string | null;
  fileCount: number;
  fileNames: string[];
}

export interface CreativeUploadData {
  brandName: string;
  batchCount: number;
  totalFiles: number;
  batches: CreativeUploadBatch[];
}

export function renderCreativeUpload(data: CreativeUploadData): {
  subject: string;
  html: string;
} {
  const { brandName, batchCount, totalFiles, batches } = data;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://melch.cloud';

  const subject =
    batchCount === 1
      ? `New Creative Submission: ${batches[0]?.batchName || brandName}`
      : `${batchCount} New Creative Batches — ${brandName}`;

  const summary = card(
    kv([
      ['Brand', escapeHtml(brandName)],
      ['Batches', String(batchCount)],
      ['Total Files', `<span style="color:#C8B89A">${totalFiles}</span>`],
    ])
  );

  const batchCards = batches
    .map((b) => {
      const fileRows =
        b.fileNames.length > 0
          ? b.fileNames
              .slice(0, 12)
              .map(
                (n) =>
                  `<li style="color:#ABABAB;font-size:12px;padding:2px 0;">${escapeHtml(n)}</li>`
              )
              .join('') +
            (b.fileNames.length > 12
              ? `<li style="color:#666;font-size:12px;padding:2px 0;">…and ${b.fileNames.length - 12} more</li>`
              : '')
          : '<li style="color:#666;font-size:12px;">no files</li>';

      const rows: Array<[string, string]> = [
        ['Type', escapeHtml(b.creativeType || '—')],
        [
          'Creator',
          `${escapeHtml(b.creatorName)}${b.creatorSocialHandle ? ` <span style="color:#888;">(${escapeHtml(b.creatorSocialHandle)})</span>` : ''}`,
        ],
      ];
      if (b.landingPageUrl) {
        rows.push([
          'LP',
          `<span style="color:#C8B89A;word-break:break-all;">${escapeHtml(b.landingPageUrl)}</span>`,
        ]);
      }
      rows.push(['Files', String(b.fileCount)]);

      return card(
        kv(rows) + `<ul style="margin:12px 0 0 0;padding-left:18px;">${fileRows}</ul>`,
        { title: b.batchName }
      );
    })
    .join('');

  const body = `
    <p style="color:#ABABAB;font-size:13px;margin:0 0 8px 0;">
      ${batchCount === 1 ? 'New creative submission' : `${batchCount} new creative batches`} for <strong style="color:#F5F5F8;">${escapeHtml(brandName)}</strong>
    </p>
    ${summary}
    ${batchCards}
  `;

  return {
    subject,
    html: layout({
      preheader: `${brandName} — ${totalFiles} files across ${batchCount} batch${batchCount === 1 ? '' : 'es'}`,
      body,
      ctaLabel: 'Review in Dashboard',
      ctaUrl: `${appUrl}/admin`,
    }),
  };
}
