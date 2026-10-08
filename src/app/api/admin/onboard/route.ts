import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ensureDropboxFolder } from '@/lib/dropbox';
import { ensureUserWithInviteLink } from '@/lib/invite';
import { sendInviteEmail } from '@/lib/invite-mail';
import { invitePermissionError } from '@/lib/invite-status';
import {
  EXISTING_ACCOUNT_MESSAGE,
  existingAccountBlock,
  exposeActionLink,
  findAccountByEmail,
  mustSendWelcomeEmail,
  onboardActionBlock,
} from '@/lib/invite-access';
import { rolePermissionDefaults } from '@/lib/role-defaults';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/onboard
 *
 * Multi-action endpoint for the onboarding wizard.
 * Actions: create_brand, set_integrations, set_dropbox, create_users,
 *          archive_brand, restore_brand
 */
export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: 'Server config error' }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Verify admin auth
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('users_profile')
    .select('role, brand_id')
    .eq('id', user.id)
    .single();

  if (!profile || !['admin', 'founder'].includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden — admin or founder only' }, { status: 403 });
  }

  const body = await request.json();
  const { action } = body;

  /* ---------------------------------------------------------------- */
  /*  Create brand                                                     */
  /* ---------------------------------------------------------------- */
  if (action === 'create_brand') {
    const blocked = onboardActionBlock(profile, action, null);
    if (blocked) return NextResponse.json({ error: blocked }, { status: 403 });

    const { name, slug, website_url, gross_margin_pct } = body;
    if (!name?.trim()) {
      return NextResponse.json({ error: 'Brand name is required' }, { status: 400 });
    }

    // Check for duplicate slug
    const { data: existing } = await supabase
      .from('brands')
      .select('id')
      .eq('slug', slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-'))
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ error: 'A brand with this slug already exists' }, { status: 409 });
    }

    const { data: brand, error: insertError } = await supabase
      .from('brands')
      .insert({
        name: name.trim(),
        slug: slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        website_url: website_url || null,
        gross_margin_pct: gross_margin_pct || 62,
      })
      .select()
      .single();

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true, brand });
  }

  /* ---------------------------------------------------------------- */
  /*  Set integrations                                                 */
  /* ---------------------------------------------------------------- */
  if (action === 'set_integrations') {
    const { brand_id, meta_ad_account_id, google_ads_customer_id, shopify_store_domain } = body;
    if (!brand_id) return NextResponse.json({ error: 'brand_id required' }, { status: 400 });
    const blocked = onboardActionBlock(profile, action, brand_id);
    if (blocked) return NextResponse.json({ error: blocked }, { status: 403 });

    const update: Record<string, any> = {};
    if (meta_ad_account_id !== undefined) update.meta_ad_account_id = meta_ad_account_id;
    if (google_ads_customer_id !== undefined) {
      // Strip dashes from Google Ads ID
      update.google_ads_customer_id = google_ads_customer_id?.replace(/-/g, '') || null;
    }
    if (shopify_store_domain !== undefined) update.shopify_store_domain = shopify_store_domain;

    const { error } = await supabase
      .from('brands')
      .update(update)
      .eq('id', brand_id);

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  /* ---------------------------------------------------------------- */
  /*  Set Dropbox folder                                               */
  /* ---------------------------------------------------------------- */
  if (action === 'set_dropbox') {
    const { brand_id, dropbox_folder_path } = body;
    if (!brand_id) return NextResponse.json({ error: 'brand_id required' }, { status: 400 });
    const blocked = onboardActionBlock(profile, action, brand_id);
    if (blocked) return NextResponse.json({ error: blocked }, { status: 403 });

    const folderPath = dropbox_folder_path || null;

    const { error } = await supabase
      .from('brands')
      .update({ dropbox_folder_path: folderPath })
      .eq('id', brand_id);

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    // Best-effort: create the folder in Dropbox now
    if (folderPath) {
      try {
        await ensureDropboxFolder(folderPath);
      } catch (e: any) {
        // Non-fatal — folder will be created on first upload
        console.warn('Dropbox folder creation (non-fatal):', e.message);
      }
    }

    return NextResponse.json({ ok: true });
  }

  /* ---------------------------------------------------------------- */
  /*  Create users                                                     */
  /* ---------------------------------------------------------------- */
  if (action === 'create_users') {
    const { brand_id, users, sendWelcomeEmail } = body;
    if (!brand_id) return NextResponse.json({ error: 'brand_id required' }, { status: 400 });
    if (!Array.isArray(users) || users.length === 0) {
      return NextResponse.json({ error: 'users array required' }, { status: 400 });
    }

    const denied = invitePermissionError(
      { role: profile.role, brandId: profile.brand_id },
      brand_id
    );
    if (denied) return NextResponse.json({ error: denied }, { status: 403 });

    const shouldEmail = mustSendWelcomeEmail(profile.role, sendWelcomeEmail);
    if (profile.role !== 'admin') {
      for (const u of users) {
        const email = String(u.email || '').trim().toLowerCase();
        if (!email) continue;
        try {
          const found = await findAccountByEmail(supabase, email);
          const blocked = existingAccountBlock(profile.role, found);
          if (blocked) return NextResponse.json({ error: blocked }, { status: 409 });
        } catch (e: any) {
          return NextResponse.json(
            { error: e?.message || 'Could not check that email' },
            { status: 500 }
          );
        }
      }
    }

    let brandName: string | undefined;
    {
      const { data: brand } = await supabase
        .from('brands')
        .select('name')
        .eq('id', brand_id)
        .single();
      brandName = brand?.name;
    }

    const results: any[] = [];
    for (const u of users) {
      const email = String(u.email || '').trim().toLowerCase();
      if (!email) continue;
      const role = u.role || 'strategist';
      const full_name = (u.full_name || email.split('@')[0]).trim();

      try {
        if (role === 'admin' && profile.role !== 'admin') {
          results.push({ email, error: 'Only an admin can invite another admin' });
          continue;
        }

        const invited = await ensureUserWithInviteLink(supabase, email, {
          fullName: full_name,
        });

        if (profile.role !== 'admin' && invited.isExisting) {
          return NextResponse.json({ error: EXISTING_ACCOUNT_MESSAGE }, { status: 409 });
        }

        const profileRow = {
          id: invited.userId,
          email,
          full_name,
          role,
          brand_id,
        };
        const profileResult =
          profile.role === 'admin'
            ? await supabase.from('users_profile').upsert(profileRow, { onConflict: 'id' })
            : await supabase.from('users_profile').insert(profileRow);
        if (profileResult.error) {
          results.push({ email, error: `Profile creation failed: ${profileResult.error.message}` });
          continue;
        }

        const perms = rolePermissionDefaults(role);
        const permsRow = { user_id: invited.userId, ...perms };
        const permsResult =
          profile.role === 'admin'
            ? await supabase.from('user_permissions').upsert(permsRow, { onConflict: 'user_id' })
            : await supabase.from('user_permissions').insert(permsRow);
        if (permsResult.error) {
          console.error('Permissions upsert failed (non-fatal):', permsResult.error.message);
        }

        if (!shouldEmail) {
          results.push({
            email,
            userId: invited.userId,
            ok: true,
            isExisting: invited.isExisting,
            delivery: {
              delivered: false,
              message: 'Welcome email was not requested',
              showCopyLink: true,
              resendMessageId: null,
            },
            welcomeEmail: null,
            actionLink: exposeActionLink(profile.role, invited.actionLink, true),
            linkType: invited.linkType,
          });
          continue;
        }

        const sent = await sendInviteEmail(supabase, {
          to: email,
          name: full_name,
          role,
          brandName,
          inviteLink: invited.actionLink,
          invitedBy: user.email || undefined,
          userId: invited.userId,
          brandId: brand_id,
          invitedById: user.id,
          linkType: invited.linkType,
          source: 'onboard',
        });

        results.push({
          email,
          userId: invited.userId,
          ok: true,
          isExisting: invited.isExisting,
          delivery: sent.delivery,
          logError: sent.logError,
          welcomeEmail: {
            sent: sent.delivery.delivered,
            error: sent.delivery.delivered ? undefined : sent.delivery.message,
            id: sent.delivery.resendMessageId,
          },
          actionLink: exposeActionLink(profile.role, invited.actionLink, sent.delivery.showCopyLink),
          linkType: invited.linkType,
          linkError: invited.linkError,
        });
      } catch (e: any) {
        results.push({ email, error: e?.message || 'Invite failed' });
      }
    }

    return NextResponse.json({ ok: true, results });
  }

  /* ---------------------------------------------------------------- */
  /*  Archive brand                                                    */
  /* ---------------------------------------------------------------- */
  if (action === 'archive_brand') {
    const { brand_id } = body;
    if (!brand_id) return NextResponse.json({ error: 'brand_id required' }, { status: 400 });
    const blocked = onboardActionBlock(profile, action, brand_id);
    if (blocked) return NextResponse.json({ error: blocked }, { status: 403 });

    // Set archived_at
    const { error } = await supabase
      .from('brands')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', brand_id);

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    // Deactivate all users for this brand
    const { data: brandUsers } = await supabase
      .from('users_profile')
      .select('id')
      .eq('brand_id', brand_id);

    if (brandUsers && brandUsers.length > 0) {
      const userIds = brandUsers.map((u: any) => u.id);
      await supabase
        .from('user_permissions')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .in('user_id', userIds);
    }

    return NextResponse.json({ ok: true, archived: brand_id });
  }

  /* ---------------------------------------------------------------- */
  /*  Restore brand                                                    */
  /* ---------------------------------------------------------------- */
  if (action === 'restore_brand') {
    const { brand_id } = body;
    if (!brand_id) return NextResponse.json({ error: 'brand_id required' }, { status: 400 });
    const blocked = onboardActionBlock(profile, action, brand_id);
    if (blocked) return NextResponse.json({ error: blocked }, { status: 403 });

    const { error } = await supabase
      .from('brands')
      .update({ archived_at: null })
      .eq('id', brand_id);

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    // Reactivate all users for this brand
    const { data: brandUsers } = await supabase
      .from('users_profile')
      .select('id')
      .eq('brand_id', brand_id);

    if (brandUsers && brandUsers.length > 0) {
      const userIds = brandUsers.map((u: any) => u.id);
      await supabase
        .from('user_permissions')
        .update({ is_active: true, updated_at: new Date().toISOString() })
        .in('user_id', userIds);
    }

    return NextResponse.json({ ok: true, restored: brand_id });
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
}
