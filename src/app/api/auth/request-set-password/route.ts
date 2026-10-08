import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { recoveryLinkForExisting } from '@/lib/invite';
import { recentSelfServiceSend, sendInviteEmail } from '@/lib/invite-mail';

export const dynamic = 'force-dynamic';

const GENERIC = {
  ok: true,
  message: 'If that email has an account, a new set-password link is on the way.',
};

/**
 * Public. Someone with an expired invite can ask for a new link.
 * The response is the same whether or not the email exists.
 * Does not create accounts. One send per email every two minutes.
 */
export async function POST(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: 'Server config error' }, { status: 500 });

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const body = await request.json().catch(() => ({}));
  const email = String(body.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json(GENERIC);
  }

  if (await recentSelfServiceSend(supabase, email, 2 * 60 * 1000)) {
    return NextResponse.json(GENERIC);
  }

  const link = await recoveryLinkForExisting(supabase, email);
  if (!link?.actionLink) return NextResponse.json(GENERIC);

  const { data: profile } = await supabase
    .from('users_profile')
    .select('full_name, role, brand_id')
    .eq('id', link.userId)
    .maybeSingle();

  let brandName: string | undefined;
  if (profile?.brand_id) {
    const { data: brand } = await supabase.from('brands').select('name').eq('id', profile.brand_id).maybeSingle();
    brandName = brand?.name;
  }

  await sendInviteEmail(supabase, {
    to: email,
    name: profile?.full_name || email.split('@')[0],
    role: profile?.role || 'strategist',
    brandName,
    inviteLink: link.actionLink,
    userId: link.userId,
    brandId: profile?.brand_id || null,
    linkType: 'recovery',
    source: 'self-service',
  });

  return NextResponse.json(GENERIC);
}
