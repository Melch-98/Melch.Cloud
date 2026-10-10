/**
 * REST order and product fields the sync reads.
 * 2026-04 still returns the flat money strings and comma-separated product tags
 * from 2024-01. Money sets and a tag array are accepted so either shape parses.
 */

function asAmount(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Shop-currency amount. The flat REST field wins. `shop_money.amount` is used
 * only when that field is missing.
 */
export function readShopifyAmount(flat: unknown, set?: unknown): number | null {
  const direct = asAmount(flat);
  if (direct != null) return direct;
  if (!set || typeof set !== 'object') return null;
  const shop = (set as { shop_money?: { amount?: unknown } | null }).shop_money;
  return asAmount(shop?.amount);
}

/** `{ products: [...] }` from REST 2024-01 and 2026-04. Anything else is an empty page. */
export function shopifyProductsFromPayload(payload: unknown): Array<Record<string, unknown>> {
  if (!payload || typeof payload !== 'object') return [];
  const products = (payload as { products?: unknown }).products;
  if (!Array.isArray(products)) return [];
  return products.filter((product): product is Record<string, unknown> => !!product && typeof product === 'object');
}

/** REST product `tags` is a comma-space string. A string array is stored as given. */
export function shopifyProductTags(tags: unknown): string[] {
  if (typeof tags === 'string') return tags ? tags.split(', ') : [];
  if (!Array.isArray(tags)) return [];
  return tags.filter((tag): tag is string => typeof tag === 'string' && tag.length > 0);
}
