import type { AutoTagImage, AutoTagModelResult, AutoTagProvider, AutoTagUsage } from '@/lib/auto-tag/provider';
import { extractJsonObject } from '@/lib/creative-auto-tag';

export const XAI_API_KEY_ENV = 'XAI_API_KEY';
export const XAI_VISION_MODEL_ENV = 'XAI_VISION_MODEL';

/**
 * Fast non-reasoning Grok. Accepts image_url base64 data URLs on
 * https://api.x.ai/v1/chat/completions and does not spend reasoning tokens.
 * Override with XAI_VISION_MODEL.
 */
export const DEFAULT_XAI_VISION_MODEL = 'grok-4.20-0309-non-reasoning';

const XAI_CHAT_COMPLETIONS_URL = 'https://api.x.ai/v1/chat/completions';

/** 1 USD = 10^10 ticks. https://docs.x.ai/developers/cost-tracking */
export const USD_TICKS_PER_DOLLAR = 10_000_000_000;

export function xaiApiKey(): string | null {
  const key = process.env[XAI_API_KEY_ENV];
  if (!key || !key.trim()) return null;
  return key.trim();
}

export function xaiVisionModel(): string {
  const configured = process.env[XAI_VISION_MODEL_ENV];
  if (configured && configured.trim()) return configured.trim();
  return DEFAULT_XAI_VISION_MODEL;
}

export function ticksToUsd(ticks: number | null): number | null {
  if (ticks === null || !Number.isFinite(ticks)) return null;
  return ticks / USD_TICKS_PER_DOLLAR;
}

export function readUsage(usage: unknown): AutoTagUsage {
  if (!usage || typeof usage !== 'object') {
    return { costInUsdTicks: null, promptTokens: null, completionTokens: null };
  }
  const row = usage as Record<string, unknown>;
  const ticks = row.cost_in_usd_ticks;
  return {
    costInUsdTicks: typeof ticks === 'number' && Number.isFinite(ticks) ? ticks : null,
    promptTokens: typeof row.prompt_tokens === 'number' ? row.prompt_tokens : null,
    completionTokens: typeof row.completion_tokens === 'number' ? row.completion_tokens : null,
  };
}

export const CREATIVE_TAG_JSON_SCHEMA = {
  name: 'creative_tags',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      creative_type: { type: ['string', 'null'] },
      creative_type_confidence: { type: 'number' },
      fidelity: { type: ['string', 'null'] },
      fidelity_confidence: { type: 'number' },
      product_id: { type: ['string', 'null'] },
      product_name: { type: ['string', 'null'] },
      product_confidence: { type: 'number' },
      hook_angle: { type: ['string', 'null'] },
      hook_angle_confidence: { type: 'number' },
    },
    required: [
      'creative_type',
      'creative_type_confidence',
      'fidelity',
      'fidelity_confidence',
      'product_id',
      'product_name',
      'product_confidence',
      'hook_angle',
      'hook_angle_confidence',
    ],
  },
} as const;

export function buildGrokChatBody(input: {
  model: string;
  prompt: string;
  images: AutoTagImage[];
}): Record<string, unknown> {
  return {
    model: input.model,
    temperature: 0,
    max_tokens: 700,
    response_format: {
      type: 'json_schema',
      json_schema: CREATIVE_TAG_JSON_SCHEMA,
    },
    messages: [
      {
        role: 'system',
        content:
          'You only output JSON matching the schema. Never invent products, hooks, creators, or claims that are not visible. When unsure, use null and a confidence under 0.6.',
      },
      {
        role: 'user',
        content: [
          ...input.images.slice(0, 3).map((image) => ({
            type: 'image_url',
            image_url: {
              url: `data:${image.mediaType};base64,${image.base64}`,
              detail: 'low',
            },
          })),
          { type: 'text', text: input.prompt },
        ],
      },
    ],
  };
}

export function usageRecord(usage: AutoTagUsage): Record<string, number | null> {
  return {
    cost_in_usd_ticks: usage.costInUsdTicks,
    cost_usd: ticksToUsd(usage.costInUsdTicks),
    prompt_tokens: usage.promptTokens,
    completion_tokens: usage.completionTokens,
  };
}

export function logAutoTagCost(input: {
  fileLabel?: string;
  model: string;
  usage: AutoTagUsage;
}): void {
  const usd = ticksToUsd(input.usage.costInUsdTicks);
  console.info(
    `[creative-auto-tag] model=${input.model} file=${input.fileLabel || 'creative'} cost_in_usd_ticks=${
      input.usage.costInUsdTicks ?? 'unknown'
    } cost_usd=${usd === null ? 'unknown' : usd.toFixed(6)}`
  );
}

async function callGrok(input: {
  prompt: string;
  images: AutoTagImage[];
  fileLabel?: string;
}): Promise<AutoTagModelResult> {
  const apiKey = xaiApiKey();
  if (!apiKey) {
    throw new Error(`${XAI_API_KEY_ENV} not configured`);
  }
  if (!input.images.length) {
    throw new Error('No image frames to tag');
  }

  const model = xaiVisionModel();
  const response = await fetch(XAI_CHAT_COMPLETIONS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildGrokChatBody({ model, prompt: input.prompt, images: input.images })),
    signal: AbortSignal.timeout(25_000),
  });

  const payload = (await response.json().catch(() => null)) as {
    error?: { message?: string };
    choices?: Array<{ message?: { content?: string | null } }>;
    usage?: unknown;
    model?: string;
  } | null;

  if (!response.ok) {
    const message = payload?.error?.message || `xAI request failed (${response.status})`;
    throw new Error(message);
  }

  const content = payload?.choices?.[0]?.message?.content;
  if (!content || typeof content !== 'string') {
    throw new Error('xAI returned no JSON content');
  }

  const usage = readUsage(payload?.usage);
  const usedModel = typeof payload?.model === 'string' && payload.model ? payload.model : model;
  logAutoTagCost({ fileLabel: input.fileLabel, model: usedModel, usage });

  return {
    raw: extractJsonObject(content),
    model: usedModel,
    usage,
  };
}

export const grokAutoTagProvider: AutoTagProvider = {
  id: 'xai-grok',
  isConfigured: () => Boolean(xaiApiKey()),
  tag: callGrok,
};
