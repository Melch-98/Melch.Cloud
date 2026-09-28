import type { TopicRegistration } from './brand-webhooks';

export const WEBHOOK_STATUS_KEY_PREFIX = 'shopify_order_webhooks:';

export type StoredWebhookStatus = {
  shop_domain: string;
  updated_at: string;
  ok: boolean;
  missing_scope: string | null;
  topics: TopicRegistration[];
};

export function webhookStatusKey(brandId: string): string {
  return `${WEBHOOK_STATUS_KEY_PREFIX}${brandId}`;
}

export function statusFromRegistration(
  shopDomain: string,
  topics: TopicRegistration[],
  missingScope: string | null
): StoredWebhookStatus {
  const ok =
    !missingScope &&
    topics.length > 0 &&
    topics.every((topic) => topic.status === 'already_registered' || topic.status === 'created');
  return {
    shop_domain: shopDomain,
    updated_at: new Date().toISOString(),
    ok,
    missing_scope: missingScope,
    topics,
  };
}

export async function saveWebhookStatus(
  supabase: { from: (table: string) => any },
  brandId: string,
  status: StoredWebhookStatus
): Promise<boolean> {
  const { error } = await supabase.from('app_settings').upsert(
    {
      key: webhookStatusKey(brandId),
      value: JSON.stringify(status),
      updated_at: status.updated_at,
    },
    { onConflict: 'key' }
  );
  return !error;
}

export async function loadWebhookStatuses(
  supabase: { from: (table: string) => any }
): Promise<Map<string, StoredWebhookStatus>> {
  const map = new Map<string, StoredWebhookStatus>();
  const { data, error } = await supabase
    .from('app_settings')
    .select('key, value')
    .like('key', `${WEBHOOK_STATUS_KEY_PREFIX}%`);
  if (error || !data) return map;

  for (const row of data as Array<{ key?: string; value?: string }>) {
    if (!row.key?.startsWith(WEBHOOK_STATUS_KEY_PREFIX) || !row.value) continue;
    try {
      const parsed = JSON.parse(row.value) as StoredWebhookStatus;
      map.set(row.key.slice(WEBHOOK_STATUS_KEY_PREFIX.length), parsed);
    } catch {
      /* ignore a corrupt settings row */
    }
  }
  return map;
}
