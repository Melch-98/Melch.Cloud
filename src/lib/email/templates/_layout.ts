// Shared HTML shell for all melch.cloud emails.
// Dark theme matching the product. All templates wrap their body content in layout().

export function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface LayoutOpts {
  preheader?: string;
  body: string;
  ctaLabel?: string;
  ctaUrl?: string;
}

export function layout({ preheader, body, ctaLabel, ctaUrl }: LayoutOpts): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://melch.cloud';
  const hiddenPreheader = preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preheader)}</div>`
    : '';

  const cta =
    ctaLabel && ctaUrl
      ? `
        <a href="${escapeHtml(ctaUrl)}"
           style="display:block;text-align:center;background-color:#C8B89A;color:#0A0A0A;padding:12px 24px;border-radius:12px;text-decoration:none;font-weight:600;font-size:14px;margin-top:24px;">
          ${escapeHtml(ctaLabel)}
        </a>`
      : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
</head>
<body style="margin:0;padding:0;background-color:#0A0A0A;">
${hiddenPreheader}
<div style="font-family:'Helvetica Neue',Arial,sans-serif;background-color:#0A0A0A;color:#F5F5F8;padding:40px 20px;">
  <div style="max-width:560px;margin:0 auto;">
    <a href="${escapeHtml(appUrl)}" style="text-decoration:none;">
      <h1 style="font-size:24px;font-weight:700;margin:0 0 24px 0;">
        <span style="color:#F5F5F8;">melch</span><span style="color:#C8B89A;">.cloud</span>
      </h1>
    </a>
    ${body}
    ${cta}
    <p style="color:#666;font-size:11px;text-align:center;margin-top:40px;">
      melch.cloud · Command Center<br>
      <a href="${escapeHtml(appUrl)}" style="color:#666;text-decoration:underline;">${escapeHtml(appUrl)}</a>
    </p>
  </div>
</div>
</body>
</html>`;
}

export function card(innerHtml: string, opts: { title?: string } = {}): string {
  return `
    <div style="background:#1A1A1A;border-radius:12px;padding:20px;border:1px solid rgba(255,255,255,0.08);margin-top:16px;">
      ${opts.title ? `<div style="font-size:14px;font-weight:600;color:#C8B89A;margin-bottom:12px;">${escapeHtml(opts.title)}</div>` : ''}
      ${innerHtml}
    </div>
  `;
}

export function kv(rows: Array<[string, string]>): string {
  return `
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      ${rows
        .map(
          ([k, v]) => `
        <tr>
          <td style="color:#ABABAB;padding:5px 0;">${escapeHtml(k)}</td>
          <td style="color:#F5F5F8;font-weight:600;text-align:right;padding:5px 0;">${v}</td>
        </tr>`
        )
        .join('')}
    </table>
  `;
}
