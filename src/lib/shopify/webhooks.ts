import { SHOPIFY_CONFIG } from './config';

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

/**
 * Registers all webhook topics for a freshly-installed shop.
 * Returns the list of registered webhook IDs (or null entries on failure).
 */
export async function registerWebhooks(shop: string, accessToken: string) {
  const results: Array<{ topic: string; id: number | null; error?: string }> = [];

  for (const topic of WEBHOOK_TOPICS) {
    const address = `${SHOPIFY_CONFIG.appUrl}/api/shopify/webhooks/${topic.replace('/', '-')}`;
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
        results.push({ topic, id: json.webhook.id });
      } else {
        results.push({ topic, id: null, error: JSON.stringify(json) });
      }
    } catch (err) {
      results.push({ topic, id: null, error: (err as Error).message });
    }
  }

  return results;
}
