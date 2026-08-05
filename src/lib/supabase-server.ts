import { createClient as createSupabaseClient } from '@supabase/supabase-js';

export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    // Returns null during build/prerender to prevent crashing when env vars are missing.
    return null as any;
  }

  return createSupabaseClient(url, key);
}

/**
 * Generate a signed URL for a file in the 'creatives' bucket.
 * The URL is valid for `expiresIn` seconds (default 1 hour).
 */
export async function getSignedStorageUrl(
  bucketPath: string,
  expiresIn = 3600,
) {
  const supabase = createServiceClient();
  if (!supabase) {
    return '/api/placeholder'; // Fallback for build-time
  }

  const { data, error } = await supabase.storage
    .from('creatives')
    .createSignedUrl(bucketPath, expiresIn);
    
  if (error || !data?.signedUrl) {
    return '';
  }
  return data.signedUrl;
}
