import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

/**
 * Admin-only endpoint to set up brand configurations.
 * Supports:
 *   POST { action: 'rename', brandSlug, newName, newSlug }
 *   POST { action: 'set_google_ads', updates: [{ brandName, googleAdsCustomerId }] }
 *   POST { action: 'set_field', brandId, field, value }
 */
export async function POST(request: NextRequest) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

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

  if (!profile || profile.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden — admin only' }, { status: 403 });
  }

  const body = await request.json();
  const { action } = body;
  const results: any[] = [];

  if (action === 'rename') {
    const { brandSlug, newName, newSlug, websiteUrl, googleAdsCustomerId } = body;
    const update: Record<string, any> = { name: newName, slug: newSlug };
    if (websiteUrl !== undefined) update.website_url = websiteUrl;
    if (googleAdsCustomerId !== undefined) update.google_ads_customer_id = googleAdsCustomerId;

    const { data, error } = await supabase
      .from('brands')
      .update(update)
      .eq('slug', brandSlug)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    results.push({ action: 'rename', brand: data });
  }

  if (action === 'set_google_ads') {
    const { updates } = body; // [{ brandName, googleAdsCustomerId }]
    for (const u of updates) {
      const { data, error } = await supabase
        .from('brands')
        .update({ google_ads_customer_id: u.googleAdsCustomerId })
        .ilike('name', u.brandName)
        .select('id, name, google_ads_customer_id');

      results.push({
        brandName: u.brandName,
        updated: data,
        error: error?.message,
      });
    }
  }

  if (action === 'set_field') {
    const { brandId, field, value } = body;
    const allowedFields = [
      'google_ads_customer_id', 'meta_ad_account_id', 'website_url',
      'shopify_store_domain', 'shopify_client_id', 'shopify_client_secret',
      'shopify_gross_margin_pct',
    ];
    if (!allowedFields.includes(field)) {
      return NextResponse.json({ error: `Field ${field} not allowed` }, { status: 400 });
    }
    const { data, error } = await supabase
      .from('brands')
      .update({ [field]: value })
      .eq('id', brandId)
      .select();

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    results.push({ action: 'set_field', data });
  }

  if (action === 'set_fields') {
    const { brandName, fields } = body; // fields: { key: value }
    const allowedFields = [
      'google_ads_customer_id', 'meta_ad_account_id', 'website_url',
      'shopify_store_domain', 'shopify_client_id', 'shopify_client_secret',
      'shopify_gross_margin_pct', 'name', 'slug',
    ];
    const update: Record<string, any> = {};
    for (const [k, v] of Object.entries(fields)) {
      if (allowedFields.includes(k)) update[k] = v;
    }
    const { data, error } = await supabase
      .from('brands')
      .update(update)
      .ilike('name', brandName)
      .select();

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    results.push({ action: 'set_fields', data });
  }

  if (action === 'clear_other_spend') {
    const { brandId } = body;
    let query = supabase.from('daily_pnl').update({ other_spend: 0 }).gt('other_spend', 0);
    if (brandId) query = query.eq('brand_id', brandId);
    const { data: updated, error } = await query.select('id');
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    results.push({ action: 'clear_other_spend', rowsUpdated: updated?.length || 0 });
  }

  return NextResponse.json({ ok: true, results });
}
