import { SHOPIFY_CONFIG } from './config';
import { missingScopesFromShopifyBody, scopeErrorMessage } from './webhook-scope';

/**
 * Order topics a custom-app brand can subscribe to with its own token.
 * refunds/create is omitted: the refund Inngest handler only logs, and an
 * orders/updated delivery already upserts the order (refunds included in `raw`).
 */
export const BRAND_ORDER_WEBHOOK_TOPICS = [
  'orders/create',
  'orders/updated',
  'orders/cancelled',
] as const;

export type BrandOrderTopic = (typeof BRAND_ORDER_WEBHOOK_TOPICS)[number];

export type RemoteWebhook = {
  id: number;
  topic: string;
  address: string;
  created_at?: string;
  updated_at?: string;
  format?: string;
};

export type TopicRegistration = {
  topic: BrandOrderTopic;
  status: 'already_registered' | 'created' | 'missing' | 'error';
  id: number | null;
  address: string | null;
  error?: string;
};

export type WebhookScopeError = {
  scopes: string[];
  status: number;
  message: string;
  grantedScopes: string | null;
  shopifyBody: unknown;
};

export type WebhookManageResult = {
  topics: TopicRegistration[];
  webhooks: RemoteWebhook[];
  scopeError: WebhookScopeError | null;
};

type ShopifyResponse = {
  ok: boolean;
  status: number;
  json: unknown;
  link: string | null;
};

function appBaseUrl(): string {
  return (SHOPIFY_CONFIG.appUrl || 'https://melch.cloud').replace(/\/$/, '');
}

export function orderWebhookAddress(topic: string): string {
  return `${appBaseUrl()}/api/shopify/webhooks/${topic.replace(/\//g, '-')}`;
}

function sharedOrderWebhookAddress(): string {
  return `${appBaseUrl()}/api/shopify/webhooks/orders`;
}

export function webhookCoversTopic(address: string, topic: string): boolean {
  const normalized = address.replace(/\/$/, '');
  return normalized === orderWebhookAddress(topic) || normalized === sharedOrderWebhookAddress();
}

function scopeError(status: number, body: unknown, grantedScopes: string | null): WebhookScopeError {
  const scopes = missingScopesFromShopifyBody(body);
  return {
    scopes,
    status,
    message: scopeErrorMessage(scopes, status, body),
    grantedScopes,
    shopifyBody: body,
  };
}

function scopeDenial(
  status: number,
  body: unknown,
  grantedScopes: string | null
): WebhookScopeError | null {
  const scopes = missingScopesFromShopifyBody(body);
  // 403 is Shopify's missing-scope response. 401 is an invalid token unless
  // the body itself names a scope.
  if (status === 403 || (status === 401 && scopes.length > 0)) {
    return scopeError(status, body, grantedScopes);
  }
  return null;
}

async function shopifyAdmin(
  url: string,
  token: string,
  init?: { method?: string; body?: string }
): Promise<ShopifyResponse> {
  const res = await fetch(url, {
    method: init?.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token,
    },
    body: init?.body,
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
  return { ok: res.ok, status: res.status, json, link: res.headers.get('Link') };
}

function nextPageUrl(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
  return match ? match[1] : null;
}

function asWebhook(value: unknown): RemoteWebhook | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as { id?: unknown; topic?: unknown; address?: unknown; created_at?: string; updated_at?: string; format?: string };
  if (typeof row.id !== 'number' || typeof row.topic !== 'string' || typeof row.address !== 'string') {
    return null;
  }
  return {
    id: row.id,
    topic: row.topic,
    address: row.address,
    created_at: row.created_at,
    updated_at: row.updated_at,
    format: row.format,
  };
}

async function listAllWebhooks(
  domain: string,
  token: string,
  grantedScopes: string | null
): Promise<{ webhooks: RemoteWebhook[]; scopeError: WebhookScopeError | null }> {
  const webhooks: RemoteWebhook[] = [];
  let url: string | null =
    `https://${domain}/admin/api/${SHOPIFY_CONFIG.apiVersion}/webhooks.json?limit=250`;

  for (let page = 0; page < 20 && url; page++) {
    const res = await shopifyAdmin(url, token);
    const denied = scopeDenial(res.status, res.json, grantedScopes);
    if (denied) return { webhooks, scopeError: denied };
    if (!res.ok) {
      throw new Error(
        `Shopify webhook list failed (${res.status}): ${JSON.stringify(res.json).slice(0, 400)}`
      );
    }
    const batch = Array.isArray((res.json as { webhooks?: unknown })?.webhooks)
      ? (res.json as { webhooks: unknown[] }).webhooks
      : [];
    for (const item of batch) {
      const webhook = asWebhook(item);
      if (webhook) webhooks.push(webhook);
    }
    url = nextPageUrl(res.link);
  }

  return { webhooks, scopeError: null };
}

function findCovering(webhooks: RemoteWebhook[], topic: BrandOrderTopic): RemoteWebhook | undefined {
  return webhooks.find((webhook) => webhook.topic === topic && webhookCoversTopic(webhook.address, topic));
}

function addressAlreadyTaken(body: unknown): boolean {
  const text = typeof body === 'string' ? body : JSON.stringify(body ?? '');
  return /already been taken/i.test(text);
}

/**
 * Lists Shopify webhooks and reports whether each order topic already points
 * at this app. Does not create anything.
 */
export async function listBrandOrderWebhooks(
  domain: string,
  token: string,
  grantedScopes: string | null
): Promise<WebhookManageResult> {
  const listed = await listAllWebhooks(domain, token, grantedScopes);
  if (listed.scopeError) {
    return {
      webhooks: listed.webhooks,
      scopeError: listed.scopeError,
      topics: BRAND_ORDER_WEBHOOK_TOPICS.map((topic) => ({
        topic,
        status: 'error',
        id: null,
        address: orderWebhookAddress(topic),
        error: listed.scopeError?.message,
      })),
    };
  }

  return {
    webhooks: listed.webhooks,
    scopeError: null,
    topics: BRAND_ORDER_WEBHOOK_TOPICS.map((topic) => {
      const match = findCovering(listed.webhooks, topic);
      return match
        ? { topic, status: 'already_registered' as const, id: match.id, address: match.address }
        : { topic, status: 'missing' as const, id: null, address: orderWebhookAddress(topic) };
    }),
  };
}

/**
 * Idempotently registers orders/create, orders/updated, and orders/cancelled.
 * An existing webhook for the same topic whose address is our receiver is left in place.
 */
export async function registerBrandOrderWebhooks(
  domain: string,
  token: string,
  grantedScopes: string | null
): Promise<WebhookManageResult> {
  const listed = await listAllWebhooks(domain, token, grantedScopes);
  if (listed.scopeError) {
    return {
      webhooks: listed.webhooks,
      scopeError: listed.scopeError,
      topics: BRAND_ORDER_WEBHOOK_TOPICS.map((topic) => ({
        topic,
        status: 'error',
        id: null,
        address: orderWebhookAddress(topic),
        error: listed.scopeError?.message,
      })),
    };
  }

  const webhooks = listed.webhooks;
  const topics: TopicRegistration[] = [];

  for (const topic of BRAND_ORDER_WEBHOOK_TOPICS) {
    const address = orderWebhookAddress(topic);
    const existing = findCovering(webhooks, topic);
    if (existing) {
      topics.push({ topic, status: 'already_registered', id: existing.id, address: existing.address });
      continue;
    }

    const res = await shopifyAdmin(
      `https://${domain}/admin/api/${SHOPIFY_CONFIG.apiVersion}/webhooks.json`,
      token,
      {
        method: 'POST',
        body: JSON.stringify({ webhook: { topic, address, format: 'json' } }),
      }
    );

    const denied = scopeDenial(res.status, res.json, grantedScopes);
    if (denied) {
      topics.push({ topic, status: 'error', id: null, address, error: denied.message });
      for (const remaining of BRAND_ORDER_WEBHOOK_TOPICS.slice(topics.length)) {
        topics.push({
          topic: remaining,
          status: 'missing',
          id: null,
          address: orderWebhookAddress(remaining),
          error: denied.message,
        });
      }
      return { topics, webhooks, scopeError: denied };
    }

    const created = asWebhook((res.json as { webhook?: unknown })?.webhook);
    if (res.ok && created) {
      webhooks.push(created);
      topics.push({ topic, status: 'created', id: created.id, address: created.address });
      continue;
    }

    if (res.status === 422 && addressAlreadyTaken(res.json)) {
      const again = await listAllWebhooks(domain, token, grantedScopes);
      const found = again.scopeError ? undefined : findCovering(again.webhooks, topic);
      if (!again.scopeError) {
        for (const webhook of again.webhooks) {
          if (!webhooks.some((row) => row.id === webhook.id)) webhooks.push(webhook);
        }
      }
      topics.push({
        topic,
        status: 'already_registered',
        id: found?.id ?? null,
        address: found?.address ?? address,
      });
      continue;
    }

    const error = `Shopify webhook create failed (${res.status}): ${JSON.stringify(res.json).slice(0, 400)}`;
    topics.push({ topic, status: 'error', id: null, address, error });
  }

  return { topics, webhooks, scopeError: null };
}
