import { createClient as createSupabaseClient } from '@supabase/supabase-js';

export function createServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * Generate a signed URL for a file in the 'creatives' bucket.
 * The URL is valid for `expiresIn` seconds (default 1 hour).
 */
export async function getSignedStorageUrl(
  bucketPath: string,
  expiresIn = 3600
): Promise<string> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.storage
    .from('creatives')
    .createSignedUrl(bucketPath, expiresIn);
  if (error || !data?.signedUrl) {
    throw new Error(
      `Failed to create signed URL for ${bucketPath}: ${error?.message || 'no URL returned'}`
    );
  }
  return data.signedUrl;
}
