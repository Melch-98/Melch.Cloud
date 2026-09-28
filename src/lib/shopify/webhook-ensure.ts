export type EnsureTopic = {
  topic: string;
  status: 'already_registered' | 'created' | 'missing' | 'error';
};

export type WebhookEnsureOutcome = {
  ok: boolean;
  missingScope: string | null;
  /** A missing scope is recorded. It does not abort the rest of the scheduled run. */
  continueRun: true;
};

/**
 * already_registered and created are both success.
 * A missing scope is a per-brand result, not a failed job.
 */
export function interpretWebhookEnsure(
  topics: EnsureTopic[],
  missingScope: string | null
): WebhookEnsureOutcome {
  const registered =
    !missingScope &&
    topics.length > 0 &&
    topics.every((topic) => topic.status === 'already_registered' || topic.status === 'created');
  return {
    ok: registered,
    missingScope,
    continueRun: true,
  };
}

export async function applyWebhookEnsure(
  register: () => Promise<{ topics: EnsureTopic[]; missingScope: string | null }>
): Promise<WebhookEnsureOutcome> {
  const result = await register();
  return interpretWebhookEnsure(result.topics, result.missingScope);
}
