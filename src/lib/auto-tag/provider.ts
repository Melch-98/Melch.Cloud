/**
 * Vision auto-tag providers. Swap the implementation here without touching the upload form.
 * The current provider is xAI Grok via the OpenAI-compatible chat completions API.
 */

import { grokAutoTagProvider } from '@/lib/auto-tag/grok';

export interface AutoTagImage {
  mediaType: 'image/jpeg' | 'image/png';
  /** Raw base64, no data-URL prefix. */
  base64: string;
}

export interface AutoTagUsage {
  costInUsdTicks: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
}

export interface AutoTagModelResult {
  raw: unknown;
  model: string;
  usage: AutoTagUsage;
}

export interface AutoTagProvider {
  readonly id: string;
  isConfigured(): boolean;
  tag(input: { prompt: string; images: AutoTagImage[]; fileLabel?: string }): Promise<AutoTagModelResult>;
}

export function getAutoTagProvider(): AutoTagProvider {
  return grokAutoTagProvider;
}
