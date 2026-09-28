import crypto from 'crypto';

export type WebhookAuth =
  | { ok: true; via: 'app' | 'brand' }
  | { ok: false; reason: 'missing_hmac' | 'invalid_hmac' | 'lookup_failed' };

/**
 * Timing-safe check of a Shopify webhook HMAC (base64 SHA-256 over the raw body).
 * Empty secrets never match. A length mismatch is a rejection, not an exception.
 */
export function hmacMatchesSecret(
  rawBody: string,
  hmacHeader: string | null,
  secret: string | null | undefined
): boolean {
  if (!hmacHeader || !secret) return false;

  const digest = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64');
  const actual = Buffer.from(digest);
  const expected = Buffer.from(hmacHeader);
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

/**
 * Accepts a webhook signed by the Melch.Cloud app secret or by one of the
 * brand custom-app secrets. Unsigned payloads are rejected before any lookup.
 * A thrown secret lookup is reported separately so the route can return 500
 * and let Shopify retry, instead of treating a database outage as a bad signature.
 */
export async function authorizeShopifyWebhook(args: {
  rawBody: string;
  hmacHeader: string | null;
  shopDomain: string;
  appSecret: string | null | undefined;
  loadBrandSecrets: (shopDomain: string) => Promise<string[]>;
}): Promise<WebhookAuth> {
  const { rawBody, hmacHeader, shopDomain, appSecret, loadBrandSecrets } = args;
  if (!hmacHeader) return { ok: false, reason: 'missing_hmac' };

  if (hmacMatchesSecret(rawBody, hmacHeader, appSecret)) {
    return { ok: true, via: 'app' };
  }

  if (!shopDomain) return { ok: false, reason: 'invalid_hmac' };

  let secrets: string[];
  try {
    secrets = await loadBrandSecrets(shopDomain);
  } catch {
    return { ok: false, reason: 'lookup_failed' };
  }

  for (const secret of secrets) {
    if (hmacMatchesSecret(rawBody, hmacHeader, secret)) {
      return { ok: true, via: 'brand' };
    }
  }

  return { ok: false, reason: 'invalid_hmac' };
}
