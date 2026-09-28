import { exchangeClientCredentials } from './client-credentials';
import { normalizeShopDomain } from './config';
import { registerBrandOrderWebhooks } from './brand-webhooks';
import { saveWebhookStatus, statusFromRegistration } from './webhook-status';
import { interpretWebhookEnsure } from './webhook-ensure';

type SupabaseLike = { from: (table: string) => any };

type BrandRow = {
  id: string;
  name: string;
  shopify_store_domain: string | null;
  shopify_client_id: string | null;
  shopify_client_secret: string | null;
};

export type WebhookEnsureResult = {
  brand_id: string;
  name: string;
  shop_domain: string | null;
  ok: boolean;
  missing_scope: string | null;
  error: string | null;
};

/**
 * Idempotently registers order webhooks for every active brand that has its
 * own Shopify custom-app credentials. already_registered is success.
 * A missing scope is logged and stored for the Team chip, then the loop continues.
 */
export async function ensureCustomAppOrderWebhooks(
  supabase: SupabaseLike
): Promise<WebhookEnsureResult[]> {
  const { data, error } = await supabase
    .from('brands')
    .select('id, name, shopify_store_domain, shopify_client_id, shopify_client_secret')
    .is('archived_at', null);
  if (error) throw new Error(error.message);

  const results: WebhookEnsureResult[] = [];
  for (const brand of (data || []) as BrandRow[]) {
    if (!brand.shopify_client_id || !brand.shopify_client_secret) continue;
    const domain = normalizeShopDomain(brand.shopify_store_domain);
    if (!domain) {
      const message = `${brand.name} has custom-app credentials but no *.myshopify.com domain`;
      console.error(message);
      results.push({
        brand_id: brand.id,
        name: brand.name,
        shop_domain: null,
        ok: false,
        missing_scope: null,
        error: message,
      });
      continue;
    }

    try {
      const token = await exchangeClientCredentials(
        domain,
        brand.shopify_client_id,
        brand.shopify_client_secret
      );
      const registered = await registerBrandOrderWebhooks(domain, token.accessToken, token.scope || null);
      const missingScope = registered.scopeError?.scopes[0] ?? null;
      const outcome = interpretWebhookEnsure(registered.topics, missingScope);
      await saveWebhookStatus(
        supabase,
        brand.id,
        statusFromRegistration(domain, registered.topics, missingScope)
      );
      if (missingScope) {
        console.error(
          `Shopify webhook missing scope for ${brand.name} (${domain}): ${registered.scopeError?.message || missingScope}`
        );
      } else if (!outcome.ok) {
        const detail = registered.topics
          .filter((topic) => topic.status === 'error')
          .map((topic) => `${topic.topic}: ${topic.error || topic.status}`)
          .join('; ');
        console.error(`Shopify webhook ensure failed for ${brand.name} (${domain}): ${detail || 'incomplete'}`);
      } else {
        console.log(
          `Shopify order webhooks ensured for ${brand.name} (${domain}): ${registered.topics
            .map((topic) => `${topic.topic}=${topic.status}`)
            .join(', ')}`
        );
      }
      results.push({
        brand_id: brand.id,
        name: brand.name,
        shop_domain: domain,
        ok: outcome.ok,
        missing_scope: missingScope,
        error: outcome.ok ? null : registered.scopeError?.message || 'Order webhooks were not fully registered',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Webhook ensure failed';
      console.error(`Shopify webhook ensure failed for ${brand.name} (${domain}): ${message}`);
      results.push({
        brand_id: brand.id,
        name: brand.name,
        shop_domain: domain,
        ok: false,
        missing_scope: null,
        error: message,
      });
    }
  }
  return results;
}
