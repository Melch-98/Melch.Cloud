import crypto from 'crypto';
import { NextResponse } from 'next/server';

type AuthClient = {
  auth: {
    getUser: (token: string) => PromiseLike<{
      data: { user: { id: string } | null };
      error: unknown;
    }>;
  };
  // The route passes a service-role Supabase client. The profile read is the only query.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
};

export function authorizationMatchesSecret(header: string | null, secret: string | undefined): boolean {
  if (!header || !secret) return false;
  const expected = `Bearer ${secret}`;
  const actualBuf = Buffer.from(header);
  const expectedBuf = Buffer.from(expected);
  if (actualBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(actualBuf, expectedBuf);
}

/**
 * Cron and admins may sync any brand. A founder may sync only their own brand.
 * A missing target is allowed for cron and admin; the sync itself rejects it.
 */
export function mayTriggerBrandSync(args: {
  via: 'cron' | 'session';
  role: string | null;
  ownBrandId: string | null;
  targetBrandId: string | null;
}): boolean {
  if (args.via === 'cron') return true;
  if (args.role === 'admin') return true;
  return (
    args.role === 'founder' &&
    !!args.ownBrandId &&
    !!args.targetBrandId &&
    args.ownBrandId === args.targetBrandId
  );
}

export function brandIdFromBody(body: Record<string, unknown>, key: 'brand_id' | 'brandId'): string | null {
  const value = body[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export async function readJsonObject(
  request: Request
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; response: NextResponse }> {
  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, response: NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) };
    }
    return { ok: true, body: parsed as Record<string, unknown> };
  } catch {
    return { ok: false, response: NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) };
  }
}

/**
 * Auth for a manual brand sync. Returns the JSON body when the caller may run it.
 * `brandKey` is `brand_id` on Shopify and `brandId` on Triple Whale.
 */
export async function authorizeBrandSync(
  request: Request,
  supabase: AuthClient,
  brandKey: 'brand_id' | 'brandId'
): Promise<{ error: NextResponse } | { body: Record<string, unknown> }> {
  const header = request.headers.get('authorization');
  if (authorizationMatchesSecret(header, process.env.CRON_SECRET)) {
    const parsed = await readJsonObject(request);
    if (!parsed.ok) return { error: parsed.response };
    return { body: parsed.body };
  }

  if (!header) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  const token = header.replace('Bearer ', '');
  if (!token || token === header) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const { data: profile } = await supabase
    .from('users_profile')
    .select('role, brand_id')
    .eq('id', user.id)
    .single();
  if (!profile || (profile.role !== 'admin' && profile.role !== 'founder')) {
    return { error: NextResponse.json({ error: 'Forbidden — admin/founder only' }, { status: 403 }) };
  }

  const parsed = await readJsonObject(request);
  if (!parsed.ok) return { error: parsed.response };

  const allowed = mayTriggerBrandSync({
    via: 'session',
    role: profile.role ?? null,
    ownBrandId: profile.brand_id ?? null,
    targetBrandId: brandIdFromBody(parsed.body, brandKey),
  });
  if (!allowed) {
    return {
      error: NextResponse.json(
        { error: 'Forbidden — founders can only sync their own brand' },
        { status: 403 }
      ),
    };
  }
  return { body: parsed.body };
}
