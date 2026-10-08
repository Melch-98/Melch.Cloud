import { CREATIVE_TYPES_MAP } from '@/lib/creative-types';

/** Column keys used by /analytics/creative-matrix (high-def is shortened to hd). */
export type MatrixPageColumn =
  | 'hd_static'
  | 'hd_video'
  | 'lofi_static'
  | 'lofi_video'
  | 'other_static'
  | 'other_video';

/** Column keys used by the upload-page coverage mini-matrix. */
export type MatrixSummaryColumn =
  | 'high_def_static'
  | 'high_def_video'
  | 'lofi_static'
  | 'lofi_video'
  | 'other_static'
  | 'other_video';

/**
 * Which Creative Matrix column a creative_type lands in.
 * The page groups by the type's fidelity and format from CREATIVE_TYPES_MAP,
 * not by a free-text label.
 */
export function matrixPageColumnKey(
  creativeType: string | null | undefined
): MatrixPageColumn | null {
  if (!creativeType) return null;
  const info = CREATIVE_TYPES_MAP.get(creativeType);
  if (!info) return null;
  const fidelity = info.fidelity === 'high_def' ? 'hd' : info.fidelity;
  return `${fidelity}_${info.format}` as MatrixPageColumn;
}

/** Same mapping, with the mini-matrix's high_def_ prefix. */
export function matrixSummaryColumnKey(
  creativeType: string | null | undefined
): MatrixSummaryColumn | null {
  if (!creativeType) return null;
  const info = CREATIVE_TYPES_MAP.get(creativeType);
  if (!info) return null;
  return `${info.fidelity}_${info.format}` as MatrixSummaryColumn;
}

export interface SummaryFileRow {
  product_name: string | null;
  creative_type: string | null;
  fidelity: string | null;
}

export interface SummaryAggregateRow {
  product_name: string;
  creative_type: string;
  fidelity: string;
  count: number;
}

/**
 * Groups tagged files the same way GET /api/creative-matrix-summary does:
 * product name + creative type + fidelity.
 */
export function aggregateSummaryRows(files: SummaryFileRow[]): SummaryAggregateRow[] {
  const counts: Record<string, number> = {};
  for (const row of files) {
    if (!row.creative_type) continue;
    const product = row.product_name || 'Unassigned';
    const fidelity = row.fidelity || 'other';
    const key = `${product}|||${row.creative_type}|||${fidelity}`;
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.entries(counts).map(([key, count]) => {
    const [product_name, creative_type, fidelity] = key.split('|||');
    return { product_name, creative_type, fidelity, count };
  });
}
