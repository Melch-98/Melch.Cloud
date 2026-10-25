export type CreativeType = 'whitelist' | 'carousel' | 'flexible';
export type Placement = 'reels' | 'stories' | 'feed';

export type LocalMedia = {
  url: string;
  kind: 'image' | 'video';
  name: string;
};

export type CarouselCard = {
  id: string;
  headline: string;
  kicker: string;
  from: string;
  to: string;
  media: LocalMedia | null;
};

export type Creative = {
  id: string;
  name: string;
  caption: string;
  product: string;
  angle: string;
  handle: string;
  kicker: string;
  from: string;
  to: string;
  media: LocalMedia | null;
  cards: CarouselCard[];
};

export const SAMPLE_PRODUCTS = [
  'Chicken Bone Broth - Bestsellers',
  'Homepage',
  'Collection',
  'Bone Broth Variety — sample',
  'Shop All — sample',
] as const;

export const ANGLE_SUGGESTIONS = [
  'Morning ritual',
  'Gut health, simply',
  'Founder taste test',
  'Before and after week',
  'Gift for the cook',
] as const;

export const SAMPLE_BRAND = 'Sample Brand';

function card(
  id: string,
  headline: string,
  kicker: string,
  from: string,
  to: string,
): CarouselCard {
  return { id, headline, kicker, from, to, media: null };
}

export const SAMPLE_CREATIVES: Creative[] = [
  {
    id: 'broth-pour',
    name: 'Broth pour',
    caption: 'A slow pour, a quiet morning. Sample caption for the broth creative.',
    product: 'Chicken Bone Broth - Bestsellers',
    angle: 'Morning ritual',
    handle: '@sample.creator',
    kicker: 'Broth pour',
    from: '#E7C89A',
    to: '#6A4328',
    media: null,
    cards: [
      card('broth-1', 'Start with the pour', 'The pour', '#E7C89A', '#6A4328'),
      card('broth-2', 'Steam, then sip', 'The steam', '#F0D7B4', '#8A5A32'),
      card('broth-3', 'Bowl on the table', 'The bowl', '#C8B89A', '#3E2A1C'),
    ],
  },
  {
    id: 'bestsellers-shelf',
    name: 'Bestsellers shelf',
    caption: 'The shelf we keep restocking. Sample caption, not a live ad.',
    product: 'Chicken Bone Broth - Bestsellers',
    angle: 'Gut health, simply',
    handle: '@sample.cook',
    kicker: 'Bestsellers',
    from: '#F3E6CF',
    to: '#8C7352',
    media: null,
    cards: [
      card('shelf-1', 'The short list', 'Short list', '#F3E6CF', '#8C7352'),
      card('shelf-2', 'What sells through', 'Sell-through', '#E4D2B0', '#6E5840'),
      card('shelf-3', 'Restock the row', 'Restock', '#D9C4A4', '#4A3828'),
    ],
  },
  {
    id: 'homepage-still',
    name: 'Homepage still',
    caption: 'Homepage hero, held for a beat. Placeholder copy only.',
    product: 'Homepage',
    angle: 'Founder taste test',
    handle: '@sample.founder',
    kicker: 'Homepage',
    from: '#D9D4CC',
    to: '#4E5550',
    media: null,
    cards: [
      card('home-1', 'Open on the kitchen', 'Kitchen', '#D9D4CC', '#4E5550'),
      card('home-2', 'Then the product', 'Product', '#C9C3BA', '#3C433E'),
      card('home-3', 'End on the bowl', 'Bowl', '#B7B1A8', '#2C312E'),
    ],
  },
  {
    id: 'taste-test',
    name: 'Founder taste test',
    caption: 'First spoon, honest reaction. This creator is sample data.',
    product: 'Chicken Bone Broth - Bestsellers',
    angle: 'Before and after week',
    handle: '@sample.ugc',
    kicker: 'Taste test',
    from: '#F2C7A5',
    to: '#7A4B45',
    media: null,
    cards: [
      card('taste-1', 'The first spoon', 'First spoon', '#F2C7A5', '#7A4B45'),
      card('taste-2', 'The face after', 'Reaction', '#E7B394', '#5C3834'),
      card('taste-3', 'The second bowl', 'Second bowl', '#D9A088', '#3E2824'),
    ],
  },
  {
    id: 'collection-grid',
    name: 'Collection grid',
    caption: 'Every jar in the set, in one frame. Sample collection creative.',
    product: 'Collection',
    angle: 'Gift for the cook',
    handle: '@sample.shop',
    kicker: 'The set',
    from: '#E7B7C4',
    to: '#6A3A48',
    media: null,
    cards: [
      card('grid-1', 'Line them up', 'The line', '#E7B7C4', '#6A3A48'),
      card('grid-2', 'One of each', 'One of each', '#D9A3B2', '#54303C'),
      card('grid-3', 'Gift the set', 'Gift set', '#C98A9C', '#3A2228'),
    ],
  },
  {
    id: 'story-cutdown',
    name: 'Story cutdown',
    caption: 'A shorter cut for stories. Still a mock file, not a real asset.',
    product: 'Collection',
    angle: 'Morning ritual',
    handle: '@sample.story',
    kicker: 'Cutdown',
    from: '#C9D4F2',
    to: '#3A4670',
    media: null,
    cards: [
      card('cut-1', 'Open fast', 'Open', '#C9D4F2', '#3A4670'),
      card('cut-2', 'Show the jar', 'The jar', '#B7C4EA', '#2E3858'),
      card('cut-3', 'End on the sip', 'The sip', '#A3B2DE', '#242C44'),
    ],
  },
];

export function cloneCreative(creative: Creative): Creative {
  return {
    ...creative,
    media: creative.media ? { ...creative.media } : null,
    cards: creative.cards.map((item) => ({
      ...item,
      media: item.media ? { ...item.media } : null,
    })),
  };
}

export function displayHandle(handle: string): string {
  const trimmed = handle.trim();
  if (!trimmed) return '@sample.creator';
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
}

export function mediaKind(file: File): 'image' | 'video' | null {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  return null;
}

export function revokeMedia(media: LocalMedia | null) {
  if (media?.url.startsWith('blob:')) URL.revokeObjectURL(media.url);
}
