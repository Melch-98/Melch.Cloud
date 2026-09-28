import crypto from 'crypto';
import { SHOPIFY_CONFIG } from './config';
import { hmacMatchesSecret } from './webhook-hmac';

/**
 * Verifies the HMAC on a Shopify OAuth callback redirect.
 * Shopify signs the query string with our app secret.
 */
export function verifyOAuthHmac(query: Record<string, string>): boolean {
  const { hmac, ...rest } = query;
  if (!hmac) return false;

  const message = Object.keys(rest)
    .sort()
    .map((k) => `${k}=${rest[k]}`)
    .join('&');

  const digest = crypto
    .createHmac('sha256', SHOPIFY_CONFIG.apiSecret)
    .update(message)
    .digest('hex');

  return crypto.timingSafeEqual(Buffer.from(digest, 'hex'), Buffer.from(hmac, 'hex'));
}

/**
 * Verifies the HMAC header on an inbound Shopify webhook.
 * The signature is over the raw request body, base64-encoded.
 */
export function verifyWebhookHmac(rawBody: string, hmacHeader: string | null): boolean {
  return hmacMatchesSecret(rawBody, hmacHeader, SHOPIFY_CONFIG.apiSecret);
}

/**
 * Generates a cryptographically random nonce for OAuth state.
 */
export function generateNonce(): string {
  return crypto.randomBytes(16).toString('hex');
}
