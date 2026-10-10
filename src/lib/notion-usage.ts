import { notionFailureFromResponse } from '@/lib/notion-error';
import {
  NOTION_VERSION,
  buildDueUpdate,
  clientsDataSourceId,
  type NotionPageRef,
  type NotionUsageClient,
  type UsageClient,
  type UsageTaskCreateBody,
} from '@/lib/usage-task';

const NOTION_API = 'https://api.notion.com/v1';

interface NotionFetch {
  (url: string, init: RequestInit): Promise<Response>;
}

function notionHeaders(apiKey: string): HeadersInit {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };
}

function titleOf(page: { properties?: { Name?: { title?: Array<{ plain_text?: string }> } } }): string {
  const parts = page.properties?.Name?.title || [];
  return parts.map((part) => part.plain_text || '').join('').trim();
}

function fail(res: Response, apiKey: string) {
  return notionFailureFromResponse(res, [apiKey]);
}

export function createNotionUsageClient(
  apiKey = process.env.NOTION_API_KEY,
  fetchImpl: NotionFetch = fetch
): NotionUsageClient | null {
  if (!apiKey) return null;
  const headers = notionHeaders(apiKey);

  return {
    async listClients(): Promise<UsageClient[]> {
      const clients: UsageClient[] = [];
      let cursor: string | undefined;
      const dataSourceId = clientsDataSourceId();
      do {
        const res = await fetchImpl(`${NOTION_API}/data_sources/${dataSourceId}/query`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ page_size: 100, start_cursor: cursor }),
        });
        if (!res.ok) throw await fail(res, apiKey);
        const body = (await res.json()) as {
          results?: Array<{ id: string; properties?: { Name?: { title?: Array<{ plain_text?: string }> } } }>;
          has_more?: boolean;
          next_cursor?: string | null;
        };
        for (const page of body.results || []) {
          const name = titleOf(page);
          if (name) clients.push({ id: page.id, name });
        }
        cursor = body.has_more && body.next_cursor ? body.next_cursor : undefined;
      } while (cursor);
      return clients;
    },

    async createTask(task: UsageTaskCreateBody): Promise<NotionPageRef> {
      const res = await fetchImpl(`${NOTION_API}/pages`, {
        method: 'POST',
        headers,
        body: JSON.stringify(task),
      });
      if (!res.ok) throw await fail(res, apiKey);
      const page = (await res.json()) as { id?: string; url?: string };
      if (!page.id) throw new Error('Notion did not return a page id');
      return {
        id: page.id,
        url: page.url || `https://www.notion.so/${page.id.replace(/-/g, '')}`,
      };
    },

    async updateDue(pageId: string, usageEndDate: string): Promise<void> {
      const res = await fetchImpl(`${NOTION_API}/pages/${pageId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(buildDueUpdate(usageEndDate)),
      });
      if (!res.ok) throw await fail(res, apiKey);
    },
  };
}
