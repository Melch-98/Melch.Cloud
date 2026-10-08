/**
 * Read a set-password URL. Supabase can land here three ways:
 * our own token_hash link, a PKCE code, or an implicit hash session.
 */

export type SetPasswordOtpType = 'signup' | 'invite' | 'magiclink' | 'recovery' | 'email';

export type SetPasswordToken =
  | { status: 'otp'; tokenHash: string; otpType: SetPasswordOtpType }
  | { status: 'code'; code: string }
  | { status: 'implicit'; accessToken: string; refreshToken: string }
  | { status: 'error'; message: string }
  | { status: 'missing' };

const OTP_TYPES = new Set<SetPasswordOtpType>(['signup', 'invite', 'magiclink', 'recovery', 'email']);

function paramsFrom(raw: string): URLSearchParams {
  const trimmed = raw.startsWith('?') || raw.startsWith('#') ? raw.slice(1) : raw;
  return new URLSearchParams(trimmed);
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return value.replace(/\+/g, ' ');
  }
}

function errorMessage(code: string | null, description: string | null): string | null {
  if (!code && !description) return null;
  const decoded = safeDecode(description || code || 'invalid');
  if (code === 'otp_expired' || /expir/i.test(decoded)) {
    return 'This link has expired. Request a new one below.';
  }
  return `This link is not valid. ${decoded}`;
}

export function parseSetPasswordLocation(search: string, hash: string): SetPasswordToken {
  const query = paramsFrom(search || '');
  const fragment = paramsFrom(hash || '');

  const expired = errorMessage(
    query.get('error_code') || fragment.get('error_code') || query.get('error') || fragment.get('error'),
    query.get('error_description') || fragment.get('error_description')
  );
  if (expired) return { status: 'error', message: expired };

  const tokenHash = query.get('token_hash') || fragment.get('token_hash');
  if (tokenHash?.trim()) {
    const otpType = (query.get('type') || fragment.get('type') || '').toLowerCase();
    if (!OTP_TYPES.has(otpType as SetPasswordOtpType)) {
      return { status: 'error', message: 'This link is not valid. It is missing a token type.' };
    }
    return { status: 'otp', tokenHash: tokenHash.trim(), otpType: otpType as SetPasswordOtpType };
  }

  const code = query.get('code')?.trim();
  if (code) return { status: 'code', code };

  const accessToken = fragment.get('access_token')?.trim();
  const refreshToken = fragment.get('refresh_token')?.trim();
  if (accessToken && refreshToken) {
    return { status: 'implicit', accessToken, refreshToken };
  }

  return { status: 'missing' };
}
