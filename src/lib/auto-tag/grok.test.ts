import { describe, expect, it } from 'vitest';
import {
  DEFAULT_XAI_VISION_MODEL,
  buildGrokChatBody,
  readUsage,
  ticksToUsd,
  usageRecord,
} from '@/lib/auto-tag/grok';

describe('grok vision request', () => {
  it('defaults to the non-reasoning model and sends jpeg data URLs at low detail', () => {
    const body = buildGrokChatBody({
      model: DEFAULT_XAI_VISION_MODEL,
      sharedPrompt: 'Brand catalog and instructions',
      filePrompt: 'File name: clip.mp4',
      images: [{ mediaType: 'image/jpeg', base64: 'aaaa' }],
    });
    expect(body.model).toBe('grok-4.20-0309-non-reasoning');
    expect(body.temperature).toBe(0);
    const format = body.response_format as { type: string; json_schema: { strict: boolean } };
    expect(format.type).toBe('json_schema');
    expect(format.json_schema.strict).toBe(true);
    const messages = body.messages as Array<{ role: string; content: unknown }>;
    expect(String(messages[0].content)).toContain('0.8');
    const user = messages[1].content as Array<{
      type: string;
      text?: string;
      image_url?: { url: string; detail: string };
    }>;
    expect(user.map((part) => part.type)).toEqual(['text', 'text', 'image_url']);
    expect(user[0].text).toBe('Brand catalog and instructions');
    expect(user[1].text).toContain('File name:');
    expect(user[2]).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/jpeg;base64,aaaa', detail: 'low' },
    });
  });

  it('turns cost ticks into USD', () => {
    const usage = readUsage({ cost_in_usd_ticks: 37_756_000, prompt_tokens: 12, completion_tokens: 4 });
    expect(ticksToUsd(37_756_000)).toBeCloseTo(0.0037756, 8);
    expect(usageRecord(usage)).toMatchObject({
      cost_in_usd_ticks: 37_756_000,
      cost_usd: 0.0037756,
      prompt_tokens: 12,
      completion_tokens: 4,
    });
  });
});