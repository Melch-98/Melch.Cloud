import { createClient } from '@supabase/supabase-js';
import { accessTokenFromSupabaseCookies } from '@/lib/supabase-session-cookie';

export type AdminGate =
  | { ok: true; userId: string }
  | { ok: false; status: 401 | 403 | 500; error: string };

/**
 * Signed-in admin, from an Authorization bearer or the Supabase session cookie.
 * Dropbox consent is a top-level navigation, so the cookie is the normal path.
 */
export async function requireAdminActor(input: {
  authorization: string | null;
  cookies: { name: string; value: string }[];
}): Promise<AdminGate> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return { ok: false, status: 500, error: 'Server config error' };
  }

  const header = input.authorization?.trim() ?? '';
  let token: string | null = null;
  if (header) {
    if (!header.startsWith('Bearer ')) {
      return { ok: false, status: 401, error: 'Unauthorized' };
    }
    token = header.slice('Bearer '.length).trim();
  } else {
    token = accessTokenFromSupabaseCookies(input.cookies, supabaseUrl);
  }
  if (!token) return { ok: false, status: 401, error: 'Unauthorized' };

  const supabase = createClient(supabaseUrl, serviceKey);
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);
  if (error || !user) return { ok: false, status: 401, error: 'Unauthorized' };

  const { data: profile } = await supabase
    .from('users_profile')
    .select('role')
    .eq('id', user.id)
    .single();
  if (!profile || profile.role !== 'admin') {
    return { ok: false, status: 403, error: 'Forbidden — admin only' };
  }
  return { ok: true, userId: user.id };
}
