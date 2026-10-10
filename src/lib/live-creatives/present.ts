// How Top Creatives joins ad insights to live_creatives.
// Spend / ROAS / CPA use the same sums as the page summary:
// ROAS = purchase value / spend, CPA = spend / purchases.

export const UNTAGGED_KEY = 'untagged';
export const UNTAGGED_LABEL = 'Not tagged';

export interface CardProduct {
  product_key: string;
  product_label: string;
  product_kind: string;
}

export interface LiveCreativeView {
  ad_id: string;
  asset_key: string;
  format?: string | null;
  product_key: string;
  product_label: string;
  product_kind: string;
  product_source: 'url' | 'manual';
  card_products?: CardProduct[] | null;
}

export interface AdSpend {
  ad_id: string;
  spend: number;
  purchase_value: number;
  purchases: number;
}

export interface ProductGroup {
  product_key: string;
  product_label: string;
  product_kind: string;
  creatives: number;
  spend: number;
  purchase_value: number;
  purchases: number;
  roas: number;
  cpa: number;
}

export interface ProductFilterOption {
  product_key: string;
  product_label: string;
  product_kind: string;
  count: number;
}

const KIND_ORDER = ['product', 'homepage', 'shop_all', 'collection', 'other', 'none'];

function moneySplit(total: number, parts: number, index: number): number {
  if (parts <= 1) return total;
  const base = Math.round((total / parts) * 100) / 100;
  if (index < parts - 1) return base;
  return Math.round((total - base * (parts - 1)) * 100) / 100;
}

export function adProductKeys(rows: LiveCreativeView[]): string[] {
  if (!rows.length) return [UNTAGGED_KEY];
  const keys = new Set<string>();
  for (const row of rows) {
    if (row.product_key) keys.add(row.product_key);
    for (const card of row.card_products || []) {
      if (card.product_key) keys.add(card.product_key);
    }
  }
  return Array.from(keys);
}

export function adMatchesProduct(rows: LiveCreativeView[], selected: string[]): boolean {
  if (!selected.length) return true;
  const keys = new Set(adProductKeys(rows));
  return selected.some((key) => keys.has(key));
}

export function chipForAd(rows: LiveCreativeView[]): { label: string; title: string; source: 'url' | 'manual' | null } {
  if (!rows.length) return { label: UNTAGGED_LABEL, title: 'No live creative row yet', source: null };
  const labels = new Set<string>();
  for (const row of rows) {
    if (row.product_label) labels.add(row.product_label);
    for (const card of row.card_products || []) {
      if (card.product_label) labels.add(card.product_label);
    }
  }
  const primary = rows[0].product_label || 'No landing page';
  const extra = Math.max(0, labels.size - 1);
  const listed = Array.from(labels);
  return {
    label: extra > 0 ? `${primary} +${extra}` : primary,
    title: listed.join(', '),
    source: rows.some((row) => row.product_source === 'manual') ? 'manual' : 'url',
  };
}

export function productFilterOptions(ads: AdSpend[], rowsByAd: Map<string, LiveCreativeView[]>): ProductFilterOption[] {
  const options = new Map<string, ProductFilterOption>();
  const bump = (key: string, label: string, kind: string) => {
    const current = options.get(key);
    if (current) {
      current.count += 1;
      return;
    }
    options.set(key, { product_key: key, product_label: label, product_kind: kind, count: 1 });
  };
  for (const ad of ads) {
    const rows = rowsByAd.get(ad.ad_id) || [];
    if (!rows.length) {
      bump(UNTAGGED_KEY, UNTAGGED_LABEL, 'none');
      continue;
    }
    const seen = new Set<string>();
    for (const row of rows) {
      if (seen.has(row.product_key)) continue;
      seen.add(row.product_key);
      bump(row.product_key, row.product_label, row.product_kind);
    }
    for (const row of rows) {
      for (const card of row.card_products || []) {
        if (!card.product_key || seen.has(card.product_key)) continue;
        seen.add(card.product_key);
        bump(card.product_key, card.product_label, card.product_kind);
      }
    }
  }
  return Array.from(options.values()).sort((a, b) => {
    const ai = KIND_ORDER.indexOf(a.product_kind);
    const bi = KIND_ORDER.indexOf(b.product_kind);
    const ao = ai === -1 ? 99 : ai;
    const bo = bi === -1 ? 99 : bi;
    if (a.product_key === UNTAGGED_KEY) return 1;
    if (b.product_key === UNTAGGED_KEY) return -1;
    if (ao !== bo) return ao - bo;
    return a.product_label.localeCompare(b.product_label);
  });
}

/**
 * One bucket per effective product. Flexible ads split spend evenly across
 * asset rows so a product total still adds up to the ads on screen.
 * Carousel spend stays on the first card. ROAS and CPA are recomputed
 * from the sums, the same way the Top Creatives summary does.
 */
export function groupAdsByProduct(ads: AdSpend[], rowsByAd: Map<string, LiveCreativeView[]>): ProductGroup[] {
  const groups = new Map<string, ProductGroup>();
  const ensure = (key: string, label: string, kind: string) => {
    const current = groups.get(key);
    if (current) return current;
    const created: ProductGroup = {
      product_key: key,
      product_label: label,
      product_kind: kind,
      creatives: 0,
      spend: 0,
      purchase_value: 0,
      purchases: 0,
      roas: 0,
      cpa: 0,
    };
    groups.set(key, created);
    return created;
  };

  for (const ad of ads) {
    const rows = rowsByAd.get(ad.ad_id) || [];
    if (!rows.length) {
      const group = ensure(UNTAGGED_KEY, UNTAGGED_LABEL, 'none');
      group.creatives += 1;
      group.spend += ad.spend;
      group.purchase_value += ad.purchase_value;
      group.purchases += ad.purchases;
      continue;
    }
    rows.forEach((row, index) => {
      const group = ensure(row.product_key, row.product_label, row.product_kind);
      group.creatives += 1;
      group.spend += moneySplit(ad.spend, rows.length, index);
      group.purchase_value += moneySplit(ad.purchase_value, rows.length, index);
      group.purchases += moneySplit(ad.purchases, rows.length, index);
    });
  }

  const list = Array.from(groups.values());
  for (const group of list) {
    group.spend = Math.round(group.spend * 100) / 100;
    group.purchase_value = Math.round(group.purchase_value * 100) / 100;
    group.purchases = Math.round(group.purchases * 100) / 100;
    group.roas = group.spend > 0 ? group.purchase_value / group.spend : 0;
    group.cpa = group.purchases > 0 ? group.spend / group.purchases : 0;
  }
  list.sort((a, b) => b.spend - a.spend || a.product_label.localeCompare(b.product_label));
  return list;
}

export interface OverrideChoice {
  product_key: string;
  product_label: string;
  product_kind: 'product' | 'homepage' | 'shop_all' | 'none';
}

export function overrideChoices(products: Array<{ handle?: string | null; title?: string | null }>): OverrideChoice[] {
  const choices: OverrideChoice[] = [];
  const seen = new Set<string>();
  for (const product of products) {
    const handle = (product.handle || '').trim().toLowerCase();
    if (!handle || seen.has(handle)) continue;
    seen.add(handle);
    choices.push({
      product_key: `product:${handle}`,
      product_label: (product.title || '').trim() || handle.replace(/[-_]+/g, ' '),
      product_kind: 'product',
    });
  }
  choices.sort((a, b) => a.product_label.localeCompare(b.product_label));
  choices.push(
    { product_key: 'homepage', product_label: 'Homepage', product_kind: 'homepage' },
    { product_key: 'shop_all', product_label: 'Shop All', product_kind: 'shop_all' },
    { product_key: 'none', product_label: 'No landing page', product_kind: 'none' },
  );
  return choices;
}
