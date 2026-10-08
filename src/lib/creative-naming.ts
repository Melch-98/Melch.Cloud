import { CREATIVE_TYPES_MAP } from '@/lib/creative-types';

/**
 * Default Dropbox filename pattern.
 * Unknown segments are left out. Creator is included only when someone typed a name.
 */
export const DEFAULT_FILE_NAMING_PATTERN =
  '{Brand}_{Product}_{HookSlug}_{Type}_{CreatorOrUGC}_{AspectOrLength}';

const LEGAL_SUFFIXES = new Set(['co', 'inc', 'llc', 'ltd', 'company', 'corp']);

export interface CreativeNameInput {
  brandName?: string | null;
  brandSlug?: string | null;
  productName?: string | null;
  hookAngle?: string | null;
  /** A CREATIVE_TYPES_MAP value. Unknown values are omitted. */
  creativeType?: string | null;
  creatorName?: string | null;
  aspectRatio?: string | null;
  durationSeconds?: number | null;
  mediaFormat?: string | null;
  originalFileName: string;
  pattern?: string | null;
}

export interface BatchNameItem extends CreativeNameInput {
  /** When set, this name is kept (made filesystem-safe and unique). */
  customFileName?: string | null;
}

export function fileExtension(fileName: string): string {
  const base = fileName.split(/[/\\]/).pop() || fileName;
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return '';
  const ext = base.slice(dot);
  if (!/^\.[A-Za-z0-9]{1,8}$/.test(ext)) return '';
  return ext;
}

function wordsOf(input: string): string[] {
  return input
    .replace(/&/g, ' And ')
    .replace(/[→>/|]+/g, ' ')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
}

function pascal(words: string[]): string {
  return words
    .map((w) => {
      if (/^\d+$/.test(w)) return w;
      if (/[A-Z]/.test(w.slice(1))) {
        return w.charAt(0).toUpperCase() + w.slice(1);
      }
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join('')
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, 48);
}

export function brandSegment(name?: string | null, slug?: string | null): string {
  const source = (slug && slug.trim()) || (name && name.trim()) || '';
  if (!source) return '';
  const words = wordsOf(source).filter((w) => !LEGAL_SUFFIXES.has(w.toLowerCase()));
  return pascal(words.slice(0, 3));
}

export function productSegment(productName?: string | null, brandName?: string | null): string {
  if (!productName || !productName.trim()) return '';
  if (productName.trim().toLowerCase() === 'brand / general') return '';
  let words = wordsOf(productName);
  const brandWords = new Set(wordsOf(brandName || '').map((w) => w.toLowerCase()));
  if (brandWords.size && words.length > 1) {
    const stripped = words.filter((w) => !brandWords.has(w.toLowerCase()));
    if (stripped.length) words = stripped;
  }
  return pascal(words.slice(0, 3));
}

export function hookSegment(hook?: string | null): string {
  if (!hook || !hook.trim()) return '';
  const words = wordsOf(hook).slice(0, 4);
  if (!words.length) return '';
  return pascal(words);
}

export function typeSegment(creativeType?: string | null): string {
  if (!creativeType || !creativeType.trim()) return '';
  const info = CREATIVE_TYPES_MAP.get(creativeType);
  if (!info) return '';
  const withoutParen = info.label.replace(/\([^)]*\)/g, ' ');
  return pascal(wordsOf(withoutParen).slice(0, 4));
}

export function creatorSegment(creator?: string | null): string {
  if (!creator || !creator.trim()) return '';
  return pascal(wordsOf(creator.replace(/^@/, '')).slice(0, 3));
}

export function aspectSegment(input: {
  aspectRatio?: string | null;
  durationSeconds?: number | null;
  mediaFormat?: string | null;
}): string {
  const format = (input.mediaFormat || '').toUpperCase();
  const duration = input.durationSeconds;
  if (
    format !== 'STATIC' &&
    typeof duration === 'number' &&
    Number.isFinite(duration) &&
    duration > 0
  ) {
    return `${Math.max(1, Math.round(duration))}s`;
  }
  const ratio = (input.aspectRatio || '').toLowerCase();
  if (ratio === '1x1' || ratio === '9x16' || ratio === '4x5' || ratio === '16x9') return ratio;
  return '';
}

type SegmentKey =
  | 'Brand'
  | 'Product'
  | 'HookSlug'
  | 'Type'
  | 'CreatorOrUGC'
  | 'AspectOrLength';

const TOKEN_ALIASES: Record<string, SegmentKey> = {
  Brand: 'Brand',
  Product: 'Product',
  HookSlug: 'HookSlug',
  Hook: 'HookSlug',
  Type: 'Type',
  CreatorOrUGC: 'CreatorOrUGC',
  Creator: 'CreatorOrUGC',
  AspectOrLength: 'AspectOrLength',
  Aspect: 'AspectOrLength',
};

function segmentsFor(input: CreativeNameInput): Record<SegmentKey, string> {
  return {
    Brand: brandSegment(input.brandName, input.brandSlug),
    Product: productSegment(input.productName, input.brandName),
    HookSlug: hookSegment(input.hookAngle),
    Type: typeSegment(input.creativeType),
    CreatorOrUGC: creatorSegment(input.creatorName),
    AspectOrLength: aspectSegment(input),
  };
}

function applyPattern(pattern: string, segs: Record<SegmentKey, string>): string {
  let out = pattern;
  for (const [token, key] of Object.entries(TOKEN_ALIASES)) {
    out = out.split(`{${token}}`).join(segs[key] || '');
  }
  out = out.replace(/\{[A-Za-z0-9]+\}/g, '');
  out = out.replace(/\s+/g, '_');
  out = out.replace(/[_\-\s.]{2,}/g, (m) => (m.includes('_') ? '_' : m[0] === '-' ? '-' : ''));
  out = out.replace(/^[_\-\s.]+|[_\-\s.]+$/g, '');
  out = out.replace(/[^A-Za-z0-9_\-]/g, '');
  out = out.replace(/_+/g, '_').replace(/^_|_$/g, '');
  return out;
}

/** One file name from tags. Omits any segment that is missing. Keeps the original extension. */
export function buildCreativeFileName(input: CreativeNameInput): string {
  const ext = fileExtension(input.originalFileName);
  const pattern =
    input.pattern && input.pattern.includes('{')
      ? input.pattern
      : DEFAULT_FILE_NAMING_PATTERN;
  let stem = applyPattern(pattern, segmentsFor(input));
  if (!stem) {
    const raw = (input.originalFileName.split(/[/\\]/).pop() || 'file').replace(/\.[^.]+$/, '');
    stem = pascal(wordsOf(raw)) || 'File';
  }
  return `${stem}${ext}`;
}

/** A name someone typed, stripped to characters Dropbox and a filesystem will accept. */
export function sanitizeUserFileName(name: string, originalFileName: string): string {
  const ext = fileExtension(originalFileName) || fileExtension(name);
  const raw = name.trim();
  const withoutExt =
    ext && raw.toLowerCase().endsWith(ext.toLowerCase())
      ? raw.slice(0, raw.length - ext.length)
      : raw.replace(/\.[A-Za-z0-9]{1,8}$/, '');
  const cleaned = withoutExt
    .replace(/[\\/:*?"<>|]+/g, '')
    .replace(/\s+/g, '')
    .replace(/[^A-Za-z0-9_\-]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  return `${cleaned || 'File'}${ext}`;
}

export function uniqueCreativeFileName(desired: string, taken: Set<string>): string {
  const ext = fileExtension(desired);
  const stem = desired.slice(0, desired.length - ext.length);
  if (!taken.has(desired.toLowerCase())) return desired;
  const base = stem.replace(/_v\d+$/i, '');
  let n = 2;
  while (taken.has(`${base}_v${n}${ext}`.toLowerCase())) n += 1;
  return `${base}_v${n}${ext}`;
}

/**
 * Names for a batch. Custom (hand-edited) names are reserved first.
 * Collisions get _v2, _v3 before the extension.
 */
export function assignCreativeFileNames(items: BatchNameItem[]): string[] {
  const taken = new Set<string>();
  const custom = items.map((item) => {
    if (!item.customFileName || !item.customFileName.trim()) return null;
    return sanitizeUserFileName(item.customFileName, item.originalFileName);
  });
  const out: Array<string | null> = custom.map((name) => {
    if (!name) return null;
    const unique = uniqueCreativeFileName(name, taken);
    taken.add(unique.toLowerCase());
    return unique;
  });
  items.forEach((item, i) => {
    if (out[i]) return;
    const unique = uniqueCreativeFileName(buildCreativeFileName(item), taken);
    taken.add(unique.toLowerCase());
    out[i] = unique;
  });
  return out.map((n, i) => n || buildCreativeFileName(items[i]));
}
