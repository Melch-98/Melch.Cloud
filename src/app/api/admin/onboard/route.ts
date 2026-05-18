import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ensureDropboxFolder } from '@/lib/dropbox';

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

  const supabase = createClient(supabaseUrl, serviceKey);

  // Verify admin auth
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('users_profile')
    .select('role')
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
    const { name, slug, website_url, shopify_gross_margin_pct } = body;
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
        shopify_gross_margin_pct: shopify_gross_margin_pct || 62,
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
    const { brand_id, users } = body;
    if (!brand_id) return NextResponse.json({ error: 'brand_id required' }, { status: 400 });
    if (!Array.isArray(users) || users.length === 0) {
      return NextResponse.json({ error: 'users array required' }, { status: 400 });
    }

    const results: any[] = [];
    for (const u of users) {
      const { email, full_name, role } = u;
      if (!email) continue;

      // Generate a temp password
      const tempPassword = `Melch-${Math.random().toString(36).slice(2, 10)}!`;

      // Create auth user
      let userId: string;
      const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
        email,
        password: tempPassword,
        email_confirm: true,
      });

      if (createError) {
        if (
          createError.message?.includes('already been registered') ||
          createError.message?.includes('already exists')
        ) {
          // Find existing user
          const { data: listData } = await supabase.auth.admin.listUsers({ perPage: 1000 });
          const existing = listData?.users.find(
            (x) => x.email?.toLowerCase() === email.toLowerCase()
          );
          if (!existing) {
            results.push({ email, error: 'User exists but could not be found' });
            continue;
          }
          userId = existing.id;
        } else {
          results.push({ email, error: createError.message });
          continue;
        }
      } else {
        userId = newUser.user.id;
      }

      // Upsert profile
      await supabase.from('users_profile').upsert(
        {
          id: userId,
          email,
          full_name: full_name || email.split('@')[0],
          role: role || 'strategist',
          brand_id,
        },
        { onConflict: 'id' }
      );

      // Upsert permissions
      const isFounder = role === 'founder';
      await supabase.from('user_permissions').upsert(
        {
          user_id: userId,
          can_upload: true,
          can_view_pipeline: isFounder,
          can_download: isFounder,
          can_delete: false,
          is_active: true,
        },
        { onConflict: 'user_id' }
      );

      results.push({ email, userId, ok: true, tempPassword });
    }

    return NextResponse.json({ ok: true, results });
  }

  /* ---------------------------------------------------------------- */
  /*  Archive brand                                                    */
  /* ---------------------------------------------------------------- */
  if (action === 'archive_brand') {
    const { brand_id } = body;
    if (!brand_id) return NextResponse.json({ error: 'brand_id required' }, { status: 400 });

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
