import { Inngest } from 'inngest';

/**
 * Inngest client for melch.cloud background jobs.
 *
 * Used for: Shopify webhooks, scheduled syncs, retryable side-effects,
 * and any work that shouldn't happen in a request-response cycle.
 *
 * Env vars (Vercel):
 *   INNGEST_EVENT_KEY    — sending events
 *   INNGEST_SIGNING_KEY  — verifying inbound function calls
 */
export const inngest = new Inngest({
  id: 'melch-cloud',
  name: 'Melch Cloud',
});

// Event type registry — extend as we add functions.
export type Events = {
  'test/hello': {
    data: {
      name: string;
    };
  };
  'shopify/order.created': {
    data: {
      shop_domain: string;
      order: Record<string, unknown>;
    };
  };
  'shopify/order.updated': {
    data: {
      shop_domain: string;
      order: Record<string, unknown>;
    };
  };
  'shopify/order.cancelled': {
    data: {
      shop_domain: string;
      order: Record<string, unknown>;
    };
  };
  'shopify/refund.created': {
    data: {
      shop_domain: string;
      refund: Record<string, unknown>;
    };
  };
  'shopify/app.uninstalled': {
    data: {
      shop_domain: string;
    };
  };
};
