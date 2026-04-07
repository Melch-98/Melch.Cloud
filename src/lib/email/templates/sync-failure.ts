import { layout, card, kv, escapeHtml } from './_layout';

export interface SyncFailureData {
  brandName: string;
  brandId: string;
  source: 'shopify' | 'meta' | 'google' | 'windsor' | string;
  errorMessage: string;
  occurredAt?: string;
  /** Extra context lines to show (optional) */
  context?: Record<string, string | number | null | undefined>;
}

export function renderSyncFailure(data: SyncFailureData): {
  subject: string;
  html: string;
} {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://melch.cloud';
  const when = data.occurredAt || new Date().toISOString();

  const contextRows: Array<[string, string]> = [
    ['Brand', escapeHtml(data.brandName)],
    ['Source', escapeHtml(data.source.toUpperCase())],
    ['Occurred', escapeHtml(new Date(when).toLocaleString('en-US', { timeZone: 'UTC' }) + ' UTC')],
  ];

  if (data.context) {
    for (const [k, v] of Object.entries(data.context)) {
      if (v === null || v === undefined || v === '') continue;
      contextRows.push([k, escapeHtml(String(v))]);
    }
  }

  const body = `
    <div style="background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.3);border-radius:12px;padding:16px;margin-bottom:16px;">
      <div style="color:#EF4444;font-weight:600;font-size:14px;margin-bottom:6px;">
        ⚠ Sync Failure
      </div>
      <div style="color:#F5F5F8;font-size:13px;line-height:1.5;">
        A scheduled data sync failed for <strong>${escapeHtml(data.brandName)}</strong>.
      </div>
    </div>

    ${card(kv(contextRows), { title: 'Details' })}

    ${card(
      `<pre style="color:#F5F5F8;font-family:ui-monospace,Menlo,monospace;font-size:12px;white-space:pre-wrap;word-break:break-word;margin:0;line-height:1.5;">${escapeHtml(data.errorMessage).slice(0, 2000)}</pre>`,
      { title: 'Error' }
    )}

    <p style="color:#666;font-size:11px;margin-top:16px;line-height:1.5;">
      This alert is rate-limited — you'll only get one per brand per source per hour, even if the failure repeats.
    </p>
  `;

  return {
    subject: `[melch.cloud] ${data.source.toUpperCase()} sync failed — ${data.brandName}`,
    html: layout({
      preheader: `${data.source} sync failed for ${data.brandName}`,
      body,
      ctaLabel: 'Open Dashboard',
      ctaUrl: `${appUrl}/dashboard`,
    }),
  };
}
