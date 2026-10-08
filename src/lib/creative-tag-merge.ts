import type { FileContext } from '@/lib/types';
import type { AcceptedAutoTag } from '@/lib/creative-auto-tag';

export const AI_LOCK_FIELDS = [
  'creativeType',
  'productId',
  'hookAngle',
  'landingPageUrl',
  'fileName',
] as const;

export type AiLockField = (typeof AI_LOCK_FIELDS)[number];

export type AutoFilledField = 'creativeType' | 'productId' | 'hookAngle' | 'landingPageUrl';

/**
 * Apply a model result onto one file.
 * Fields the user already edited (lockedFields) are left alone.
 */
export function mergeAutoTagIntoContext(
  ctx: Partial<FileContext> | undefined,
  tag: AcceptedAutoTag,
  autoTags?: Record<string, unknown> | null
): FileContext {
  const current: FileContext = {
    landingPageUrl: '',
    copyHeadline: '',
    copyBody: '',
    copyCta: '',
    productId: '',
    productName: '',
    creativeType: '',
    hookAngle: '',
    copyTemplate: '',
    creatorName: '',
    creatorHandle: '',
    ...(ctx || {}),
  };
  const locked = current.lockedFields || {};
  const auto = new Set(current.autoFilled || []);

  if (!locked.creativeType && tag.creative_type) {
    current.creativeType = tag.creative_type;
    auto.add('creativeType');
  }
  if (!locked.productId && tag.product_id) {
    current.productId = tag.product_id;
    current.productName = tag.product_name || '';
    auto.add('productId');
  }
  if (!locked.hookAngle && tag.hook_angle) {
    current.hookAngle = tag.hook_angle;
    auto.add('hookAngle');
  }
  if (!locked.landingPageUrl && tag.landing_page_url) {
    current.landingPageUrl = tag.landing_page_url;
    auto.add('landingPageUrl');
  }

  current.autoFilled = Array.from(auto);
  current.tagStatus = 'done';
  current.autoTags = autoTags ?? current.autoTags ?? null;
  return current;
}

export function tagSourceForContext(
  ctx: Partial<FileContext> | undefined
): 'ai' | 'user' | 'mixed' | 'pending' | null {
  const locked = ctx?.lockedFields || {};
  const userTouched = Boolean(
    locked.creativeType || locked.productId || locked.hookAngle || locked.landingPageUrl
  );
  const hasAuto = (ctx?.autoFilled || []).length > 0;
  if (ctx?.tagStatus === 'skipped') return userTouched ? 'user' : null;
  if (ctx?.tagStatus !== 'done') return 'pending';
  if (userTouched && hasAuto) return 'mixed';
  if (userTouched) return 'user';
  return 'ai';
}

const USER_LOCK_FROM_KEY: Partial<
  Record<keyof FileContext, 'creativeType' | 'productId' | 'hookAngle' | 'landingPageUrl' | 'fileName'>
> = {
  creativeType: 'creativeType',
  productId: 'productId',
  hookAngle: 'hookAngle',
  landingPageUrl: 'landingPageUrl',
  customFileName: 'fileName',
};

/**
 * A person edited the form. Those fields stay locked so a late model result cannot overwrite them.
 * Pass lockFields when one edit should lock only some of the keys in `updates`
 * (a product change may fill the landing page without locking it).
 */
export function applyUserContextPatch(
  current: Partial<FileContext> | undefined,
  updates: Partial<FileContext>,
  lockFields?: Array<'creativeType' | 'productId' | 'hookAngle' | 'landingPageUrl' | 'fileName'>
): FileContext {
  const base: FileContext = {
    landingPageUrl: '',
    copyHeadline: '',
    copyBody: '',
    copyCta: '',
    productId: '',
    productName: '',
    creativeType: '',
    hookAngle: '',
    copyTemplate: '',
    creatorName: '',
    creatorHandle: '',
    ...(current || {}),
  };
  const next: FileContext = { ...base, ...updates };
  const locked = { ...(base.lockedFields || {}) };
  const auto = new Set(base.autoFilled || []);
  const keys =
    lockFields ??
    (Object.keys(updates) as (keyof FileContext)[])
      .map((key) => USER_LOCK_FROM_KEY[key])
      .filter((key): key is NonNullable<typeof key> => Boolean(key));
  for (const key of keys) {
    locked[key] = true;
    if (key !== 'fileName') auto.delete(key as AutoFilledField);
  }
  next.lockedFields = locked;
  next.autoFilled = Array.from(auto);
  return next;
}
