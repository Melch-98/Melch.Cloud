const SCOPE_PATTERNS = [
  /(?:for|missing(?: the)?|requires(?: merchant approval for)?)\s+[`']?([a-z][a-z0-9_]*)[`']?\s+scope/gi,
  /[`']([a-z][a-z0-9_]*)[`']\s+access scope/gi,
  /required access:\s*[`']?([a-z][a-z0-9_]*)[`']?/gi,
];

/**
 * Pulls Shopify access-scope names out of a REST or GraphQL error body.
 * Only snake_case tokens are kept, so prose like "for this topic" is ignored.
 */
export function missingScopesFromShopifyBody(body: unknown): string[] {
  const text = typeof body === 'string' ? body : JSON.stringify(body ?? '');
  const found = new Set<string>();
  for (const pattern of SCOPE_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const scope = match[1];
      if (scope && scope.includes('_')) found.add(scope);
    }
  }
  const scopes: string[] = [];
  found.forEach((scope) => scopes.push(scope));
  return scopes;
}

export function scopeErrorMessage(scopes: string[], shopifyStatus: number, body: unknown): string {
  const detail = typeof body === 'string' ? body : JSON.stringify(body ?? '');
  const clipped = detail.length > 400 ? `${detail.slice(0, 400)}…` : detail;
  if (scopes.length === 1) {
    return `Shopify refused to manage webhooks because the access token is missing the ${scopes[0]} scope. Shopify response (${shopifyStatus}): ${clipped}`;
  }
  if (scopes.length > 1) {
    return `Shopify refused to manage webhooks because the access token is missing the ${scopes.join(' and ')} scopes. Shopify response (${shopifyStatus}): ${clipped}`;
  }
  return `Shopify refused to manage webhooks (${shopifyStatus}) and did not name a scope. Response: ${clipped}`;
}
