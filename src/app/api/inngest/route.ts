import { serve } from 'inngest/next';
import { inngest } from '@/lib/inngest/client';
import { functions } from '@/lib/inngest/functions';

/**
 * Inngest endpoint.
 *
 * Inngest hits this URL to:
 *   - Discover registered functions (PUT)
 *   - Invoke functions when their trigger events fire (POST)
 *   - Health-check (GET)
 *
 * Public URL: https://melch.cloud/api/inngest
 */
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions,
});
