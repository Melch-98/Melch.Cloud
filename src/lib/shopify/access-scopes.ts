import { isValidShopDomain } from './config.ts';

const READ_ALL_ORDERS = 'read_all_orders';

export function scopeStringHas(scope: string, handle: string): boolean {
  return scope
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .includes(handle);
}

export function hasReadAllOrdersScope(scope: string): boolean {
  return scopeStringHas(scope, READ_ALL_ORDERS);
}

/** Handles from `GET /admin/oauth/access_scopes.json`. */
export function handlesFromAccessScopes(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object') return [];
  const rows = (payload as { access_scopes?: unknown }).access_scopes;
  if (!Array.isArray(rows)) return [];
  const handles: string[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const handle = (row as { handle?: unknown }).handle;
    if (typeof handle === 'string' && handle.trim()) handles.push(handle.trim());
  }
  return handles;
}

/**
 * Scope handles granted to this Admin token.
 * The token is sent as a header and is never included in the error text.
 */
export async function fetchGrantedScopeHandles(domain: string, token: string): Promise<string[]> {
  if (!isValidShopDomain(domain)) {
    throw new Error(`Invalid shop domain: ${domain}`);
  }
  const res = await fetch(`https://${domain}/admin/oauth/access_scopes.json`, {
    headers: {
      'X-Shopify-Access-Token': token,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    throw new Error(`Shopify access scopes failed (${res.status})`);
  }
  const text = await res.text();
  let json: unknown = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new Error('Shopify access scopes response was not JSON');
  }
  return handlesFromAccessScopes(json);
}

/** One log line of scope handles. The access token is not written. */
export async function logGrantedScopeHandles(
  brandName: string,
  domain: string,
  token: string
): Promise<void> {
  try {
    const handles = await fetchGrantedScopeHandles(domain, token);
    console.log(
      `Shopify granted scopes for ${brandName} (${domain}): ${handles.length ? handles.join(',') : '(none)'}`
    );
  } catch (err) {
    let message = err instanceof Error ? err.message : 'Shopify access scopes failed';
    if (token) message = message.split(token).join('[redacted]');
    console.warn(`Shopify granted scopes lookup failed for ${brandName} (${domain}): ${message}`);
  }
}
