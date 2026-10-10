// Cron upsert omits manual_product_* and product_source. PostgREST then
// leaves those columns alone, including an override saved after this read.
// New rows stay NULL. The read path uses effectiveProduct().

import type { LiveCreativeDraft } from '@/lib/live-creatives/assets';

export const CRON_OMITTED_COLUMNS = [
  'manual_product_key',
  'manual_product_label',
  'manual_product_kind',
  'product_source',
] as const;

const OMITTED = new Set<string>(CRON_OMITTED_COLUMNS);

export interface ExistingLiveCreative {
  first_seen: string | null;
}

export type CronUpsertRow = Omit<LiveCreativeDraft, 'product_source'> & {
  first_seen: string;
  last_active: string;
  updated_at: string;
};

/** Drop override columns so an upsert cannot clobber them. */
export function omitCronProtected(row: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (OMITTED.has(key)) continue;
    next[key] = value;
  }
  return next;
}

export function mergeCronRow(
  existing: ExistingLiveCreative | null,
  incoming: LiveCreativeDraft,
  nowIso: string,
): CronUpsertRow {
  return {
    ...omitCronProtected(incoming as unknown as Record<string, unknown>),
    first_seen: existing?.first_seen || nowIso,
    last_active: nowIso,
    updated_at: nowIso,
  } as CronUpsertRow;
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
