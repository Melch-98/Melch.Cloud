// ─── Central email layer ──────────────────────────────────────
// All outbound email goes through sendEmail().
// Templates live in ./templates/*.ts

import { Resend } from 'resend';
import { getRedis } from '@/lib/redis';
import { renderCreativeUpload, CreativeUploadData } from './templates/creative-upload';
import { renderWelcome, WelcomeData } from './templates/welcome';
import { renderSyncFailure, SyncFailureData } from './templates/sync-failure';

// ─── Template registry ────────────────────────────────────────
export type EmailTemplate =
  | { name: 'creative-upload'; data: CreativeUploadData }
  | { name: 'welcome'; data: WelcomeData }
  | { name: 'sync-failure'; data: SyncFailureData };

interface SendOpts {
  to: string | string[];
  template: EmailTemplate;
  /** Override the default From address. */
  from?: string;
  /** Deduplication key — if set, we won't re-send the same key within ttlSeconds. */
  dedupeKey?: string;
  dedupeTtlSeconds?: number;
}

interface SendResult {
  sent: boolean;
  id?: string;
  skipped?: 'no-api-key' | 'deduped' | 'empty-recipients';
  error?: string;
}

// ─── Main send function ───────────────────────────────────────
export async function sendEmail(opts: SendOpts): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('[email] RESEND_API_KEY not set — skipping send');
    return { sent: false, skipped: 'no-api-key' };
  }

  const recipients = Array.isArray(opts.to) ? opts.to : [opts.to];
  if (recipients.length === 0 || recipients.every((r) => !r?.trim())) {
    return { sent: false, skipped: 'empty-recipients' };
  }

  // Dedup check (best-effort, requires Redis)
  if (opts.dedupeKey) {
    const redis = getRedis();
    if (redis) {
      const key = `email:dedupe:${opts.dedupeKey}`;
      const existed = await redis.set(key, '1', {
        ex: opts.dedupeTtlSeconds ?? 3600,
        nx: true,
      });
      if (existed === null) {
        return { sent: false, skipped: 'deduped' };
      }
    }
  }

  // Render template
  let rendered: { subject: string; html: string };
  try {
    rendered = renderTemplate(opts.template);
  } catch (err: any) {
    console.error('[email] template render failed:', err);
    return { sent: false, error: `template render failed: ${err?.message || err}` };
  }

  // Send via Resend
  const resend = new Resend(apiKey);
  const from =
    opts.from ||
    `melch.cloud <${process.env.NOTIFICATION_FROM_EMAIL || 'noreply@melch.cloud'}>`;

  try {
    const { data, error } = await resend.emails.send({
      from,
      to: recipients,
      subject: rendered.subject,
      html: rendered.html,
    });
    if (error) {
      console.error('[email] resend error:', error);
      return { sent: false, error: error.message || 'resend error' };
    }
    return { sent: true, id: data?.id };
  } catch (err: any) {
    console.error('[email] resend threw:', err);
    return { sent: false, error: err?.message || 'resend threw' };
  }
}

// ─── Template dispatch ────────────────────────────────────────
function renderTemplate(t: EmailTemplate): { subject: string; html: string } {
  switch (t.name) {
    case 'creative-upload':
      return renderCreativeUpload(t.data);
    case 'welcome':
      return renderWelcome(t.data);
    case 'sync-failure':
      return renderSyncFailure(t.data);
    default: {
      // Exhaustiveness check
      const _never: never = t;
      throw new Error(`Unknown template: ${(_never as any)?.name}`);
    }
  }
}

// ─── Utility: list of template names (for /api/email-test) ────
export const TEMPLATE_NAMES = ['creative-upload', 'welcome', 'sync-failure'] as const;
export type TemplateName = (typeof TEMPLATE_NAMES)[number];
