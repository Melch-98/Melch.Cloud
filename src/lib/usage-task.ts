/**
 * Agency Tasks page for a batch that has a usage end date.
 * Notion is called only from the server. A missing key or a Notion error
 * does not throw, so the upload that already saved can still succeed.
 */

export const DEFAULT_TASKS_DATA_SOURCE_ID = '55b17106-6328-4afd-a945-fb10314a9bb5';
export const DEFAULT_CLIENTS_DATA_SOURCE_ID = 'ec00e9d0-4d83-4c56-911c-602ead732456';
export const NOTION_VERSION = '2025-09-03';

export interface UsageClient {
  id: string;
  name: string;
}

export interface UsageSubmissionRow {
  id: string;
  brandName: string;
  batchName: string;
  fileCount: number;
  uploader: string;
  creatorName: string | null;
  creatorHandle: string | null;
  isWhitelist: boolean;
  usageEndDate: string | null;
  notionPageId: string | null;
}

export interface NotionPageRef {
  id: string;
  url: string;
}

export interface NotionUsageClient {
  listClients(): Promise<UsageClient[]>;
  createTask(body: UsageTaskCreateBody): Promise<NotionPageRef>;
  updateDue(pageId: string, usageEndDate: string): Promise<void>;
}

export interface UsageTaskCreateBody {
  parent: { type: 'data_source_id'; data_source_id: string };
  properties: Record<string, unknown>;
}

export type UsageTaskStep = 'client_lookup' | 'page_create' | 'submissions_update' | 'due_update';

export interface UsageTaskFailure {
  submissionId: string;
  step: UsageTaskStep;
  status: number | null;
  code: string | null;
  message: string;
}

export class NotionRequestError extends Error {
  readonly status: number;
  readonly code: string | null;
  constructor(status: number, code: string | null, message: string) {
    super(message);
    this.name = 'NotionRequestError';
    this.status = status;
    this.code = code;
  }
}

export class SubmissionUpdateError extends Error {
  readonly status: number | null;
  readonly code: string | null;
  constructor(status: number | null, code: string | null, message: string) {
    super(message);
    this.name = 'SubmissionUpdateError';
    this.status = status;
    this.code = code;
  }
}

const SECRET_VALUE =
  /\b(?:ntn|secret|sk|rk|pk)_[A-Za-z0-9_-]{8,}\b|\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b|\bBearer\s+\S+/gi;

const SECRET_PARAM = /([?&#](?:access_token|token|api_key|apikey|secret)=)[^&\s#]+/gi;

/** Drop token-like substrings. The words "token" and "secret" stay when they are not a value. */
export function sanitizeSecretText(value: string): string {
  let text = value.replace(/\s+/g, ' ').trim();
  const secrets = [
    process.env.NOTION_API_KEY,
    process.env.CRON_SECRET,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  ];
  for (const secret of secrets) {
    if (secret && secret.length >= 8) text = text.split(secret).join('[redacted]');
  }
  text = text.replace(SECRET_PARAM, '$1[redacted]').replace(SECRET_VALUE, '[redacted]');
  return text.slice(0, 500);
}

export function usageTaskFailureFromError(
  submissionId: string,
  step: UsageTaskStep,
  error: unknown
): UsageTaskFailure {
  if (error instanceof NotionRequestError || error instanceof SubmissionUpdateError) {
    const code = error.code ? sanitizeSecretText(error.code).slice(0, 80) : null;
    return {
      submissionId,
      step,
      status: error.status,
      code: code || null,
      message: sanitizeSecretText(error.message) || 'request failed',
    };
  }
  const raw = error instanceof Error ? error.message : 'request failed';
  const match = /^Notion (\d{3})\b:?\s*(.*)$/.exec(raw);
  const status = match ? Number(match[1]) : null;
  const detail = match && match[2] ? match[2] : raw;
  const message = sanitizeSecretText(detail) || (status ? `Notion ${status}` : 'request failed');
  return { submissionId, step, status, code: null, message };
}

export type UsageTaskResult =
  | {
      ok: true;
      action: 'skipped' | 'missing_key' | 'created' | 'updated';
      page?: NotionPageRef;
      warnings?: UsageTaskFailure[];
    }
  | {
      ok: false;
      action: 'failed';
      error: string;
      failure: UsageTaskFailure;
      warnings?: UsageTaskFailure[];
    };

export function tasksDataSourceId(): string {
  return process.env.NOTION_TASKS_DATA_SOURCE_ID || DEFAULT_TASKS_DATA_SOURCE_ID;
}

export function clientsDataSourceId(): string {
  return process.env.NOTION_CLIENTS_DATA_SOURCE_ID || DEFAULT_CLIENTS_DATA_SOURCE_ID;
}

export function creatorLabel(handle: string | null | undefined, name: string | null | undefined): string {
  const trimmedHandle = (handle || '').trim();
  if (trimmedHandle) return trimmedHandle.startsWith('@') ? trimmedHandle : `@${trimmedHandle}`;
  return (name || '').trim();
}

export function usageTaskName(row: Pick<UsageSubmissionRow, 'brandName' | 'creatorName' | 'creatorHandle' | 'isWhitelist'>): string {
  const who = creatorLabel(row.creatorHandle, row.creatorName);
  const kind = row.isWhitelist ? 'Whitelisted Ads' : 'Creator Ads';
  return ['Turn off', row.brandName.trim(), who, kind].filter(Boolean).join(' ');
}

export function batchDetailUrl(submissionId: string, appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://melch.cloud'): string {
  return `${appUrl.replace(/\/$/, '')}/admin#batch-${submissionId}`;
}

export function usageTaskNotes(input: {
  submissionId: string;
  batchName: string;
  fileCount: number;
  uploader: string;
  brandName: string;
  clientMatched: boolean;
  appUrl?: string;
}): string {
  const lines = [
    `Melch: ${batchDetailUrl(input.submissionId, input.appUrl)}`,
    `Batch: ${input.batchName}`,
    `Files: ${input.fileCount}`,
    `Uploader: ${input.uploader}`,
  ];
  if (!input.clientMatched && input.brandName.trim()) {
    lines.push(`Brand: ${input.brandName.trim()}`);
  }
  return lines.join('\n');
}

/** Exact brand name, case-insensitive. Prefers the same capitalization. */
export function matchClient(clients: UsageClient[], brandName: string): UsageClient | null {
  const target = brandName.trim().toLowerCase();
  if (!target) return null;
  const hits = clients.filter((client) => client.name.trim().toLowerCase() === target);
  if (hits.length === 0) return null;
  return hits.find((client) => client.name.trim() === brandName.trim()) || hits[0];
}

const OMITTED_PROPERTIES = ['Handled By', 'Creative Ad', 'Expiry Reminder Sent For'] as const;

export function buildUsageTaskCreate(input: {
  row: UsageSubmissionRow;
  client: UsageClient | null;
  dataSourceId?: string;
  appUrl?: string;
}): UsageTaskCreateBody {
  const notes = usageTaskNotes({
    submissionId: input.row.id,
    batchName: input.row.batchName,
    fileCount: input.row.fileCount,
    uploader: input.row.uploader,
    brandName: input.row.brandName,
    clientMatched: Boolean(input.client),
    appUrl: input.appUrl,
  });
  const properties: Record<string, unknown> = {
    Name: { title: [{ type: 'text', text: { content: usageTaskName(input.row) } }] },
    Type: { select: { name: 'TURN OFF ON DUE DATE' } },
    Priority: { select: { name: 'P0' } },
    Status: { select: { name: 'To Do' } },
    'Waiting On': { select: { name: 'Internal' } },
    Due: { date: { start: input.row.usageEndDate } },
    Notes: { rich_text: [{ type: 'text', text: { content: notes } }] },
  };
  if (input.client) {
    properties.Client = { relation: [{ id: input.client.id }] };
  }
  for (const key of OMITTED_PROPERTIES) {
    delete properties[key];
  }
  return {
    parent: {
      type: 'data_source_id',
      data_source_id: input.dataSourceId || tasksDataSourceId(),
    },
    properties,
  };
}

export function buildDueUpdate(usageEndDate: string): { properties: { Due: { date: { start: string } } } } {
  return { properties: { Due: { date: { start: usageEndDate } } } };
}

export async function syncUsageTask(input: {
  row: UsageSubmissionRow;
  notion: NotionUsageClient | null;
  appUrl?: string;
}): Promise<UsageTaskResult> {
  const date = (input.row.usageEndDate || '').trim();
  if (!date) return { ok: true, action: 'skipped' };

  const existingId = (input.row.notionPageId || '').trim();
  if (existingId) {
    if (!input.notion) {
      console.warn('Usage task was not updated: NOTION_API_KEY is not set', { submissionId: input.row.id });
      return { ok: true, action: 'missing_key' };
    }
    try {
      await input.notion.updateDue(existingId, date);
      return { ok: true, action: 'updated' };
    } catch (error) {
      const failure = usageTaskFailureFromError(input.row.id, 'due_update', error);
      console.warn('Usage task due date was not updated', {
        submissionId: input.row.id,
        status: failure.status,
        code: failure.code,
        message: failure.message,
      });
      return { ok: false, action: 'failed', error: 'notion', failure };
    }
  }

  if (!input.notion) {
    console.warn('Usage task was not created: NOTION_API_KEY is not set', { submissionId: input.row.id });
    return { ok: true, action: 'missing_key' };
  }

  const warnings: UsageTaskFailure[] = [];
  let client: UsageClient | null = null;
  try {
    const clients = await input.notion.listClients();
    client = matchClient(clients, input.row.brandName);
  } catch (error) {
    const failure = usageTaskFailureFromError(input.row.id, 'client_lookup', error);
    warnings.push(failure);
    console.warn('Usage task client lookup failed; creating the task without Client', {
      submissionId: input.row.id,
      status: failure.status,
      code: failure.code,
      message: failure.message,
    });
  }

  try {
    const page = await input.notion.createTask(
      buildUsageTaskCreate({ row: { ...input.row, usageEndDate: date }, client, appUrl: input.appUrl })
    );
    return warnings.length ? { ok: true, action: 'created', page, warnings } : { ok: true, action: 'created', page };
  } catch (error) {
    const failure = usageTaskFailureFromError(input.row.id, 'page_create', error);
    console.warn('Usage task was not created', {
      submissionId: input.row.id,
      status: failure.status,
      code: failure.code,
      message: failure.message,
    });
    return warnings.length
      ? { ok: false, action: 'failed', error: 'notion', failure, warnings }
      : { ok: false, action: 'failed', error: 'notion', failure };
  }
}
