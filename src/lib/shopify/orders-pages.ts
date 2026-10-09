/** Pagination for Shopify Admin order lists. A failed later page must not look like an empty day. */

export const ORDERS_PAGE_MAX_TRIES = 3;
export const ORDERS_PAGE_RETRY_FALLBACK_MS = 2_000;

export type OrdersPageResult = {
  ok: boolean;
  status: number;
  retryAfter: string | null;
  link: string | null;
  body: unknown;
};

export function nextLinkFromHeader(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
  return nextMatch ? nextMatch[1] : null;
}

/** Retry-After is delta-seconds or an HTTP date. Anything else waits 2 seconds. */
export function retryAfterDelayMs(header: string | null, nowMs: number = Date.now()): number {
  if (!header || !header.trim()) return ORDERS_PAGE_RETRY_FALLBACK_MS;
  const trimmed = header.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const ms = Number(trimmed) * 1000;
    return Number.isFinite(ms) && ms >= 0 ? ms : ORDERS_PAGE_RETRY_FALLBACK_MS;
  }
  const when = Date.parse(trimmed);
  if (!Number.isFinite(when)) return ORDERS_PAGE_RETRY_FALLBACK_MS;
  return Math.max(0, when - nowMs);
}

export function ordersFromPayload(data: unknown): unknown[] {
  if (!data || typeof data !== 'object' || !Array.isArray((data as { orders?: unknown }).orders)) {
    throw new Error('Shopify orders page missing orders');
  }
  return (data as { orders: unknown[] }).orders;
}

/**
 * One orders page. 429 is retried with Retry-After, up to 3 tries.
 * Any other non-OK status throws immediately. The throw message is
 * `Shopify orders page ${status}` so the sync catch writes no daily_pnl rows.
 */
export async function nextOrdersPage(
  url: string,
  fetchPage: (url: string) => Promise<OrdersPageResult>,
  sleep: (ms: number) => Promise<void>
): Promise<{ orders: unknown[]; nextUrl: string | null }> {
  for (let attempt = 1; attempt <= ORDERS_PAGE_MAX_TRIES; attempt += 1) {
    const res = await fetchPage(url);
    if (res.ok) {
      return {
        orders: ordersFromPayload(res.body),
        nextUrl: nextLinkFromHeader(res.link),
      };
    }
    if (res.status === 429 && attempt < ORDERS_PAGE_MAX_TRIES) {
      await sleep(retryAfterDelayMs(res.retryAfter));
      continue;
    }
    throw new Error(`Shopify orders page ${res.status}`);
  }
  throw new Error('Shopify orders page 429');
}

/**
 * Page 1 is already in hand. Later pages are appended only when every page
 * succeeds. A throw discards the partial list so the caller builds no rows.
 */
export async function collectPagedOrders<T>(
  firstOrders: T[],
  firstNextUrl: string | null,
  fetchPage: (url: string) => Promise<OrdersPageResult>,
  sleep: (ms: number) => Promise<void>,
  pauseMs = 0
): Promise<T[]> {
  const orders = firstOrders.slice();
  let nextUrl = firstNextUrl;
  while (nextUrl) {
    const page = await nextOrdersPage(nextUrl, fetchPage, sleep);
    orders.push(...(page.orders as T[]));
    nextUrl = page.nextUrl;
    if (nextUrl && pauseMs > 0) await sleep(pauseMs);
  }
  return orders;
}
