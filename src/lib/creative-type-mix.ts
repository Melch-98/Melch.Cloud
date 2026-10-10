/**
 * Creative Type Mix on /stats.
 * Groups submissions.creative_type the same way the page always has:
 * lowercase the stored value, blank becomes "other", label is capitalized.
 * Historical rows are not rewritten, so old slugs stay their own bars.
 */

export interface CreativeTypeMixRow {
  creative_type?: string | null;
}

export interface CreativeTypeMixBar {
  type: string;
  count: number;
  label: string;
  color: string;
}

const MIX_COLORS: Record<string, string> = {
  ugc: '#C8B89A',
  static: '#9AADCC',
  video: '#9AC8A7',
  other: '#6B6560',
};

export function creativeTypeMixLabel(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

export function creativeTypeMixColor(type: string): string {
  return MIX_COLORS[type] || '#C8B89A';
}

export function creativeTypeMix(rows: CreativeTypeMixRow[]): CreativeTypeMixBar[] {
  const typeCounts: Record<string, number> = {};
  for (const row of rows) {
    const type = (row.creative_type || 'other').toLowerCase();
    typeCounts[type] = (typeCounts[type] || 0) + 1;
  }
  return Object.entries(typeCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => ({
      type,
      count,
      label: creativeTypeMixLabel(type),
      color: creativeTypeMixColor(type),
    }));
}
