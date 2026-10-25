export type CreativeType = 'whitelist' | 'carousel' | 'flexible';

export type AspectRatio = '9:16' | '4:5' | '1:1';

export type LocalMedia = {
  url: string;
  kind: 'image' | 'video';
  name: string;
  bytes: number;
  width: number | null;
  height: number | null;
};

/** One image or video inside a flexible creative. Meta allows up to 10. */
export type FlexibleAsset = {
  id: string;
  media: LocalMedia;
};

export const CAROUSEL_MIN_CARDS = 2;
export const CAROUSEL_MAX_CARDS = 10;
export const FLEXIBLE_MAX_ASSETS = 10;
export const BATCH_MAX_CREATIVES = 20;

export type ReplaceTarget =
  | { kind: 'media'; creativeIndex: number }
  | { kind: 'card'; index: number }
  | { kind: 'asset'; index: number };

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
  /** Sample filename used when no local file is attached. */
  originalName: string;
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
  /** Flexible creatives keep every file here. Other types leave this empty. */
  assets: FlexibleAsset[];
  cards: CarouselCard[];
  /** Appended when a dropped file becomes its own batch creative. */
  userAdded?: boolean;
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

export type UploadBrand = {
  id: string;
  name: string;
  slug: string;
  websiteUrl: string | null;
};

/** Hostname from brands.website_url. Matches the navbar favicon lookup. */
export function brandDomain(websiteUrl: string | null | undefined): string | null {
  const raw = websiteUrl?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    return url.hostname || null;
  } catch {
    return null;
  }
}

/**
 * brands has no logo column. The navbar already turns brands.website_url into this favicon URL.
 * A null result means the brand has no website, so the phone uses initials.
 */
export function brandLogoUrl(websiteUrl: string | null | undefined): string | null {
  const domain = brandDomain(websiteUrl);
  if (!domain) return null;
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
}

export function brandInitials(name: string): string {
  const letters = name
    .trim()
    .split(/\s+/)
    .map((word) => word.match(/[A-Za-z0-9]/)?.[0] ?? '')
    .filter(Boolean);
  if (!letters.length) return '';
  if (letters.length === 1) return letters[0].toUpperCase();
  return (letters[0] + letters[1]).toUpperCase();
}

/** ISO week of the local calendar date (week 1 contains the first Thursday). */
export function isoWeekNumber(date: Date): number {
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  return Math.ceil(((utc.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

export function weekFolderLabel(date = new Date()): string {
  return `Week ${isoWeekNumber(date)}`;
}

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
    originalName: 'broth-pour.mp4',
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
    assets: [],
    cards: [
      card('broth-1', 'Start with the pour', 'The pour', '#E7C89A', '#6A4328'),
      card('broth-2', 'Steam, then sip', 'The steam', '#F0D7B4', '#8A5A32'),
      card('broth-3', 'Bowl on the table', 'The bowl', '#C8B89A', '#3E2A1C'),
    ],
  },
  {
    id: 'bestsellers-shelf',
    name: 'Bestsellers shelf',
    originalName: 'bestsellers-shelf.jpg',
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
    assets: [],
    cards: [
      card('shelf-1', 'The short list', 'Short list', '#F3E6CF', '#8C7352'),
      card('shelf-2', 'What sells through', 'Sell-through', '#E4D2B0', '#6E5840'),
      card('shelf-3', 'Restock the row', 'Restock', '#D9C4A4', '#4A3828'),
    ],
  },
  {
    id: 'homepage-still',
    name: 'Homepage still',
    originalName: 'homepage-still.jpg',
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
    assets: [],
    cards: [
      card('home-1', 'Open on the kitchen', 'Kitchen', '#D9D4CC', '#4E5550'),
      card('home-2', 'Then the product', 'Product', '#C9C3BA', '#3C433E'),
      card('home-3', 'End on the bowl', 'Bowl', '#B7B1A8', '#2C312E'),
    ],
  },
  {
    id: 'taste-test',
    name: 'Founder taste test',
    originalName: 'taste-test.mp4',
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
    assets: [],
    cards: [
      card('taste-1', 'The first spoon', 'First spoon', '#F2C7A5', '#7A4B45'),
      card('taste-2', 'The face after', 'Reaction', '#E7B394', '#5C3834'),
      card('taste-3', 'The second bowl', 'Second bowl', '#D9A088', '#3E2824'),
    ],
  },
  {
    id: 'collection-grid',
    name: 'Collection grid',
    originalName: 'collection-grid.jpg',
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
    assets: [],
    cards: [
      card('grid-1', 'Line them up', 'The line', '#E7B7C4', '#6A3A48'),
      card('grid-2', 'One of each', 'One of each', '#D9A3B2', '#54303C'),
      card('grid-3', 'Gift the set', 'Gift set', '#C98A9C', '#3A2228'),
    ],
  },
  {
    id: 'story-cutdown',
    name: 'Story cutdown',
    originalName: 'story-cutdown.mp4',
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
    assets: [],
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
    assets: creative.assets.map((asset) => ({
      id: asset.id,
      media: { ...asset.media },
    })),
    cards: creative.cards.map((item) => ({
      ...item,
      media: item.media ? { ...item.media } : null,
    })),
  };
}

export function createLocalId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${rand}`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb >= 10 ? Math.round(kb) : kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB`;
}

export function mediaRatioLabel(media: LocalMedia | null | undefined): string {
  if (!media?.width || !media.height) return '—';
  return nearestAspectRatio(media.width, media.height);
}

export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return items;
  const next = items.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** Keep the active row selected after a reorder. */
export function followMove(current: number, from: number, to: number): number {
  if (current === from) return to;
  if (from < current && to >= current) return current - 1;
  if (from > current && to <= current) return current + 1;
  return current;
}

const CARD_TONES = [
  ['#E7C89A', '#6A4328'],
  ['#F0D7B4', '#8A5A32'],
  ['#C8B89A', '#3E2A1C'],
  ['#E7B7C4', '#6A3A48'],
  ['#C9D4F2', '#3A4670'],
  ['#F2C7A5', '#7A4B45'],
  ['#D9D4CC', '#4E5550'],
  ['#E4D2B0', '#6E5840'],
  ['#B7C4EA', '#2E3858'],
  ['#C98A9C', '#3A2228'],
];

function blankCard(id: string, index: number, template?: CarouselCard | null): CarouselCard {
  const tone = CARD_TONES[index % CARD_TONES.length];
  return {
    id,
    headline: template?.headline ?? '',
    kicker: template?.kicker ?? '',
    from: template?.from ?? tone[0],
    to: template?.to ?? tone[1],
    media: null,
  };
}

export type MediaPlacement = {
  cards?: CarouselCard[];
  assets?: FlexibleAsset[];
  placed: number;
  leftover: number;
  focusIndex: number;
};

/**
 * Files become carousel cards. An all-empty card list is replaced (so the
 * sample three cards do not cap the creative). Later drops fill empty cards,
 * then append, and stop at 10. At least 2 cards remain.
 */
export function addCarouselMedia(
  cards: CarouselCard[],
  incoming: LocalMedia[],
  makeId: (prefix: string) => string,
): MediaPlacement {
  if (incoming.length === 0) {
    return { cards, placed: 0, leftover: 0, focusIndex: 0 };
  }

  const allEmpty = cards.length === 0 || cards.every((card) => !card.media);
  if (allEmpty) {
    const count = Math.min(CAROUSEL_MAX_CARDS, Math.max(CAROUSEL_MIN_CARDS, incoming.length));
    const next = Array.from({ length: count }, (_, index) => {
      const card = blankCard(cards[index]?.id ?? makeId('card'), index, cards[index]);
      card.media = incoming[index] ?? null;
      return card;
    });
    const placed = Math.min(incoming.length, CAROUSEL_MAX_CARDS);
    return { cards: next, placed, leftover: incoming.length - placed, focusIndex: 0 };
  }

  const next = cards.map((card) => ({ ...card, media: card.media }));
  let cursor = 0;
  let focusIndex = 0;
  let focused = false;
  for (let index = 0; index < next.length && cursor < incoming.length; index += 1) {
    if (next[index].media) continue;
    next[index] = { ...next[index], media: incoming[cursor] };
    cursor += 1;
    if (!focused) {
      focusIndex = index;
      focused = true;
    }
  }
  while (cursor < incoming.length && next.length < CAROUSEL_MAX_CARDS) {
    const card = blankCard(makeId('card'), next.length, null);
    card.media = incoming[cursor];
    cursor += 1;
    if (!focused) {
      focusIndex = next.length;
      focused = true;
    }
    next.push(card);
  }
  while (next.length < CAROUSEL_MIN_CARDS) {
    next.push(blankCard(makeId('card'), next.length, null));
  }
  return { cards: next, placed: cursor, leftover: incoming.length - cursor, focusIndex };
}

export function removeCarouselCard(cards: CarouselCard[], index: number): CarouselCard[] | null {
  if (cards.length <= CAROUSEL_MIN_CARDS) return null;
  if (index < 0 || index >= cards.length) return null;
  return cards.filter((_, cardIndex) => cardIndex !== index);
}

export function addFlexibleAssets(
  assets: FlexibleAsset[],
  incoming: LocalMedia[],
  makeId: (prefix: string) => string,
): MediaPlacement {
  const room = Math.max(0, FLEXIBLE_MAX_ASSETS - assets.length);
  const placedMedia = incoming.slice(0, room);
  const focusIndex = assets.length;
  const next = [
    ...assets,
    ...placedMedia.map((media) => ({ id: makeId('asset'), media })),
  ];
  return {
    assets: next,
    placed: placedMedia.length,
    leftover: incoming.length - placedMedia.length,
    focusIndex: placedMedia.length ? focusIndex : Math.max(0, assets.length - 1),
  };
}

function fileStem(name: string): string {
  const base = name.split(/[/\\]/).pop() || name;
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  return stem.trim() || 'Creative';
}

export function creativeFromMedia(
  media: LocalMedia,
  template: Creative,
  makeId: (prefix: string) => string,
): Creative {
  const name = fileStem(media.name);
  const ratio = media.width && media.height
    ? nearestAspectRatio(media.width, media.height)
    : template.ratio;
  return {
    id: makeId('creative'),
    name,
    originalName: media.name,
    caption: '',
    productKey: '',
    productLabel: '',
    angle: '',
    handle: template.handle,
    usageEndDate: template.usageEndDate,
    perpetual: template.perpetual,
    ratio,
    kicker: name,
    from: template.from,
    to: template.to,
    media,
    assets: [],
    cards: [
      blankCard(makeId('card'), 0, null),
      blankCard(makeId('card'), 1, null),
    ],
    userAdded: true,
  };
}

export function appendBatchCreatives(
  creatives: Creative[],
  incoming: LocalMedia[],
  template: Creative,
  makeId: (prefix: string) => string,
): { creatives: Creative[]; placed: number; leftover: number; firstNewIndex: number } {
  const room = Math.max(0, BATCH_MAX_CREATIVES - creatives.length);
  const placedMedia = incoming.slice(0, room);
  const added = placedMedia.map((media) => creativeFromMedia(media, template, makeId));
  return {
    creatives: [...creatives, ...added],
    placed: added.length,
    leftover: incoming.length - added.length,
    firstNewIndex: creatives.length,
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

/** Lowercase slug. Spaces and filename-unsafe characters become hyphens. */
export function fileNameSlug(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Product handle, or a slug of homepage / shop all. "No landing page" adds nothing. */
export function productFileSlug(productKey: string): string {
  const key = productKey.trim();
  if (!key || key === 'none') return '';
  const colon = key.indexOf(':');
  const raw = colon >= 0 ? key.slice(colon + 1) : key;
  return fileNameSlug(raw.replace(/_/g, '-'));
}

export function fileExtension(name: string): string {
  const base = name.split(/[/\\]/).pop() || name;
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return '';
  const ext = base.slice(dot + 1);
  if (!/^[a-z0-9]{1,8}$/i.test(ext)) return '';
  return `.${ext.toLowerCase()}`;
}

export type FileNamePreview = {
  fileName: string;
  renamed: boolean;
  label: 'Original name kept' | 'Renamed from inputs';
};

export function sourceFileName(creative: Creative, shownName: string | null): string {
  const shown = shownName?.trim();
  if (shown) return shown;
  if (creative.media?.name) return creative.media.name;
  const assetName = creative.assets.find((asset) => asset.media?.name)?.media.name;
  if (assetName) return assetName;
  const cardName = creative.cards.find((card) => card.media?.name)?.media?.name;
  if (cardName) return cardName;
  return creative.originalName;
}

type NameDraft = {
  renamed: boolean;
  stem: string;
  extension: string;
  original: string;
};

/**
 * Upload type is always selected, so it does not by itself replace the original name.
 * A new name is built only when creator, product, or angle has a usable part.
 */
function nameDraft(
  creative: Creative,
  creatorName: string,
  creativeType: CreativeType,
  shownName: string | null,
): NameDraft {
  const original = sourceFileName(creative, shownName);
  const creator = fileNameSlug(creatorName);
  const product = productFileSlug(creative.productKey);
  const angle = fileNameSlug(creative.angle);
  const renamed = Boolean(creator || product || angle);
  const stem = [creator, creativeType, product, angle].filter(Boolean).join('_');
  return { renamed, stem, extension: fileExtension(original), original };
}

function candidateName(draft: NameDraft): string {
  if (!draft.renamed) return draft.original;
  return `${draft.stem}${draft.extension}`;
}

export function previewCreativeFileNames(input: {
  creatives: Creative[];
  creatorName: string;
  creativeType: CreativeType;
  batchOn: boolean;
  activeIndex: number;
  activeShownName: string | null;
}): FileNamePreview[] {
  const { creatives, creatorName, creativeType, batchOn, activeIndex, activeShownName } = input;
  const drafts = creatives.map((creative, index) => nameDraft(
    creative,
    creatorName,
    creativeType,
    index === activeIndex ? activeShownName : null,
  ));
  const scope = batchOn
    ? creatives.map((_, index) => index)
    : [Math.min(creatives.length - 1, Math.max(0, activeIndex))];
  const counts = new Map<string, number>();
  for (const index of scope) {
    const name = candidateName(drafts[index]);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return drafts.map((draft, index) => {
    if (!draft.renamed) {
      return { fileName: draft.original, renamed: false, label: 'Original name kept' };
    }
    const plain = candidateName(draft);
    const collided = scope.includes(index) && (counts.get(plain) ?? 0) > 1;
    const fileName = collided ? `${draft.stem}_${index + 1}${draft.extension}` : plain;
    return { fileName, renamed: true, label: 'Renamed from inputs' };
  });
}
