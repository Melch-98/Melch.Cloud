// ─── /api/ad-lab/generate ───────────────────────────────────────
// Uses Claude to generate Meta Ad copy: primary text, headlines,
// and descriptions.  Admin-only.

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { authenticateRequest } from '@/lib/auth';

const SYSTEM_PROMPT = `You are an elite direct-response copywriter who specializes in Meta (Facebook/Instagram) ads. You write scroll-stopping, high-converting ad copy that drives clicks and purchases.

Your style:
- Hook-driven opening lines that pattern-interrupt the scroll
- Conversational, benefit-led body copy (not feature-dumping)
- Clear, urgent CTAs
- You understand DTC e-commerce deeply — shipping offers, social proof, scarcity, and curiosity hooks
- You write for the brand voice provided, not generic marketing speak

OUTPUT FORMAT — return ONLY valid JSON with this exact structure:
{
  "primary_texts": [
    { "label": "Hook Style", "text": "..." },
    { "label": "Story Style", "text": "..." },
    { "label": "Social Proof Style", "text": "..." }
  ],
  "headlines": [
    "Headline 1",
    "Headline 2",
    "Headline 3",
    "Headline 4",
    "Headline 5"
  ],
  "descriptions": [
    "Description 1",
    "Description 2",
    "Description 3"
  ]
}

RULES:
- Primary texts: 3 variants, each 40-125 words. Each with a different angle (hook/pattern-interrupt, story/relatable, social proof/authority).
- Headlines: 5 options, max 40 characters each. Punchy, benefit-driven, curiosity-inducing.
- Descriptions: 3 options, max 30 words each. Support the headline, reinforce the offer.
- Do NOT wrap in markdown code fences. Return raw JSON only.`;

export async function POST(request: NextRequest) {
  // Auth — admin only
  const { auth, error, status } = await authenticateRequest(request);
  if (!auth) return NextResponse.json({ error }, { status: status || 401 });
  if (auth.role !== 'admin') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'ANTHROPIC_API_KEY not configured. Add it to your Vercel environment variables.' },
      { status: 500 }
    );
  }

  const body = await request.json();
  const { brand_name, product, destination_url, tone, extra_context, creative_type } = body;

  if (!brand_name || !product) {
    return NextResponse.json({ error: 'brand_name and product are required' }, { status: 400 });
  }

  const userPrompt = [
    `Brand: ${brand_name}`,
    `Product / Offer: ${product}`,
    destination_url ? `Landing Page: ${destination_url}` : null,
    tone ? `Tone: ${tone}` : null,
    creative_type ? `Creative Type: ${creative_type}` : null,
    extra_context ? `Additional Context: ${extra_context}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const anthropic = new Anthropic({ apiKey });

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    });

    // Extract text from response
    const textBlock = message.content.find((b: any) => b.type === 'text');
    const rawText = textBlock ? (textBlock as any).text : '';

    // Parse JSON
    let copy;
    try {
      copy = JSON.parse(rawText);
    } catch {
      // Try to extract JSON from the response if wrapped in markdown
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        copy = JSON.parse(jsonMatch[0]);
      } else {
        return NextResponse.json({ error: 'Failed to parse AI response', raw: rawText }, { status: 500 });
      }
    }

    return NextResponse.json({ copy });
  } catch (err: any) {
    console.error('[Ad Lab] Claude error:', err);
    return NextResponse.json(
      { error: err.message || 'AI generation failed' },
      { status: 500 }
    );
  }
}
