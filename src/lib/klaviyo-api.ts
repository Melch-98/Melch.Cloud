// ─── Klaviyo API Helper ─────────────────────────────────────────
// Fetches sent & scheduled email/SMS campaigns from Klaviyo for
// a given brand's API key and date range.

const KLAVIYO_BASE = 'https://a.klaviyo.com/api';
const KLAVIYO_REVISION = '2024-10-15';

export interface KlaviyoCampaign {
  id: string;
  name: string;
  status: string;            // 'draft' | 'scheduled' | 'sent' | 'cancelled'
  channel: string;           // 'email' | 'sms'
  send_time: string | null;  // ISO datetime when sent / scheduled
  subject: string | null;
  brand_id: string;          // injected by our API route
  brand_name: string;        // injected by our API route
}

/**
 * Fetch all email campaigns from Klaviyo for a brand, filtered to
 * those with a send_time in the given year.
 */
export async function fetchKlaviyoCampaigns(
  apiKey: string,
  year: number,
  channel: 'email' | 'sms' = 'email',
): Promise<KlaviyoCampaign[]> {
  const campaigns: KlaviyoCampaign[] = [];
  const startDate = `${year}-01-01T00:00:00Z`;
  const endDate = `${year + 1}-01-01T00:00:00Z`;

  // Klaviyo requires a channel filter; we also filter by status (sent + scheduled)
  const filter = `equals(messages.channel,'${channel}')`;

  let url: string | null =
    `${KLAVIYO_BASE}/campaigns?filter=${encodeURIComponent(filter)}`;

  while (url) {
    const res: Response = await fetch(url, {
      headers: {
        Authorization: `Klaviyo-API-Key ${apiKey}`,
        revision: KLAVIYO_REVISION,
        accept: 'application/json',
      },
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`[Klaviyo] ${res.status}: ${text}`);
      break;
    }

    const json: any = await res.json();
    const items = json.data || [];

    for (const item of items) {
      const attrs = item.attributes || {};
      const status: string = attrs.status || '';
      const sendTime: string | null = attrs.send_time || attrs.scheduled_at || null;

      // Only include sent or scheduled campaigns (Klaviyo returns capitalized statuses)
      if (!['sent', 'scheduled'].includes(status.toLowerCase())) continue;

      // Date-range check (Klaviyo doesn't support date filters on campaigns,
      // so we filter client-side)
      if (sendTime) {
        if (sendTime < startDate || sendTime >= endDate) continue;
      } else {
        continue; // skip campaigns without a send time
      }

      campaigns.push({
        id: item.id,
        name: attrs.name || 'Untitled',
        status,
        channel,
        send_time: sendTime,
        subject: attrs.subject || null,
        brand_id: '',   // filled by the API route
        brand_name: '',
      });
    }

    // Pagination — cap at 5 pages (500 campaigns) to avoid excessive API calls
    const nextUrl: string | null = json.links?.next || null;
    url = nextUrl;
    // Safety cap
    if (campaigns.length > 400) break;
  }

  return campaigns;
}
