import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

// GET: Check Meta token health and permissions
// Returns token validity, expiry, permissions, and connected ad accounts
export async function GET(request: NextRequest) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Verify auth (admin only)
  const authHeader = request.headers.get('authorization');
  if (!authHeader) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from('users_profile')
    .select('role')
    .eq('id', user.id)
    .single();

  if (!profile || profile.role !== 'admin') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  }

  // Get Meta access token
  let metaToken = process.env.META_ACCESS_TOKEN || '';
  if (!metaToken) {
    const { data: settings } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'meta_access_token')
      .single();
    metaToken = settings?.value || '';
  }

  if (!metaToken) {
    return NextResponse.json({
      status: 'error',
      message: 'No Meta access token configured',
      valid: false,
    });
  }

  const checks: Record<string, any> = {
    token_configured: true,
    valid: false,
    expires_at: null,
    days_remaining: null,
    permissions: [],
    ad_accounts: 0,
    errors: [],
  };

  // 1. Debug token to check validity and expiry
  try {
    const debugRes = await fetch(
      `https://graph.facebook.com/v21.0/debug_token?input_token=${metaToken}&access_token=${metaToken}`
    );
    if (debugRes.ok) {
      const debugData = await debugRes.json();
      const tokenData = debugData.data;

      checks.valid = tokenData?.is_valid || false;
      checks.app_id = tokenData?.app_id || null;
      checks.type = tokenData?.type || 'unknown';

      if (tokenData?.expires_at) {
        const expiresDate = new Date(tokenData.expires_at * 1000);
        checks.expires_at = expiresDate.toISOString();
        const daysRemaining = Math.floor((expiresDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
        checks.days_remaining = daysRemaining;

        if (daysRemaining <= 0) {
          checks.errors.push('Token has expired');
        } else if (daysRemaining <= 7) {
          checks.errors.push(`Token expires in ${daysRemaining} days — renew soon`);
        }
      } else if (tokenData?.expires_at === 0) {
        // Never expires (system user token)
        checks.expires_at = 'never';
        checks.days_remaining = Infinity;
      }

      if (tokenData?.scopes) {
        checks.permissions = tokenData.scopes;
      }
    } else {
      checks.errors.push('Failed to debug token — may be invalid');
    }
  } catch (e: any) {
    checks.errors.push(`Token debug failed: ${e.message}`);
  }

  // 2. Check ad account access
  try {
    const accountsRes = await fetch(
      `https://graph.facebook.com/v21.0/me/adaccounts?fields=id,name,account_status&limit=10&access_token=${metaToken}`
    );
    if (accountsRes.ok) {
      const accountsData = await accountsRes.json();
      checks.ad_accounts = accountsData.data?.length || 0;
    } else {
      const err = await accountsRes.json();
      if (err.error?.code === 190) {
        checks.valid = false;
        checks.errors.push('Token is invalid or expired (error 190)');
      } else {
        // System user might not support me/adaccounts — not necessarily an error
        checks.ad_accounts = -1; // unknown
      }
    }
  } catch { /* continue */ }

  // 3. Determine overall status
  let status: 'healthy' | 'warning' | 'critical' = 'healthy';
  if (!checks.valid) {
    status = 'critical';
  } else if (checks.errors.length > 0) {
    status = 'warning';
  } else if (checks.days_remaining !== null && checks.days_remaining !== Infinity && checks.days_remaining <= 14) {
    status = 'warning';
  }

  return NextResponse.json({
    status,
    ...checks,
    checked_at: new Date().toISOString(),
  });
}
