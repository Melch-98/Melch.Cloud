export type CreativeType = 'whitelist' | 'carousel' | 'flexible';

export type AspectRatio = '9:16' | '4:5' | '1:1';

export type LocalMedia = {
  url: string;
  kind: 'image' | 'video';
  name: string;
  bytes: number;
  width: number | null;
  height: number | null;
  /** The browser File used for storage upload. Fixtures that are not submitted use null. */
  file: File | null;
  /** detectFormat(file.type). Not derived from the preview crop. */
  mediaFormat: 'VIDEO' | 'STATIC' | 'AUDIO' | 'DOCUMENT' | null;
  /**
   * detectAspectRatio(width, height): 1x1 | 9x16 | 4x5 | 16x9 | OTHER.
   * This is the stored aspect_ratio. Creative.ratio is only the preview frame.
   */
  detectedAspectRatio: '1x1' | '9x16' | '4x5' | '16x9' | 'OTHER' | null;
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

/**
 * Optional chips. All false is the default: each file is a plain creative.
 * Carousel and flexible cannot both be on. Whitelist is a flag and may sit on any of the three.
 */
export type UploadModes = {
  whitelist: boolean;
  carousel: boolean;
  flexible: boolean;
};

export type UploadStructure = 'plain' | 'carousel' | 'flexible';

export const EMPTY_UPLOAD_MODES: UploadModes = {
  whitelist: false,
  carousel: false,
  flexible: false,
};

/** Carousel wins if both structure flags are set. The chips never produce that pair. */
export function normalizeUploadModes(modes: UploadModes): UploadModes {
  const carousel = Boolean(modes.carousel);
  const flexible = Boolean(modes.flexible) && !carousel;
  return {
    whitelist: Boolean(modes.whitelist),
    carousel,
    flexible,
  };
}

export function uploadStructure(modes: UploadModes): UploadStructure {
  const normalized = normalizeUploadModes(modes);
  if (normalized.carousel) return 'carousel';
  if (normalized.flexible) return 'flexible';
  return 'plain';
}

export function toggleUploadMode(modes: UploadModes, key: keyof UploadModes): UploadModes {
  const current = normalizeUploadModes(modes);
  const next = { ...current, [key]: !current[key] };
  if (key === 'carousel' && next.carousel) next.flexible = false;
  if (key === 'flexible' && next.flexible) next.carousel = false;
  return next;
}

/** Slug used in a renamed file. Null in the default plain state, which keeps the uploaded name. */
export function nameTypeForModes(modes: UploadModes): CreativeType | null {
  const normalized = normalizeUploadModes(modes);
  if (normalized.carousel) return 'carousel';
  if (normalized.flexible) return 'flexible';
  if (normalized.whitelist) return 'whitelist';
  return null;
}

/** Creator, product, and angle stay hidden until a chip is on. */
export function showsCreativeDetails(modes: UploadModes): boolean {
  const normalized = normalizeUploadModes(modes);
  return normalized.whitelist || normalized.carousel || normalized.flexible;
}

export function modeSummary(modes: UploadModes): string {
  const normalized = normalizeUploadModes(modes);
  const structure = uploadStructure(normalized);
  const lead = structure === 'carousel'
    ? 'One carousel, 2–10 cards.'
    : structure === 'flexible'
      ? 'One flexible creative, up to 10 assets.'
      : `Each file is its own creative, up to ${BATCH_MAX_CREATIVES}. Original names are kept.`;
  if (!normalized.whitelist) return lead;
  return `${lead} Whitelist adds a usage end date.`;
}

export function structureCap(structure: UploadStructure): number {
  if (structure === 'carousel') return CAROUSEL_MAX_CARDS;
  if (structure === 'flexible') return FLEXIBLE_MAX_ASSETS;
  return BATCH_MAX_CREATIVES;
}

/** True when this row is past the structure cap. The file stays in the list. */
export function isOverStructureCap(structure: UploadStructure, index: number, total: number): boolean {
  const cap = structureCap(structure);
  return total > cap && index >= cap;
}

/**
 * Why a carousel or flexible list cannot submit.
 * A count of 0 is left to the "add a file" check.
 */
export function structureCapacityMessage(structure: UploadStructure, fileCount: number): string | null {
  if (structure === 'carousel') {
    if (fileCount > CAROUSEL_MAX_CARDS) {
      const extra = fileCount - CAROUSEL_MAX_CARDS;
      const noun = extra === 1 ? 'file is' : 'files are';
      const pronoun = extra === 1 ? 'it' : 'them';
      return `Carousel holds ${CAROUSEL_MAX_CARDS} cards. ${extra} ${noun} over the limit. Remove ${pronoun} or turn Carousel off.`;
    }
    if (fileCount > 0 && fileCount < CAROUSEL_MIN_CARDS) {
      return `A carousel needs at least ${CAROUSEL_MIN_CARDS} cards.`;
    }
  }
  if (structure === 'flexible' && fileCount > FLEXIBLE_MAX_ASSETS) {
    const extra = fileCount - FLEXIBLE_MAX_ASSETS;
    const noun = extra === 1 ? 'file is' : 'files are';
    const pronoun = extra === 1 ? 'it' : 'them';
    return `A flexible creative holds ${FLEXIBLE_MAX_ASSETS} assets. ${extra} ${noun} over the limit. Remove ${pronoun} or turn Flexible off.`;
  }
  if (structure === 'plain' && fileCount > BATCH_MAX_CREATIVES) {
    const extra = fileCount - BATCH_MAX_CREATIVES;
    const noun = extra === 1 ? 'file is' : 'files are';
    return `Up to ${BATCH_MAX_CREATIVES} creatives. ${extra} ${noun} over the limit.`;
  }
  return null;
}

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

export type ProductChoice = {
  product_key: string;
  product_label: string;
  product_kind: 'product' | 'homepage' | 'shop_all' | 'none';
};

/** Landing choices that are not a store product. Shown for every brand. */
export const GENERIC_LANDING_OPTIONS: ProductChoice[] = [
  { product_key: 'homepage', product_label: 'Homepage', product_kind: 'homepage' },
  { product_key: 'shop_all', product_label: 'Shop All', product_kind: 'shop_all' },
  { product_key: 'none', product_label: 'No landing page', product_kind: 'none' },
];

export const NO_PRODUCTS_SYNCED_NOTE = 'No products synced for this brand yet';

export type ShopifyProductRow = {
  title?: string | null;
  handle?: string | null;
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
};

export const SAMPLE_BRAND = 'Sample Brand';

/** Active shopify_products rows, in the order the query returned (title). Duplicate handles are dropped. */
export function mapProductRows(rows: readonly ShopifyProductRow[] | null | undefined): ProductChoice[] {
  const seen = new Set<string>();
  const products: ProductChoice[] = [];
  for (const row of rows ?? []) {
    const handle = row.handle?.trim() ?? '';
    if (!handle || seen.has(handle)) continue;
    seen.add(handle);
    const title = row.title?.trim() ?? '';
    products.push({
      product_key: `product:${handle}`,
      product_label: title || handle,
      product_kind: 'product',
    });
  }
  return products;
}

/** Synced products first, then the generic landing choices. */
export function productChoicesForBrand(rows: readonly ShopifyProductRow[] | null | undefined): ProductChoice[] {
  return [...mapProductRows(rows), ...GENERIC_LANDING_OPTIONS];
}

export function filterProductChoices(
  choices: readonly ProductChoice[],
  query: string,
  selectedLabel: string,
): ProductChoice[] {
  const trimmed = query.trim().toLowerCase();
  const showingAll = trimmed === '' || trimmed === selectedLabel.trim().toLowerCase();
  if (showingAll) return [...choices];
  return choices.filter((choice) => choice.product_label.toLowerCase().includes(trimmed));
}

/**
 * Typed name when the brand has no synced products.
 * An exact catalog label (including Homepage / Shop All / No landing page) is returned as that choice.
 * Anything else becomes a free-text product whose file slug is the typed name.
 * Null when the text is blank or has no filename-safe characters.
 */
export function freeTextProductChoice(
  query: string,
  catalog: readonly ProductChoice[],
): ProductChoice | null {
  const label = query.trim();
  if (!label) return null;
  const exact = catalog.find((choice) => choice.product_label.toLowerCase() === label.toLowerCase());
  if (exact) return exact;
  const slug = fileNameSlug(label);
  if (!slug) return null;
  return {
    product_key: `custom:${slug}`,
    product_label: label,
    product_kind: 'product',
  };
}

export function isCatalogProductKey(productKey: string): boolean {
  return productKey.startsWith('product:') || productKey.startsWith('custom:');
}

/** Drop a store or typed product when the brand changes. Generic landings stay. */
export function productAfterBrandChange(
  productKey: string,
  productLabel: string,
): { productKey: string; productLabel: string } {
  if (isCatalogProductKey(productKey)) return { productKey: '', productLabel: '' };
  return { productKey, productLabel };
}

/**
 * Combobox rows. Free text is appended only when `allowFreeText` is set
 * (no synced products, or the read failed) and the typed name is not already listed.
 */
export function visibleProductChoices(input: {
  catalog: readonly ProductChoice[];
  query: string;
  selectedLabel: string;
  allowFreeText: boolean;
}): ProductChoice[] {
  const filtered = filterProductChoices(input.catalog, input.query, input.selectedLabel);
  if (!input.allowFreeText) return filtered;
  const typed = input.query.trim();
  const showingAll = typed === '' || typed.toLowerCase() === input.selectedLabel.trim().toLowerCase();
  if (showingAll) return filtered;
  const custom = freeTextProductChoice(typed, input.catalog);
  if (!custom) return filtered;
  if (filtered.some((choice) => choice.product_key === custom.product_key && choice.product_label === custom.product_label)) {
    return filtered;
  }
  return [...filtered, custom];
}

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

/**
 * ISO week of the local calendar date. Week 1 contains the first Thursday.
 * The year is the ISO week-year (the Thursday's year), which can differ from the calendar year.
 */
export function isoWeekParts(date: Date): { year: number; week: number } {
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const year = utc.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil(((utc.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { year, week };
}

/** ISO week of the local calendar date (week 1 contains the first Thursday). */
export function isoWeekNumber(date: Date): number {
  return isoWeekParts(date).week;
}

export function weekFolderLabel(date = new Date()): string {
  return `Week ${isoWeekNumber(date)}`;
}

/**
 * Value for submissions.week_folder. Includes the ISO week-year so Week 1 in late December
 * is not filed under the previous calendar year. 2025-12-29 is 2026/Week 1.
 */
export function weekFolderStorageLabel(date = new Date()): string {
  const { year, week } = isoWeekParts(date);
  return `${year}/Week ${week}`;
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
    id: 'morning-reel',
    name: 'Morning reel',
    originalName: 'morning-reel.mp4',
    caption: 'A quiet morning, held for a beat. Placeholder caption only.',
    productKey: '',
    productLabel: '',
    angle: 'Morning ritual',
    handle: '@sample.creator',
    usageEndDate: '2026-12-31',
    perpetual: false,
    ratio: '9:16',
    kicker: 'Morning reel',
    from: '#E7C89A',
    to: '#6A4328',
    media: null,
    assets: [],
    cards: [
      card('morning-1', 'Open on the morning', 'The open', '#E7C89A', '#6A4328'),
      card('morning-2', 'Hold the frame', 'The hold', '#F0D7B4', '#8A5A32'),
      card('morning-3', 'Close on the table', 'The close', '#C8B89A', '#3E2A1C'),
    ],
  },
  {
    id: 'shelf-still',
    name: 'Shelf still',
    originalName: 'shelf-still.jpg',
    caption: 'The shelf we keep restocking. Sample caption, not a live ad.',
    productKey: '',
    productLabel: '',
    angle: 'Everyday use',
    handle: '@sample.cook',
    usageEndDate: '',
    perpetual: true,
    ratio: '4:5',
    kicker: 'The shelf',
    from: '#F3E6CF',
    to: '#8C7352',
    media: null,
    assets: [],
    cards: [
      card('shelf-1', 'The short list', 'Short list', '#F3E6CF', '#8C7352'),
      card('shelf-2', 'What stays in frame', 'In frame', '#E4D2B0', '#6E5840'),
      card('shelf-3', 'Restock the row', 'Restock', '#D9C4A4', '#4A3828'),
    ],
  },
  {
    id: 'homepage-still',
    name: 'Homepage still',
    originalName: 'homepage-still.jpg',
    caption: 'Homepage hero, held for a beat. Placeholder copy only.',
    productKey: '',
    productLabel: '',
    angle: 'Founder on camera',
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
      card('home-1', 'Open on the room', 'The room', '#D9D4CC', '#4E5550'),
      card('home-2', 'Then the product', 'Product', '#C9C3BA', '#3C433E'),
      card('home-3', 'Hold the last frame', 'Last frame', '#B7B1A8', '#2C312E'),
    ],
  },
  {
    id: 'first-look',
    name: 'First look',
    originalName: 'first-look.mp4',
    caption: 'First look, honest reaction. This creator is sample data.',
    productKey: '',
    productLabel: '',
    angle: 'Before and after week',
    handle: '@sample.ugc',
    usageEndDate: '',
    perpetual: true,
    ratio: '9:16',
    kicker: 'First look',
    from: '#F2C7A5',
    to: '#7A4B45',
    media: null,
    assets: [],
    cards: [
      card('look-1', 'The first look', 'First look', '#F2C7A5', '#7A4B45'),
      card('look-2', 'The face after', 'Reaction', '#E7B394', '#5C3834'),
      card('look-3', 'One more take', 'One more', '#D9A088', '#3E2824'),
    ],
  },
  {
    id: 'grid-still',
    name: 'Grid still',
    originalName: 'grid-still.jpg',
    caption: 'The full set, in one frame. Sample creative.',
    productKey: '',
    productLabel: '',
    angle: 'Gift set',
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
    productKey: '',
    productLabel: '',
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
      card('cut-2', 'Show the product', 'The product', '#B7C4EA', '#2E3858'),
      card('cut-3', 'Hold the end', 'The end', '#A3B2DE', '#242C44'),
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

/**
 * One plain creative for batch mode. Product, angle, handle, caption, and usage stay empty.
 * submissions.creator_name is NOT NULL and allows ''; the wiring phase must write ''.
 */
export function plainCreativeFromMedia(
  media: LocalMedia,
  index: number,
  makeId: (prefix: string) => string,
): Creative {
  const tone = CARD_TONES[index % CARD_TONES.length];
  const name = fileStem(media.name);
  const ratio = media.width && media.height
    ? nearestAspectRatio(media.width, media.height)
    : '9:16';
  return {
    id: makeId('creative'),
    name,
    originalName: media.name,
    caption: '',
    productKey: '',
    productLabel: '',
    angle: '',
    handle: '',
    usageEndDate: '',
    perpetual: false,
    ratio,
    kicker: name,
    from: tone[0],
    to: tone[1],
    media,
    assets: [],
    cards: [],
  };
}

/** Replace the file on a batch creative and snap the preview frame to that file. */
export function replaceBatchMedia(creative: Creative, media: LocalMedia): Creative {
  const name = fileStem(media.name);
  const ratio = media.width && media.height
    ? nearestAspectRatio(media.width, media.height)
    : creative.ratio;
  return {
    ...creative,
    name,
    originalName: media.name,
    kicker: name,
    ratio,
    media,
  };
}

/** Append plain creatives, one per file, and stop at BATCH_MAX_CREATIVES. */
export function appendBatchCreatives(
  creatives: Creative[],
  incoming: LocalMedia[],
  makeId: (prefix: string) => string,
): { creatives: Creative[]; placed: number; leftover: number; firstNewIndex: number } {
  const room = Math.max(0, BATCH_MAX_CREATIVES - creatives.length);
  const placedMedia = incoming.slice(0, room);
  const added = placedMedia.map((media, offset) => (
    plainCreativeFromMedia(media, creatives.length + offset, makeId)
  ));
  return {
    creatives: [...creatives, ...added],
    placed: added.length,
    leftover: incoming.length - added.length,
    firstNewIndex: creatives.length,
  };
}

/** Plain creatives from files already on the card. Used when a structure chip is turned off. */
export function creativesFromMedia(
  media: readonly LocalMedia[],
  makeId: (prefix: string) => string,
): Creative[] {
  return media.map((item, index) => plainCreativeFromMedia(item, index, makeId));
}

/** Every file becomes a card, including files past the 10-card cap. */
export function cardsFromMedia(
  media: readonly LocalMedia[],
  previous: readonly CarouselCard[],
  makeId: (prefix: string) => string,
): CarouselCard[] {
  const byUrl = new Map<string, CarouselCard>();
  for (const card of previous) {
    if (card.media?.url && !byUrl.has(card.media.url)) byUrl.set(card.media.url, card);
  }
  return media.map((item, index) => {
    const prev = byUrl.get(item.url);
    const tone = CARD_TONES[index % CARD_TONES.length];
    return {
      id: prev?.id ?? makeId('card'),
      headline: prev?.headline ?? '',
      kicker: prev?.kicker || fileStem(item.name),
      from: prev?.from ?? tone[0],
      to: prev?.to ?? tone[1],
      media: item,
    };
  });
}

/** Every file becomes an asset, including files past the 10-asset cap. */
export function assetsFromMedia(
  media: readonly LocalMedia[],
  previous: readonly FlexibleAsset[],
  makeId: (prefix: string) => string,
): FlexibleAsset[] {
  const byUrl = new Map<string, FlexibleAsset>();
  for (const asset of previous) {
    if (asset.media.url && !byUrl.has(asset.media.url)) byUrl.set(asset.media.url, asset);
  }
  return media.map((item) => {
    const prev = byUrl.get(item.url);
    return { id: prev?.id ?? makeId('asset'), media: item };
  });
}

export function attachedMedia(items: readonly { media: LocalMedia | null }[]): LocalMedia[] {
  return items.flatMap((item) => (item.media ? [item.media] : []));
}

export function emptyCreative(ratio: AspectRatio = '9:16'): Creative {
  return {
    id: 'empty',
    name: '',
    originalName: '',
    caption: '',
    productKey: '',
    productLabel: '',
    angle: '',
    handle: '',
    usageEndDate: '',
    perpetual: false,
    ratio,
    kicker: '',
    from: '#2C2C2C',
    to: '#141414',
    media: null,
    assets: [],
    cards: [],
  };
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
 * The type word is the selected structure, or whitelist when that chip is the only one on.
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

/** Single-creative modes. A new name is built only when creator, product, or angle has a usable part. */
export function previewCreativeFileName(
  creative: Creative,
  creatorName: string,
  creativeType: CreativeType,
  shownName: string | null,
): FileNamePreview {
  const draft = nameDraft(creative, creatorName, creativeType, shownName);
  if (!draft.renamed) {
    return { fileName: draft.original, renamed: false, label: 'Original name kept' };
  }
  return { fileName: `${draft.stem}${draft.extension}`, renamed: true, label: 'Renamed from inputs' };
}

/** Batch mode keeps every uploaded file name. Creator, product, and angle are not collected. */
export function batchFileNamePreview(creative: Creative): FileNamePreview {
  return {
    fileName: sourceFileName(creative, null),
    renamed: false,
    label: 'Original name kept',
  };
}
