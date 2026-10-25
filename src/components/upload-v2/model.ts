export type CreativeType = 'whitelist' | 'carousel' | 'flexible';

export type AspectRatio = '9:16' | '4:5' | '1:1';

export type LocalMedia = {
  url: string;
  kind: 'image' | 'video';
  name: string;
  width: number | null;
  height: number | null;
};

export type CarouselCard = {
  id: string;
  headline: string;
  kicker: string;
  from: string;
  to: string;
  media: LocalMedia | null;
};

export type SampleProduct = {
  product_key: string;
  product_label: string;
  product_kind: 'product' | 'homepage' | 'collection' | 'shop_all' | 'none';
};

export type Creative = {
  id: string;
  name: string;
  caption: string;
  productKey: string;
  productLabel: string;
  angle: string;
  handle: string;
  usageEndDate: string;
  perpetual: boolean;
  ratio: AspectRatio;
  kicker: string;
  from: string;
  to: string;
  media: LocalMedia | null;
  cards: CarouselCard[];
};

export const SAMPLE_PRODUCTS: SampleProduct[] = [
  { product_key: 'product:chicken-bone-broth', product_label: 'Chicken Bone Broth', product_kind: 'product' },
  { product_key: 'product:variety-pack', product_label: 'Variety Pack', product_kind: 'product' },
  { product_key: 'homepage', product_label: 'Homepage', product_kind: 'homepage' },
  { product_key: 'collection:bestsellers', product_label: 'Collection: Bestsellers', product_kind: 'collection' },
  { product_key: 'shop_all', product_label: 'Shop All', product_kind: 'shop_all' },
  { product_key: 'none', product_label: 'No landing page', product_kind: 'none' },
];

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
    productKey: 'product:chicken-bone-broth',
    productLabel: 'Chicken Bone Broth',
    angle: 'Morning ritual',
    handle: '@sample.creator',
    usageEndDate: '2026-12-31',
    perpetual: false,
    ratio: '9:16',
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
    productKey: 'collection:bestsellers',
    productLabel: 'Collection: Bestsellers',
    angle: 'Gut health, simply',
    handle: '@sample.cook',
    usageEndDate: '',
    perpetual: true,
    ratio: '4:5',
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
    productKey: 'homepage',
    productLabel: 'Homepage',
    angle: 'Founder taste test',
    handle: '@sample.founder',
    usageEndDate: '2027-01-15',
    perpetual: false,
    ratio: '1:1',
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
    productKey: 'product:chicken-bone-broth',
    productLabel: 'Chicken Bone Broth',
    angle: 'Before and after week',
    handle: '@sample.ugc',
    usageEndDate: '',
    perpetual: true,
    ratio: '9:16',
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
    productKey: 'collection:bestsellers',
    productLabel: 'Collection: Bestsellers',
    angle: 'Gift for the cook',
    handle: '@sample.shop',
    usageEndDate: '2026-11-30',
    perpetual: false,
    ratio: '4:5',
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
    productKey: 'shop_all',
    productLabel: 'Shop All',
    angle: 'Morning ritual',
    handle: '@sample.story',
    usageEndDate: '',
    perpetual: true,
    ratio: '1:1',
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

export const ASPECT_RATIOS: { value: AspectRatio; widthOverHeight: number }[] = [
  { value: '9:16', widthOverHeight: 9 / 16 },
  { value: '4:5', widthOverHeight: 4 / 5 },
  { value: '1:1', widthOverHeight: 1 },
];

export function nearestAspectRatio(width: number, height: number): AspectRatio {
  if (!(width > 0) || !(height > 0)) return '9:16';
  const value = width / height;
  let best: AspectRatio = '9:16';
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const option of ASPECT_RATIOS) {
    const distance = Math.abs(Math.log(value) - Math.log(option.widthOverHeight));
    if (distance < bestDistance) {
      best = option.value;
      bestDistance = distance;
    }
  }
  return best;
}

/** Null when the file already matches the selected frame closely enough to skip a crop warning. */
export function aspectCropNote(width: number, height: number, selected: AspectRatio): string | null {
  if (!(width > 0) || !(height > 0)) return null;
  const target = ASPECT_RATIOS.find((option) => option.value === selected);
  if (!target) return null;
  const value = width / height;
  const relative = Math.abs(value - target.widthOverHeight) / target.widthOverHeight;
  if (relative < 0.03) return null;
  const size = `${Math.round(width)}×${Math.round(height)}`;
  if (value < target.widthOverHeight) {
    return `${size} is taller than ${selected}. The top and bottom will be cropped.`;
  }
  return `${size} is wider than ${selected}. The sides will be cropped.`;
}

export function formatUsageEnd(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  if (!year || !month || !day) return iso;
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
