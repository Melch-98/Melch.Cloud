import { SHOPIFY_CONFIG } from './config';
import { orderWebhookAddress, webhookCoversTopic } from './brand-webhooks';

/**
 * Webhook topics we register on every install.
 * Add new topics here and they'll be auto-registered on next install.
 */
export const WEBHOOK_TOPICS = [
  'orders/create',
  'orders/updated',
  'orders/cancelled',
  'refunds/create',
  'app/uninstalled',
  // GDPR mandatory
  'customers/data_request',
  'customers/redact',
  'shop/redact',
] as const;

export type WebhookTopic = (typeof WEBHOOK_TOPICS)[number];

type ListedWebhook = { id: number; topic: string; address: string };

function topicAddress(topic: string): string {
  return orderWebhookAddress(topic);
}

function alreadyCovers(topic: string, address: string): boolean {
  if (topic.startsWith('orders/')) return webhookCoversTopic(address, topic);
  return address.replace(/\/$/, '') === topicAddress(topic);
}

function nextPageUrl(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
  return match ? match[1] : null;
}

async function listWebhooks(
  shop: string,
  accessToken: string
): Promise<{ webhooks: ListedWebhook[]; error?: string }> {
  const webhooks: ListedWebhook[] = [];
  let url: string | null =
    `https://${shop}/admin/api/${SHOPIFY_CONFIG.apiVersion}/webhooks.json?limit=250`;

  for (let page = 0; page < 20 && url; page++) {
    const res = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken,
      },
    });
    const text = await res.text();
    let json: unknown = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = { raw: text.slice(0, 500) };
      }
    }
    if (!res.ok) {
      return {
        webhooks,
        error: `Shopify webhook list failed (${res.status}): ${JSON.stringify(json).slice(0, 400)}`,
      };
    }
    const batch = Array.isArray((json as { webhooks?: unknown })?.webhooks)
      ? (json as { webhooks: unknown[] }).webhooks
      : [];
    for (const item of batch) {
      if (!item || typeof item !== 'object') continue;
      const row = item as { id?: unknown; topic?: unknown; address?: unknown };
      if (typeof row.id === 'number' && typeof row.topic === 'string' && typeof row.address === 'string') {
        webhooks.push({ id: row.id, topic: row.topic, address: row.address });
      }
    }
    url = nextPageUrl(res.headers.get('Link'));
  }

  return { webhooks };
}

function addressAlreadyTaken(body: unknown): boolean {
  const text = typeof body === 'string' ? body : JSON.stringify(body ?? '');
  return /already been taken/i.test(text);
}

/**
 * Registers every install topic once. A topic that already points at this
 * app is left in place, including a second install of the same shop.
 */
export async function registerWebhooks(shop: string, accessToken: string) {
  const results: Array<{ topic: string; id: number | null; error?: string }> = [];
  const listed = await listWebhooks(shop, accessToken);

  for (const topic of WEBHOOK_TOPICS) {
    const address = topicAddress(topic);
    const existing = listed.webhooks.find(
      (webhook) => webhook.topic === topic && alreadyCovers(topic, webhook.address)
    );
    if (existing) {
      results.push({ topic, id: existing.id });
      continue;
    }

    try {
      const res = await fetch(
        `https://${shop}/admin/api/${SHOPIFY_CONFIG.apiVersion}/webhooks.json`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': accessToken,
          },
          body: JSON.stringify({
            webhook: {
              topic,
              address,
              format: 'json',
            },
          }),
        }
      );
      const json = await res.json();
      if (res.ok && json.webhook?.id) {
        listed.webhooks.push({
          id: json.webhook.id,
          topic,
          address: json.webhook.address || address,
        });
        results.push({ topic, id: json.webhook.id });
      } else if (res.status === 422 && addressAlreadyTaken(json)) {
        results.push({ topic, id: null });
      } else {
        results.push({ topic, id: null, error: JSON.stringify(json) });
      }
    } catch (err) {
      results.push({ topic, id: null, error: (err as Error).message });
    }
  }

  return results;
}
