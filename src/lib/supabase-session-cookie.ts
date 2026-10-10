/**
 * Read the access token from the Supabase SSR auth cookie.
 * Browser sessions use `sb-<project-ref>-auth-token`, base64url-encoded,
 * and split into `.0`, `.1`, … when the value is long.
 */

const BASE64_PREFIX = 'base64-';

export function supabaseProjectRef(supabaseUrl: string): string | null {
  try {
    const ref = new URL(supabaseUrl).hostname.split('.')[0];
    return ref || null;
  } catch {
    return null;
  }
}

function combineCookie(cookies: { name: string; value: string }[], key: string): string | null {
  const direct = cookies.find((cookie) => cookie.name === key)?.value;
  if (direct) return direct;

  const chunks: string[] = [];
  for (let i = 0; ; i += 1) {
    const chunk = cookies.find((cookie) => cookie.name === `${key}.${i}`)?.value;
    if (!chunk) break;
    chunks.push(chunk);
  }
  return chunks.length > 0 ? chunks.join('') : null;
}

function tokenFromStoredValue(stored: string): string | null {
  const trimmed = stored.trim();
  if (!trimmed) return null;

  let decoded = trimmed;
  if (decoded.startsWith(BASE64_PREFIX)) {
    try {
      decoded = Buffer.from(decoded.slice(BASE64_PREFIX.length), 'base64url').toString('utf8');
    } catch {
      return null;
    }
  }

  try {
    const parsed = JSON.parse(decoded) as unknown;
    if (typeof parsed === 'string') return tokenFromStoredValue(parsed);
    if (Array.isArray(parsed) && typeof parsed[0] === 'string' && parsed[0]) return parsed[0];
    if (
      parsed &&
      typeof parsed === 'object' &&
      'access_token' in parsed &&
      typeof (parsed as { access_token?: unknown }).access_token === 'string'
    ) {
      const accessToken = (parsed as { access_token: string }).access_token;
      return accessToken || null;
    }
    return null;
  } catch {
    return decoded.split('.').length === 3 ? decoded : null;
  }
}

/**
 * Access token for `auth.getUser`. Null when the cookie is missing or not a session.
 */
export function accessTokenFromSupabaseCookies(
  cookies: { name: string; value: string }[],
  supabaseUrl: string
): string | null {
  const ref = supabaseProjectRef(supabaseUrl);
  const names = ref ? [`sb-${ref}-auth-token`, 'sb-access-token'] : ['sb-access-token'];
  for (const name of names) {
    const stored = combineCookie(cookies, name);
    if (!stored) continue;
    const token = tokenFromStoredValue(stored);
    if (token) return token;
  }
  return null;
}
