import crypto from 'crypto';

/** Consent window. Dropbox sends the browser back in the same hop. */
export const DROPBOX_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

const PURPOSE = 'dropbox-oauth';

type StatePayload = {
  purpose: typeof PURPOSE;
  uid: string;
  nonce: string;
  exp: number;
};

export type DropboxOAuthState =
  | { ok: true; userId: string }
  | { ok: false; reason: 'missing' | 'malformed' | 'bad_signature' | 'expired' | 'unsigned' };

function signingSecret(): string | null {
  const secret = process.env.DROPBOX_APP_SECRET;
  return secret ? secret : null;
}

function signBody(body: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('base64url');
}

function signaturesMatch(actual: string, expected: string): boolean {
  const actualBuf = Buffer.from(actual);
  const expectedBuf = Buffer.from(expected);
  if (actualBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(actualBuf, expectedBuf);
}

/**
 * HMAC state bound to the admin who started consent.
 * The callback accepts it only for that same signed-in admin.
 */
export function signDropboxOAuthState(userId: string, now = Date.now()): string | null {
  const secret = signingSecret();
  if (!secret || !userId) return null;
  const payload: StatePayload = {
    purpose: PURPOSE,
    uid: userId,
    nonce: crypto.randomBytes(16).toString('hex'),
    exp: now + DROPBOX_OAUTH_STATE_TTL_MS,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${signBody(body, secret)}`;
}

export function verifyDropboxOAuthState(state: string | null, now = Date.now()): DropboxOAuthState {
  const secret = signingSecret();
  if (!secret) return { ok: false, reason: 'unsigned' };
  if (!state) return { ok: false, reason: 'missing' };

  const dot = state.indexOf('.');
  if (dot <= 0 || dot >= state.length - 1) return { ok: false, reason: 'malformed' };
  const body = state.slice(0, dot);
  const signature = state.slice(dot + 1);
  if (!signaturesMatch(signature, signBody(body, secret))) {
    return { ok: false, reason: 'bad_signature' };
  }

  let payload: StatePayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as StatePayload;
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (
    payload?.purpose !== PURPOSE ||
    typeof payload.uid !== 'string' ||
    !payload.uid ||
    typeof payload.nonce !== 'string' ||
    !payload.nonce ||
    typeof payload.exp !== 'number' ||
    !Number.isFinite(payload.exp)
  ) {
    return { ok: false, reason: 'malformed' };
  }
  if (payload.exp <= now) return { ok: false, reason: 'expired' };
  return { ok: true, userId: payload.uid };
}
