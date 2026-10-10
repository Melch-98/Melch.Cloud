// Cron merge. manual_product_* is copied forward and never replaced by the URL mapping.

import type { ProductKind } from '@/lib/live-creatives/landing';
import type { LiveCreativeDraft } from '@/lib/live-creatives/assets';

export interface ExistingLiveCreative {
  first_seen: string | null;
  manual_product_key: string | null;
  manual_product_label: string | null;
  manual_product_kind: string | null;
}

export interface MergedLiveCreative extends Omit<LiveCreativeDraft, 'product_source'> {
  manual_product_key: string | null;
  manual_product_label: string | null;
  manual_product_kind: ProductKind | string | null;
  product_source: 'url' | 'manual';
  first_seen: string;
  last_active: string;
  updated_at: string;
}

export function mergeCronRow(
  existing: ExistingLiveCreative | null,
  incoming: LiveCreativeDraft,
  nowIso: string,
): MergedLiveCreative {
  const manualKey = existing?.manual_product_key?.trim() || null;
  return {
    ...incoming,
    manual_product_key: manualKey,
    manual_product_label: manualKey ? existing?.manual_product_label ?? null : null,
    manual_product_kind: manualKey ? existing?.manual_product_kind ?? null : null,
    product_source: manualKey ? 'manual' : 'url',
    first_seen: existing?.first_seen || nowIso,
    last_active: nowIso,
    updated_at: nowIso,
  };
}

export interface EffectiveProduct {
  product_key: string;
  product_label: string;
  product_kind: string;
  product_source: 'url' | 'manual';
}

/** The override wins. URL columns stay on the row so a cleared override still has a mapping. */
export function effectiveProduct(row: {
  product_key?: string | null;
  product_label?: string | null;
  product_kind?: string | null;
  manual_product_key?: string | null;
  manual_product_label?: string | null;
  manual_product_kind?: string | null;
  product_source?: string | null;
}): EffectiveProduct {
  const manualKey = row.manual_product_key?.trim() || '';
  if (manualKey) {
    return {
      product_key: manualKey,
      product_label: row.manual_product_label?.trim() || manualKey,
      product_kind: row.manual_product_kind || 'product',
      product_source: 'manual',
    };
  }
  return {
    product_key: row.product_key || 'none',
    product_label: row.product_label || 'No landing page',
    product_kind: row.product_kind || 'none',
    product_source: 'url',
  };
}
