/**
 * daily_pnl upsert options.
 * defaultToNull: false keeps columns this payload does not own. An order
 * refresh that omits meta_spend/google_spend must not wipe spend already stored,
 * and a spend refresh that omits gross_sales must not wipe commerce totals.
 */
export const DAILY_PNL_UPSERT_OPTIONS = {
  onConflict: 'brand_id,date',
  defaultToNull: false,
} as const;

type SupabaseLike = { from: (table: string) => any };

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Attach spend only when that source returned a value for the day. */
export function spendFields(
  date: string,
  meta: Map<string, number>,
  google: Map<string, number>
): { meta_spend?: number; google_spend?: number } {
  return {
    ...(meta.has(date) ? { meta_spend: roundMoney(meta.get(date)!) } : {}),
    ...(google.has(date) ? { google_spend: roundMoney(google.get(date)!) } : {}),
  };
}

export async function upsertDailyPnl(
  supabase: SupabaseLike,
  rows: any[]
): Promise<{ error: { message?: string } | null }> {
  if (!rows.length) return { error: null };
  const first = await supabase.from('daily_pnl').upsert(rows, DAILY_PNL_UPSERT_OPTIONS);
  if (!first.error) return first;
  const msg = String(first.error.message || '');
  // If currency column missing (migration not applied), retry without it.
  if (/currency/i.test(msg) && (msg.includes('column') || msg.includes('schema'))) {
    const stripped = rows.map(({ currency: _currency, ...rest }) => rest);
    return await supabase.from('daily_pnl').upsert(stripped, DAILY_PNL_UPSERT_OPTIONS);
  }
  return first;
}
