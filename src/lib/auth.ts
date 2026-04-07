// ─── Shared Auth Helper for API Routes ──────────────────────────
// Verifies JWT, fetches profile + permissions in one call.

import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export interface AuthResult {
  user_id: string;
  email: string;
  role: 'admin' | 'strategist' | 'founder';
  brand_id: string | null;
  permissions: {
    can_upload: boolean;
    can_view_pipeline: boolean;
    can_download: boolean;
    can_delete: boolean;
    is_active: boolean;
  };
}

/**
 * Authenticate an API request and return profile + permissions.
 * Returns null if auth fails (caller should return 401).
 */
export async function authenticateRequest(
  request: NextRequest
): Promise<{ auth: AuthResult | null; error?: string; status?: number }> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return { auth: null, error: 'Server config error', status: 500 };
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  // Try Authorization header first, then cookie-based session
  const authHeader = request.headers.get('authorization');
  let userId: string | null = null;
  let email = '';

  if (authHeader) {
    const token = authHeader.replace('Bearer ', '');
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(token);
    if (error || !user) {
      return { auth: null, error: 'Unauthorized', status: 401 };
    }
    userId = user.id;
    email = user.email || '';
  } else {
    // For cookie-based auth (browser requests), try to extract from sb-access-token cookie
    const accessToken =
      request.cookies.get('sb-access-token')?.value ||
      request.cookies.get(
        `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`
      )?.value;

    if (!accessToken) {
      return { auth: null, error: 'Unauthorized', status: 401 };
    }

    // Try parsing as JSON (Supabase stores tokens as JSON array sometimes)
    let token = accessToken;
    try {
      const parsed = JSON.parse(accessToken);
      if (Array.isArray(parsed) && parsed.length > 0) {
        token = parsed[0];
      }
    } catch {
      // Use as-is
    }

    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(token);
    if (error || !user) {
      return { auth: null, error: 'Unauthorized', status: 401 };
    }
    userId = user.id;
    email = user.email || '';
  }

  // Fetch profile
  const { data: profile } = await supabase
    .from('users_profile')
    .select('role, brand_id')
    .eq('id', userId)
    .single();

  if (!profile) {
    return { auth: null, error: 'Profile not found', status: 403 };
  }

  // Fetch permissions
  const { data: perms } = await supabase
    .from('user_permissions')
    .select('can_upload, can_view_pipeline, can_download, can_delete, is_active')
    .eq('user_id', userId)
    .single();

  // Admins get all permissions by default
  const isAdmin = profile.role === 'admin';
  const permissions = {
    can_upload: isAdmin || (perms?.can_upload ?? false),
    can_view_pipeline: isAdmin || (perms?.can_view_pipeline ?? false),
    can_download: isAdmin || (perms?.can_download ?? false),
    can_delete: isAdmin || (perms?.can_delete ?? false),
    is_active: isAdmin || (perms?.is_active ?? true),
  };

  return {
    auth: {
      user_id: userId,
      email,
      role: profile.role,
      brand_id: profile.brand_id,
      permissions,
    },
  };
}
