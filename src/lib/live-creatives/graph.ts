// Meta Graph calls for live creatives. The token is an Authorization header.
// It is never placed in the query string and never included in errors.

const GRAPH = 'https://graph.facebook.com/v21.0';

export function graphBase(): string {
  return GRAPH;
}

/** Drop access_token so a paging URL can be retried with the Authorization header. */
export function stripAccessToken(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.delete('access_token');
    return parsed.toString();
  } catch {
    return url.replace(/([?&])access_token=[^&]*&?/gi, '$1').replace(/[?&]$/, '');
  }
}

export function scrubSecret(message: string): string {
  return message
    .replace(/bearer\s+\S+/gi, 'Bearer (redacted)')
    .replace(/access_token=[^\s&]+/gi, 'access_token=(redacted)')
    .slice(0, 400);
}

export type GraphFetch = (url: string, init?: RequestInit) => Promise<Response>;

export async function metaGraphGet(
  url: string,
  token: string,
  fetchImpl: GraphFetch = fetch,
): Promise<any> {
  const clean = stripAccessToken(url);
  if (/access_token=/i.test(clean)) {
    throw new Error('Refusing to call Meta with access_token in the query string');
  }
  const res = await fetchImpl(clean, { headers: { Authorization: `Bearer ${token}` } });
  const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  if (!res.ok || json?.error) {
    const message = json?.error?.message || `Meta HTTP ${res.status}`;
    throw new Error(scrubSecret(message));
  }
  return json;
}

export function tokenDead(message: string): boolean {
  return /access token|oauth|session has expired|validating access token|error validating/i.test(message);
}

/** True while the run still has reserveMs left inside budgetMs. */
export function brandBudgetOpen(
  startedAt: number,
  now: number,
  budgetMs: number,
  reserveMs = 20_000,
): boolean {
  return now - startedAt < budgetMs - reserveMs;
}
