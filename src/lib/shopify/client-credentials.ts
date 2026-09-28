import { isValidShopDomain } from './config';

export type ClientCredentialsToken = {
  accessToken: string;
  scope: string;
};

/**
 * Client-credentials grant used by per-brand Shopify custom apps.
 * The secret is sent to that shop only and is never included in the error text.
 */
export async function exchangeClientCredentials(
  domain: string,
  clientId: string,
  clientSecret: string
): Promise<ClientCredentialsToken> {
  if (!isValidShopDomain(domain)) {
    throw new Error(`Invalid shop domain: ${domain}`);
  }

  const res = await fetch(`https://${domain}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  const text = await res.text();
  let json: { access_token?: string; scope?: string } = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = {};
  }

  if (!res.ok || !json.access_token) {
    const detail = text ? text.slice(0, 400) : res.statusText;
    throw new Error(`Shopify token exchange failed (${res.status}): ${detail}`);
  }

  return { accessToken: json.access_token, scope: json.scope || '' };
}
