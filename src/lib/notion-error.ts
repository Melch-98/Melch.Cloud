/**
 * Notion error bodies are safe to return only after tokens and secrets are
 * removed. Callers that are not the cron or an admin never receive them.
 */

const MESSAGE_LIMIT = 500;

export class NotionApiError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(status: number, code: string | null, message: string) {
    super(message);
    this.name = 'NotionApiError';
    this.status = status;
    this.code = code;
  }
}

export function sanitizeSecretText(input: string, secrets: readonly string[] = []): string {
  let text = input.replace(/\u0000/g, '');
  for (const secret of secrets) {
    if (secret && secret.length >= 8) text = text.split(secret).join('[redacted]');
  }
  text = text
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [redacted]')
    .replace(/\b(?:ntn|secret|sk|rk|pk|sbp|sb_secret|supabase)_[A-Za-z0-9_-]{4,}/gi, '[redacted]')
    .replace(
      /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|authorization)\b\s*[:=]\s*\S+/gi,
      '[redacted]'
    )
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]*)?/g, '[redacted]')
    .replace(/\b[A-Za-z0-9+/_=-]{40,}\b/g, '[redacted]');
  return text.trim().slice(0, MESSAGE_LIMIT);
}

export async function notionFailureFromResponse(
  res: Response,
  secrets: readonly string[] = []
): Promise<NotionApiError> {
  let code: string | null = null;
  let message = '';
  try {
    const body = (await res.json()) as { code?: unknown; message?: unknown };
    if (typeof body.code === 'string' && body.code.trim()) {
      code = sanitizeSecretText(body.code, secrets).slice(0, 80) || null;
    }
    if (typeof body.message === 'string') message = body.message;
  } catch {
    // Status is enough. Do not keep a raw body that might contain a key.
  }
  const sanitized = sanitizeSecretText(message, secrets);
  return new NotionApiError(res.status, code, sanitized || 'Notion request failed');
}
