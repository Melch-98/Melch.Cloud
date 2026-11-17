import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BRAND_PUBLIC_COLUMNS } from './brand-public-columns';

const root = path.resolve(__dirname, '../..');
const forward = readFileSync(
  path.join(root, 'supabase/migrations/20261117_security_lockdown.sql'),
  'utf8'
);
const rollback = readFileSync(
  path.join(root, 'supabase/migrations/20261117_security_lockdown_rollback.sql'),
  'utf8'
);

function columns(sql: string, pattern: RegExp) {
  const match = sql.match(pattern);
  if (!match) return [];
  return match[1].split(',').map((column) => column.trim()).filter(Boolean);
}

describe('security lockdown SQL', () => {
  it('grants authenticated the same brand columns the browser selects, excluding Shopify secrets', () => {
    const granted = columns(
      forward,
      /GRANT SELECT \(\s*([\s\S]*?)\s*\) ON TABLE public\.brands TO authenticated/
    );
    expect(granted).toEqual(BRAND_PUBLIC_COLUMNS.split(', '));
    expect(granted).not.toContain('shopify_client_id');
    expect(granted).not.toContain('shopify_client_secret');
  });

  it('closes the audited holes and does not delete data', () => {
    expect(forward).toContain('DROP POLICY IF EXISTS "Anon read brands" ON public.brands');
    expect(forward).toContain('security_invoker = true');
    expect(forward).toContain('REVOKE ALL ON FUNCTION public.kick_pending_dropbox_syncs() FROM PUBLIC, anon, authenticated');
    expect(forward).toContain('GRANT EXECUTE ON FUNCTION public.kick_pending_dropbox_syncs() TO postgres');
    expect(forward).toContain('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM anon');
    expect(forward).toContain("bucket_id = 'creatives'");
    expect(forward).toContain('current_user_is_admin()');
    expect(forward.toLowerCase()).not.toContain('drop table');
    expect(forward.toLowerCase()).not.toContain('drop column');
    expect(forward.toLowerCase()).not.toContain('delete from');
    expect(forward.toLowerCase()).not.toContain('truncate table');
  });

  it('rollback restores the anon brand read and the old creatives policies', () => {
    expect(rollback).toContain('CREATE POLICY "Anon read brands"');
    expect(rollback).toContain('GRANT SELECT ON TABLE public.brands TO anon, authenticated');
    expect(rollback).toContain('CREATE POLICY auth_select ON storage.objects');
    expect(rollback).toContain('CREATE POLICY auth_delete ON storage.objects');
    expect(rollback).toContain('RESET (security_invoker)');
    expect(rollback).toContain('GRANT EXECUTE ON FUNCTION public.kick_pending_dropbox_syncs() TO PUBLIC, anon, authenticated');
    expect(rollback.toLowerCase()).not.toContain('drop table');
    expect(rollback.toLowerCase()).not.toContain('delete from');
  });
});
