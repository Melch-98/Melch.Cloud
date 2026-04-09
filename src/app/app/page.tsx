import { SHOPIFY_CONFIG } from '@/lib/shopify/config';
import EmbeddedBootstrap from './EmbeddedBootstrap';

export const dynamic = 'force-dynamic';

/**
 * Embedded app entry point.
 *
 * Shopify loads https://melch.cloud/app?shop=<store>&host=<base64>&embedded=1
 * inside an iframe in the Shopify admin. We render a minimal React shell that:
 *
 *   1. Loads App Bridge from Shopify's CDN
 *   2. Asks App Bridge for a session token (id_token JWT signed by Shopify)
 *   3. POSTs it to /api/shopify/token-exchange which swaps it for an
 *      expiring offline token via the token-exchange grant
 *   4. Redirects the merchant to the real Melch.Cloud dashboard
 *
 * This is the only path Shopify now allows for non-legacy apps to receive
 * an Admin API token.
 */
export default function EmbeddedAppEntry({
  searchParams,
}: {
  searchParams: { shop?: string; host?: string; embedded?: string };
}) {
  const shop = searchParams.shop ?? '';
  const host = searchParams.host ?? '';
  const apiKey = SHOPIFY_CONFIG.apiKey;

  return (
    <html>
      <head>
        <title>Melch.Cloud</title>
        <meta name="shopify-api-key" content={apiKey} />
        <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js" />
      </head>
      <body style={{ margin: 0, background: '#0a0a0a', color: '#C8B89A', fontFamily: 'system-ui, sans-serif' }}>
        <EmbeddedBootstrap shop={shop} host={host} />
      </body>
    </html>
  );
}
