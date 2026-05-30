// src/lib/creative-types.ts

export interface CreativeTypeOption {
  value: string;
  label: string;
  fidelity: 'high_def' | 'lofi' | 'other';
  format: 'static' | 'video';
}

export interface CreativeTypeGroup {
  label: string;
  fidelity: 'high_def' | 'lofi' | 'other';
  format: 'static' | 'video';
  types: CreativeTypeOption[];
}

export const CREATIVE_TYPE_GROUPS: CreativeTypeGroup[] = [
  {
    label: 'High Def \u2014 Static',
    fidelity: 'high_def',
    format: 'static',
    types: [
      { value: 'ecom_product_shots', label: 'ECom Product Shots', fidelity: 'high_def', format: 'static' },
      { value: 'campaign_product_shots', label: 'Campaign Product Shots', fidelity: 'high_def', format: 'static' },
      { value: 'campaign_model_shots', label: 'Campaign Model Shots', fidelity: 'high_def', format: 'static' },
      { value: 'before_afters_hd', label: 'Before & Afters', fidelity: 'high_def', format: 'static' },
      { value: 'skin_tone_shots', label: 'Skin Tone Shots', fidelity: 'high_def', format: 'static' },
      { value: 'swatches_textures', label: 'Swatches / Textures', fidelity: 'high_def', format: 'static' },
      { value: 'ingredient_callouts', label: 'Ingredient Callouts', fidelity: 'high_def', format: 'static' },
      { value: 'lifestyle_flat_lay', label: 'Lifestyle Flat Lay', fidelity: 'high_def', format: 'static' },
    ],
  },
  {
    label: 'High Def \u2014 Video',
    fidelity: 'high_def',
    format: 'video',
    types: [
      { value: 'beauty_hero_shots', label: 'Beauty / Hero Shots', fidelity: 'high_def', format: 'video' },
      { value: 'application_demo', label: 'Application Demo', fidelity: 'high_def', format: 'video' },
      { value: 'model_interactions', label: 'Model Interactions', fidelity: 'high_def', format: 'video' },
      { value: 'ai_graphic_content', label: 'AI Graphic Content', fidelity: 'high_def', format: 'video' },
      { value: 'product_reveal', label: 'Product Reveal', fidelity: 'high_def', format: 'video' },
    ],
  },
  {
    label: 'Lofi \u2014 Static',
    fidelity: 'lofi',
    format: 'static',
    types: [
      { value: 'irl_lifestyle', label: 'IRL (Lifestyle Setting)', fidelity: 'lofi', format: 'static' },
      { value: 'creator_imagery', label: 'Creator Imagery', fidelity: 'lofi', format: 'static' },
      { value: 'lofi_swatches', label: 'Swatches', fidelity: 'lofi', format: 'static' },
      { value: 'before_afters_lofi', label: 'Before & Afters', fidelity: 'lofi', format: 'static' },
      { value: 'review_screenshot', label: 'Review Screenshot', fidelity: 'lofi', format: 'static' },
    ],
  },
  {
    label: 'Lofi \u2014 Video',
    fidelity: 'lofi',
    format: 'video',
    types: [
      { value: 'product_love_testimonial', label: 'Product Love Testimonials', fidelity: 'lofi', format: 'video' },
      { value: 'product_try_on', label: 'Product Try Ons', fidelity: 'lofi', format: 'video' },
      { value: 'full_routine_makeover', label: 'Full Routine / Makeover', fidelity: 'lofi', format: 'video' },
      { value: 'humor', label: 'Humor', fidelity: 'lofi', format: 'video' },
      { value: 'founder_story', label: 'Founder Story', fidelity: 'lofi', format: 'video' },
      { value: 'behind_the_scenes', label: 'Behind the Scenes', fidelity: 'lofi', format: 'video' },
      { value: 'grwm', label: 'GRWM (Get Ready With Me)', fidelity: 'lofi', format: 'video' },
      { value: 'problem_solution', label: 'Problem \u2192 Solution', fidelity: 'lofi', format: 'video' },
      { value: 'myth_busting', label: 'Myth Busting', fidelity: 'lofi', format: 'video' },
    ],
  },
  {
    label: 'Other Formats \u2014 Static',
    fidelity: 'other',
    format: 'static',
    types: [
      { value: 'alarm_app_mockup', label: 'Alarm App Mockup', fidelity: 'other', format: 'static' },
      { value: 'app_mockup', label: 'App Mockup', fidelity: 'other', format: 'static' },
      { value: 'billboard_mockup', label: 'Billboard Mockup', fidelity: 'other', format: 'static' },
      { value: 'branded_asset', label: 'Branded Asset', fidelity: 'other', format: 'static' },
      { value: 'calendar_app_mockup', label: 'Calendar App Mockup', fidelity: 'other', format: 'static' },
      { value: 'comparison_chart', label: 'Comparison Chart', fidelity: 'other', format: 'static' },
      { value: 'cartoon_illustration', label: 'Cartoon / Illustration', fidelity: 'other', format: 'static' },
      { value: 'meme', label: 'Meme', fidelity: 'other', format: 'static' },
      { value: 'text_overlay_quote', label: 'Text Overlay / Quote', fidelity: 'other', format: 'static' },
    ],
  },
  {
    label: 'Other Formats \u2014 Video',
    fidelity: 'other',
    format: 'video',
    types: [
      { value: 'animation', label: 'Animation', fidelity: 'other', format: 'video' },
      { value: 'asmr', label: 'ASMR', fidelity: 'other', format: 'video' },
      { value: 'case_study', label: 'Case Study', fidelity: 'other', format: 'video' },
      { value: 'celebrity_influencer', label: 'Celebrity / Influencer', fidelity: 'other', format: 'video' },
      { value: 'educational_howto', label: 'Educational / How-To', fidelity: 'other', format: 'video' },
      { value: 'slideshow', label: 'Slideshow', fidelity: 'other', format: 'video' },
      { value: 'unboxing', label: 'Unboxing', fidelity: 'other', format: 'video' },
      { value: 'voiceover_story', label: 'Voiceover Story', fidelity: 'other', format: 'video' },
    ],
  },
];

// Flat lookup helper
export const CREATIVE_TYPES_MAP = new Map<string, CreativeTypeOption>(
  CREATIVE_TYPE_GROUPS.flatMap(g => g.types.map(t => [t.value, t]))
);

export function getCreativeTypeLabel(value: string): string {
  return CREATIVE_TYPES_MAP.get(value)?.label ?? value;
}
