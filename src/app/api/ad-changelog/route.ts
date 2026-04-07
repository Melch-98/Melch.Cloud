import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// ─── Types ──────────────────────────────────────────────────────
interface EntityState {
  platform: 'meta' | 'google';
  entity_type: 'campaign' | 'adset' | 'ad_group';
  entity_id: string;
  entity_name: string;
  status: string;
  daily_budget: number;
  lifetime_budget: number;
}

interface ChangeEntry {
  brand_id: string;
  platform: 'meta' | 'google';
  entity_type: 'campaign' | 'adset' | 'ad_group';
  entity_id: string;
  entity_name: string;
  change_type: 'status_change' | 'budget_change' | 'new_entity' | 'removed';
  old_value: string | null;
  new_value: string | null;
}

function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// ─── GET: Read changelog entries ────────────────────────────────
export async function GET(request: NextRequest) {
  const sb = supabase();

  // Auth
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authError } = await sb.auth.getUser(token);
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await sb
    .from('users_profile')
    .select('role, brand_id')
    .eq('id', user.id)
    .single();

  if (!profile || !['admin', 'founder'].includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const brandId = searchParams.get('brand_id');
  const limit = parseInt(searchParams.get('limit') || '100');

  if (!brandId) return NextResponse.json({ error: 'brand_id required' }, { status: 400 });

  // Founders locked to own brand
  if (profile.role === 'founder' && profile.brand_id !== brandId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data: entries, error: dbErr } = await sb
    .from('ad_changelog')
    .select('*')
    .eq('brand_id', brandId)
    .order('detected_at', { ascending: false })
    .limit(limit);

  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });
  return NextResponse.json({ entries: entries || [] });
}

// ─── POST: Run snapshot & diff ──────────────────────────────────
export async function POST(request: NextRequest) {
  const sb = supabase();

  // Auth
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authError } = await sb.auth.getUser(token);
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await sb
    .from('users_profile')
    .select('role, brand_id')
    .eq('id', user.id)
    .single();

  if (!profile || !['admin', 'founder'].includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json();
  const brandId = body.brand_id;
  if (!brandId) return NextResponse.json({ error: 'brand_id required' }, { status: 400 });

  if (profile.role === 'founder' && profile.brand_id !== brandId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Get brand config
  const { data: brand } = await sb.from('brands').select('*').eq('id', brandId).single();
  if (!brand) return NextResponse.json({ error: 'Brand not found' }, { status: 404 });

  // Get tokens
  let metaToken = process.env.META_ACCESS_TOKEN || '';
  if (!metaToken) {
    const { data: settings } = await sb
      .from('app_settings')
      .select('value')
      .eq('key', 'meta_access_token')
      .single();
    metaToken = settings?.value || '';
  }

  let windsorKey = process.env.WINDSOR_API_KEY || '';
  if (!windsorKey) {
    const { data: settings } = await sb
      .from('app_settings')
      .select('value')
      .eq('key', 'windsor_api_key')
      .single();
    windsorKey = settings?.value || '';
  }

  // ── Fetch current state from platforms ──
  const currentState: EntityState[] = [];
  const errors: string[] = [];

  // Meta campaigns
  if (brand.meta_ad_account_id && metaToken) {
    try {
      const url = `https://graph.facebook.com/v21.0/${brand.meta_ad_account_id}/campaigns?` +
        `fields=name,effective_status,daily_budget,lifetime_budget&limit=200` +
        `&access_token=${metaToken}`;
      const res = await fetch(url);
      const data = await res.json();

      if (data.data) {
        for (const c of data.data) {
          currentState.push({
            platform: 'meta',
            entity_type: 'campaign',
            entity_id: c.id,
            entity_name: c.name || '',
            status: c.effective_status || '',
            daily_budget: parseFloat(c.daily_budget || '0') / 100, // Meta returns cents
            lifetime_budget: parseFloat(c.lifetime_budget || '0') / 100,
          });
        }
      }
      if (data.error) errors.push(`Meta: ${data.error.message}`);

      // Also fetch adsets
      const adsetUrl = `https://graph.facebook.com/v21.0/${brand.meta_ad_account_id}/adsets?` +
        `fields=name,effective_status,daily_budget,lifetime_budget,campaign_id&limit=200` +
        `&access_token=${metaToken}`;
      const adsetRes = await fetch(adsetUrl);
      const adsetData = await adsetRes.json();

      if (adsetData.data) {
        for (const a of adsetData.data) {
          currentState.push({
            platform: 'meta',
            entity_type: 'adset',
            entity_id: a.id,
            entity_name: a.name || '',
            status: a.effective_status || '',
            daily_budget: parseFloat(a.daily_budget || '0') / 100,
            lifetime_budget: parseFloat(a.lifetime_budget || '0') / 100,
          });
        }
      }
    } catch (e: unknown) {
      errors.push(`Meta fetch error: ${e instanceof Error ? e.message : 'unknown'}`);
    }
  }

  // Google campaigns via Windsor
  if (brand.google_ads_customer_id && windsorKey) {
    try {
      const custId = brand.google_ads_customer_id.replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3');
      const url = new URL('https://connectors.windsor.ai/google_ads');
      url.searchParams.set('api_key', windsorKey);
      url.searchParams.set('date_preset', 'last_7d');
      url.searchParams.set('accounts', custId);
      url.searchParams.set('fields', 'campaign,campaign_id,campaign_status,campaign_type,spend');
      url.searchParams.set('_renderer', 'json');

      const res = await fetch(url.toString());
      const data = await res.json();
      const rows = Array.isArray(data) ? data : data?.data || [];

      // Deduplicate by campaign_id (Windsor returns per-day rows)
      const seen = new Map<string, { name: string; status: string }>();
      for (const row of rows) {
        const id = row.campaign_id?.toString();
        if (id && !seen.has(id)) {
          seen.set(id, {
            name: row.campaign || '',
            status: row.campaign_status || '',
          });
        }
      }

      for (const [id, info] of seen) {
        currentState.push({
          platform: 'google',
          entity_type: 'campaign',
          entity_id: id,
          entity_name: info.name,
          status: info.status,
          daily_budget: 0, // Windsor doesn't return budget; will detect status changes
          lifetime_budget: 0,
        });
      }
    } catch (e: unknown) {
      errors.push(`Google fetch error: ${e instanceof Error ? e.message : 'unknown'}`);
    }
  }

  // ── Load previous snapshot ──
  const { data: prevSnapshots } = await sb
    .from('ad_snapshots')
    .select('*')
    .eq('brand_id', brandId);

  const prevMap = new Map<string, typeof prevSnapshots extends (infer T)[] | null ? T : never>();
  for (const s of prevSnapshots || []) {
    prevMap.set(`${s.platform}:${s.entity_type}:${s.entity_id}`, s);
  }

  // ── Diff & generate changes ──
  const changes: ChangeEntry[] = [];
  const now = new Date().toISOString();

  for (const entity of currentState) {
    const key = `${entity.platform}:${entity.entity_type}:${entity.entity_id}`;
    const prev = prevMap.get(key);

    if (!prev) {
      // New entity
      changes.push({
        brand_id: brandId,
        platform: entity.platform,
        entity_type: entity.entity_type,
        entity_id: entity.entity_id,
        entity_name: entity.entity_name,
        change_type: 'new_entity',
        old_value: null,
        new_value: `${entity.status}`,
      });
    } else {
      // Check status change
      if (prev.status !== entity.status) {
        changes.push({
          brand_id: brandId,
          platform: entity.platform,
          entity_type: entity.entity_type,
          entity_id: entity.entity_id,
          entity_name: entity.entity_name,
          change_type: 'status_change',
          old_value: prev.status,
          new_value: entity.status,
        });
      }

      // Check budget change (Meta only, Google doesn't return budget via Windsor)
      if (entity.platform === 'meta') {
        const prevBudget = Number(prev.daily_budget || 0);
        const newBudget = entity.daily_budget;
        if (Math.abs(prevBudget - newBudget) > 0.01 && (prevBudget > 0 || newBudget > 0)) {
          changes.push({
            brand_id: brandId,
            platform: entity.platform,
            entity_type: entity.entity_type,
            entity_id: entity.entity_id,
            entity_name: entity.entity_name,
            change_type: 'budget_change',
            old_value: `$${prevBudget.toFixed(2)}/day`,
            new_value: `$${newBudget.toFixed(2)}/day`,
          });
        }
      }

      // Remove from prevMap so we can detect removed entities
      prevMap.delete(key);
    }
  }

  // Entities in prev but not in current = potentially removed
  // (Only flag if we actually got data from that platform)
  const metaFetched = currentState.some((e) => e.platform === 'meta');
  const googleFetched = currentState.some((e) => e.platform === 'google');
  for (const [, prev] of prevMap) {
    if ((prev.platform === 'meta' && !metaFetched) || (prev.platform === 'google' && !googleFetched)) continue;
    changes.push({
      brand_id: brandId,
      platform: prev.platform as 'meta' | 'google',
      entity_type: prev.entity_type as 'campaign' | 'adset' | 'ad_group',
      entity_id: prev.entity_id,
      entity_name: prev.entity_name,
      change_type: 'removed',
      old_value: prev.status,
      new_value: null,
    });
  }

  // ── Write changes to changelog ──
  if (changes.length > 0) {
    await sb.from('ad_changelog').insert(
      changes.map((c) => ({ ...c, detected_at: now }))
    );
  }

  // ── Upsert current snapshot ──
  if (currentState.length > 0) {
    const upsertRows = currentState.map((e) => ({
      brand_id: brandId,
      platform: e.platform,
      entity_type: e.entity_type,
      entity_id: e.entity_id,
      entity_name: e.entity_name,
      status: e.status,
      daily_budget: e.daily_budget,
      lifetime_budget: e.lifetime_budget,
      snapshot_at: now,
    }));

    await sb
      .from('ad_snapshots')
      .upsert(upsertRows, { onConflict: 'brand_id,platform,entity_type,entity_id' });
  }

  return NextResponse.json({
    success: true,
    changes_detected: changes.length,
    entities_scanned: currentState.length,
    errors: errors.length > 0 ? errors : undefined,
  });
}
