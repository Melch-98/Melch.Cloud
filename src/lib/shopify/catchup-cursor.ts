type SupabaseLike = { from: (table: string) => any };

/** Remembers where a chunked catch-up stopped so the next run does not repeat it. */
export async function loadCatchUpCursors(
  supabase: SupabaseLike,
  prefix: string
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const { data, error } = await supabase
    .from('app_settings')
    .select('key, value')
    .like('key', `${prefix}%`);
  if (error || !data) return map;
  for (const row of data as Array<{ key?: string; value?: string }>) {
    if (!row.key?.startsWith(prefix) || !row.value) continue;
    map.set(row.key.slice(prefix.length), row.value);
  }
  return map;
}

export async function saveCatchUpCursor(
  supabase: SupabaseLike,
  prefix: string,
  id: string,
  value: string
): Promise<void> {
  const { error } = await supabase.from('app_settings').upsert(
    {
      key: `${prefix}${id}`,
      value,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'key' }
  );
  if (error) console.error(`Failed to save catch-up cursor ${prefix}${id}: ${error.message}`);
}

export async function clearCatchUpCursor(
  supabase: SupabaseLike,
  prefix: string,
  id: string
): Promise<void> {
  const { error } = await supabase.from('app_settings').delete().eq('key', `${prefix}${id}`);
  if (error) console.error(`Failed to clear catch-up cursor ${prefix}${id}: ${error.message}`);
}
