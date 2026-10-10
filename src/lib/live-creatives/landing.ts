// Landing URL → product. Pure. No network, no AI.
// The cron and the override clear-path both call this.

export type ProductKind =
  | 'product'
  | 'homepage'
  | 'collection'
  | 'shop_all'
  | 'other'
  | 'lead_form'
  | 'messages'
  | 'call'
  | 'ig_profile'
  | 'meta_shop'
  | 'app'
  | 'catalog'
  | 'none';

export interface CatalogProduct {
  handle: string;
  title: string;
}

export interface CollectionTitle {
  handle: string;
  title: string;
}

export interface MappedProduct {
  product_key: string;
  product_label: string;
  product_kind: ProductKind;
  landing_url: string | null;
  landing_url_normalized: string | null;
}

export interface NormalizedLanding {
  landing_url: string;
  landing_url_normalized: string;
  host: string | null;
  path: string;
  sameDomain: boolean;
}

const NONE_LABEL = 'No landing page';

const SHOP_ALL_PATHS = new Set([
  '/collections/all',
  '/collections/shop-all',
  '/collections/all-products',
  '/collections/shop',
  '/shop',
  '/shop-all',
]);

const PRODUCT_PATH = /^(?:\/collections\/[^/]+)?\/products\/([^/]+)$/;
const COLLECTION_PATH = /^\/collections\/([^/]+)$/;

/** Storefront language prefixes. Region tags (en-ca, en-us) use the language half. */
const LANG = new Set([
  'en', 'fr', 'de', 'es', 'it', 'nl', 'pt', 'ja', 'ko', 'zh', 'sv', 'da', 'fi', 'nb', 'no',
  'pl', 'cs', 'hu', 'ro', 'tr', 'ar', 'he', 'th', 'vi', 'id', 'ms', 'ru', 'uk', 'el', 'bg',
  'hr', 'sk', 'sl', 'et', 'lv', 'lt', 'hi',
]);

export function labelFromHandle(handle: string): string {
  const decoded = safeDecode(handle).replace(/[-_]+/g, ' ').trim();
  if (!decoded) return handle;
  return decoded.replace(/\S+/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}

export function hostnameOf(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  const withProto = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const host = new URL(withProto).hostname.replace(/\.$/, '');
    return host || null;
  } catch {
    return null;
  }
}

function bareHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, '');
}

export function hostAllowed(host: string, allowed: string[]): boolean {
  const target = bareHost(host);
  return allowed.some((item) => item && bareHost(item) === target);
}

function parseShopInfo(shopInfo: unknown): Record<string, unknown> | null {
  if (!shopInfo) return null;
  if (typeof shopInfo === 'string') {
    try {
      const parsed = JSON.parse(shopInfo) as unknown;
      return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
    } catch {
      return null;
    }
  }
  if (typeof shopInfo === 'object') return shopInfo as Record<string, unknown>;
  return null;
}

/**
 * Hosts the brand actually owns: website_url, shopify_store_domain,
 * shopify_stores.shop_domain, and shop.json domain / myshopify_domain.
 */
export function hostsFromBrandConfig(input: {
  websiteUrl?: string | null;
  shopifyStoreDomain?: string | null;
  shopDomains?: Array<string | null | undefined>;
  shopInfo?: unknown;
}): string[] {
  const hosts = new Set<string>();
  const add = (value: string | null | undefined) => {
    const host = hostnameOf(value);
    if (host) hosts.add(host);
  };
  add(input.websiteUrl);
  add(input.shopifyStoreDomain);
  for (const domain of input.shopDomains || []) add(domain ?? null);
  const info = parseShopInfo(input.shopInfo);
  if (info) {
    for (const key of ['domain', 'myshopify_domain', 'primary_domain'] as const) {
      const value = info[key];
      if (typeof value === 'string') add(value);
    }
  }
  return Array.from(hosts);
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function stripTrailingSlash(path: string): string {
  if (path.length > 1 && path.endsWith('/')) return path.replace(/\/+$/, '') || '/';
  return path || '/';
}

function stripLocales(path: string): string {
  let current = path;
  for (let i = 0; i < 2; i += 1) {
    const match = /^\/([a-z]{2}(?:-[a-z]{2})?)(?=\/|$)/.exec(current);
    if (!match) break;
    const segment = match[1];
    const lang = segment.slice(0, 2);
    if (!LANG.has(lang)) break;
    const rest = current.slice(match[0].length);
    current = rest ? (rest.startsWith('/') ? rest : `/${rest}`) : '/';
  }
  return current || '/';
}

function looksDynamic(path: string): boolean {
  const decoded = safeDecode(path).toLowerCase();
  return decoded.includes('{{') || decoded.includes('}}');
}

/** Strip query, fragment, trailing slash, and a leading locale. Lowercase. */
export function normalizeLanding(raw: string, hosts: string[]): NormalizedLanding | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let host: string | null = null;
  let path = '/';
  let relative = false;

  if (trimmed.startsWith('/')) {
    relative = true;
    path = trimmed.split(/[?#]/)[0] || '/';
  } else {
    const withProto = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    let url: URL;
    try {
      url = new URL(withProto);
    } catch {
      return null;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    host = url.hostname.toLowerCase();
    path = url.pathname || '/';
  }

  path = stripTrailingSlash(stripLocales(path.toLowerCase()));
  const sameDomain = relative || (host != null && hostAllowed(host, hosts));
  const landing_url_normalized = host ? `https://${host}${path === '/' ? '' : path}` : path;

  return {
    landing_url: trimmed,
    landing_url_normalized,
    host,
    path,
    sameDomain,
  };
}

function mapped(
  kind: ProductKind,
  key: string,
  label: string,
  norm: NormalizedLanding | null,
): MappedProduct {
  return {
    product_key: key,
    product_label: label,
    product_kind: kind,
    landing_url: norm?.landing_url ?? null,
    landing_url_normalized: norm?.landing_url_normalized ?? null,
  };
}

export function mapNormalized(
  norm: NormalizedLanding | null,
  products: CatalogProduct[],
  collections: CollectionTitle[] = [],
): MappedProduct {
  if (!norm || !norm.sameDomain || looksDynamic(norm.path)) {
    return mapped('none', 'none', NONE_LABEL, norm);
  }

  const path = norm.path;
  if (path === '/') return mapped('homepage', 'homepage', 'Homepage', norm);
  if (SHOP_ALL_PATHS.has(path)) return mapped('shop_all', 'shop_all', 'Shop All', norm);

  const productMatch = PRODUCT_PATH.exec(path);
  if (productMatch) {
    const handle = safeDecode(productMatch[1]).toLowerCase();
    const found = products.find((product) => product.handle.toLowerCase() === handle);
    return mapped('product', `product:${handle}`, found?.title || labelFromHandle(handle), norm);
  }

  const collectionMatch = COLLECTION_PATH.exec(path);
  if (collectionMatch) {
    const handle = safeDecode(collectionMatch[1]).toLowerCase();
    const found = collections.find((collection) => collection.handle.toLowerCase() === handle);
    const name = found?.title || labelFromHandle(handle);
    return mapped('collection', `collection:${handle}`, `Collection: ${name}`, norm);
  }

  return mapped('other', `other:${path}`, `Other: ${path}`, norm);
}

/**
 * A /products/<handle> URL is this brand's product when that handle is in its
 * Shopify catalog, including when the host is another site the brand sells on.
 * Same-domain URLs, including unknown handles, stay on mapNormalized.
 */
function catalogProductOnOtherHost(
  norm: NormalizedLanding | null,
  products: CatalogProduct[],
): MappedProduct | null {
  if (!norm || norm.sameDomain || looksDynamic(norm.path)) return null;
  const match = PRODUCT_PATH.exec(norm.path);
  if (!match) return null;
  const handle = safeDecode(match[1]).toLowerCase();
  const found = products.find((product) => product.handle.toLowerCase() === handle);
  if (!found) return null;
  return mapped('product', `product:${handle}`, found.title || labelFromHandle(handle), norm);
}

export function mapLandingUrl(
  raw: string | null | undefined,
  hosts: string[],
  products: CatalogProduct[],
  collections: CollectionTitle[] = [],
): MappedProduct {
  if (!raw || !raw.trim()) return mapped('none', 'none', NONE_LABEL, null);
  const norm = normalizeLanding(raw, hosts);
  return catalogProductOnOtherHost(norm, products) || mapNormalized(norm, products, collections);
}

export const PRODUCT_KINDS: ProductKind[] = [
  'product', 'homepage', 'collection', 'shop_all', 'other',
  'lead_form', 'messages', 'call', 'ig_profile', 'meta_shop', 'app', 'catalog',
  'none',
];

export function isProductKind(value: unknown): value is ProductKind {
  return typeof value === 'string' && (PRODUCT_KINDS as string[]).includes(value);
}
