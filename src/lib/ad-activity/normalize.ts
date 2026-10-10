import { createHash } from 'crypto';
import { formatInTimeZone, zonedLocalToUtc } from '@/lib/ad-activity/windows';

export type ActivityPlatform = 'meta' | 'google';

export type ChangeType =
  | 'budget'
  | 'bid_or_target'
  | 'status'
  | 'created'
  | 'removed'
  | 'creative'
  | 'targeting'
  | 'name'
  | 'other';

export interface NormalizedActivity {
  event_key: string;
  platform: ActivityPlatform;
  occurred_at: string;
  actor: string | null;
  tool: string | null;
  object_type: string | null;
  object_id: string | null;
  object_name: string | null;
  campaign_name: string | null;
  change_type: ChangeType;
  old_value: string | null;
  new_value: string | null;
  summary: string;
  is_system: boolean;
  raw: unknown;
}

export interface MetaActivity {
  event_type?: string;
  event_time?: string | number;
  actor_name?: string;
  actor_id?: string;
  application_name?: string;
  object_id?: string;
  object_name?: string;
  object_type?: string;
  extra_data?: unknown;
  translated_event_type?: string;
  date_time_in_timezone?: string;
}

const ZERO_DECIMAL = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF',
  'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
]);
const THREE_DECIMAL = new Set(['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND']);

const META_FIELDS = [
  'event_type',
  'event_time',
  'actor_name',
  'actor_id',
  'application_name',
  'object_id',
  'object_name',
  'object_type',
  'extra_data',
  'translated_event_type',
  'date_time_in_timezone',
] as const;

export function metaActivityFields(): string {
  return META_FIELDS.join(',');
}

export const GOOGLE_CHANGE_EVENT_FIELDS = [
  'change_event.resource_name',
  'change_event.change_date_time',
  'change_event.change_resource_name',
  'change_event.user_email',
  'change_event.client_type',
  'change_event.change_resource_type',
  'change_event.resource_change_operation',
  'change_event.changed_fields',
  'change_event.old_resource',
  'change_event.new_resource',
  'change_event.campaign',
  'change_event.ad_group',
  'campaign.name',
  'ad_group.name',
];

export function googleChangeEventQuery(startLocal: string, endLocal: string): string {
  return [
    `SELECT ${GOOGLE_CHANGE_EVENT_FIELDS.join(', ')}`,
    'FROM change_event',
    `WHERE change_event.change_date_time >= '${startLocal}' AND change_event.change_date_time <= '${endLocal}'`,
    'ORDER BY change_event.change_date_time',
    'LIMIT 1000',
  ].join(' ');
}

type Dict = Record<string, unknown>;

function isDict(value: unknown): value is Dict {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (isDict(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function hashEventKey(parts: Array<string | number | null | undefined>): string {
  const payload = parts.map((part) => (part == null ? '' : String(part))).join('\u001f');
  return createHash('sha256').update(payload).digest('hex').slice(0, 40);
}

function minorExponent(currency: string): number {
  const code = currency.toUpperCase();
  if (THREE_DECIMAL.has(code)) return 3;
  if (ZERO_DECIMAL.has(code)) return 0;
  return 2;
}

export function minorToMajor(minor: number, currency: string): number {
  return minor / 10 ** minorExponent(currency);
}

export function formatMoney(major: number, currency: string | null | undefined): string {
  const code = (currency || '').toUpperCase();
  const negative = major < 0;
  const abs = Math.abs(major);
  const whole = Math.abs(abs - Math.round(abs)) < 1e-6;
  const text = whole ? String(Math.round(abs)) : abs.toFixed(2);
  const signed = negative ? `-${text}` : text;
  if (!code) return signed;
  if (code === 'USD') return `$${signed}`;
  return `${code} ${signed}`;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim())) return Number(value.trim());
  return null;
}

function findCurrency(node: unknown, depth = 0): string | null {
  if (!isDict(node) || depth > 4) return null;
  const direct = node.currency;
  if (typeof direct === 'string' && /^[A-Za-z]{3}$/.test(direct)) return direct.toUpperCase();
  for (const value of Object.values(node)) {
    const found = findCurrency(value, depth + 1);
    if (found) return found;
  }
  return null;
}

function unwrapSide(node: unknown, side: 'old' | 'new', depth = 0): unknown {
  if (!isDict(node) || depth > 5) return node;
  const key = side === 'old' ? 'old_value' : 'new_value';
  if (key in node) return unwrapSide(node[key], side, depth + 1);
  return node;
}

function periodFrom(node: unknown): 'day' | 'lifetime' | null {
  const text = stableStringify(node).toLowerCase();
  if (text.includes('lifetime')) return 'lifetime';
  if (text.includes('daily') || text.includes('per day') || text.includes('/day')) return 'day';
  return null;
}

export interface ExtractedValues {
  oldRaw: unknown;
  newRaw: unknown;
  currency: string | null;
  period: 'day' | 'lifetime' | null;
}

export function extractExtra(extra: unknown): ExtractedValues {
  const root = parseJson(extra);
  if (!isDict(root)) {
    return { oldRaw: null, newRaw: null, currency: null, period: null };
  }
  return {
    oldRaw: 'old_value' in root ? unwrapSide(root.old_value, 'old') : null,
    newRaw: 'new_value' in root ? unwrapSide(root.new_value, 'new') : null,
    currency: findCurrency(root),
    period: periodFrom(root),
  };
}

function titleStatus(value: string): string {
  const known: Record<string, string> = {
    ACTIVE: 'Active',
    PAUSED: 'Paused',
    ENABLED: 'Enabled',
    REMOVED: 'Removed',
    ARCHIVED: 'Archived',
    DELETED: 'Deleted',
    PENDING_REVIEW: 'Pending review',
    DISAPPROVED: 'Disapproved',
    PREAPPROVED: 'Preapproved',
    CAMPAIGN_PAUSED: 'Paused (campaign)',
    ADSET_PAUSED: 'Paused (ad set)',
  };
  const upper = value.trim().toUpperCase();
  if (known[upper]) return known[upper];
  if (/^[A-Z0-9_]+$/.test(value.trim())) {
    return value
      .trim()
      .toLowerCase()
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }
  return value.trim();
}

function displayScalar(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? titleStatus(trimmed) : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  return null;
}

function typeLabel(objectType: string | null | undefined): string {
  const text = (objectType || '').toLowerCase().replace(/_/g, ' ');
  if (text.includes('campaign budget')) return 'campaign';
  if (text.includes('ad group ad') || text === 'ad') return 'ad';
  if (text.includes('ad group') || text.includes('adgroup')) return 'ad group';
  if (text.includes('adset') || text.includes('ad set')) return 'ad set';
  if (text.includes('campaign')) return 'campaign';
  if (text.includes('creative')) return 'creative';
  return text || 'item';
}

export function objectPhrase(
  objectType: string | null | undefined,
  objectName: string | null | undefined,
  campaignName: string | null | undefined
): string {
  const label = typeLabel(objectType);
  const name = (label === 'campaign' ? campaignName || objectName : objectName || campaignName) || 'untitled';
  if (label === 'campaign') {
    if (/\bcampaign\b/i.test(name)) return name;
    return `campaign ${name}`;
  }
  if (campaignName && campaignName !== name) return `${label} ${name} in ${campaignName}`;
  return `${label} ${name}`;
}

function toolSuffix(tool: string | null): string {
  return tool ? ` (${tool})` : '';
}

const GOOGLE_CLIENTS: Record<string, string> = {
  GOOGLE_ADS_WEB_CLIENT: 'Google Ads',
  GOOGLE_ADS_EDITOR: 'Google Ads Editor',
  GOOGLE_ADS_MOBILE_APP: 'Google Ads app',
  GOOGLE_ADS_API: 'Google Ads API',
  GOOGLE_ADS_SCRIPTS: 'Google Ads scripts',
  GOOGLE_ADS_AUTOMATED_RULE: 'automated rule',
  GOOGLE_ADS_BULK_UPLOAD: 'bulk upload',
  GOOGLE_ADS_RECOMMENDATIONS: 'recommendations',
  GOOGLE_ADS_RECOMMENDATIONS_SUBSCRIPTION: 'recommendations',
  SEARCH_ADS_360: 'Search Ads 360',
};

export function googleClientLabel(clientType: string | null | undefined): string | null {
  if (!clientType) return null;
  const key = clientType.trim().toUpperCase();
  return GOOGLE_CLIENTS[key] || clientType.trim().replace(/_/g, ' ').toLowerCase();
}

export function metaIsSystem(eventType: string, translated?: string | null): boolean {
  const type = eventType.toLowerCase();
  const words = (translated || '').toLowerCase();
  if (type.includes('first_delivery') || words.includes('first delivery')) return true;
  if (type.includes('ad_review') || type.includes('review_')) return true;
  if (type.includes('billing') || words.includes('billing')) return true;
  if (type.includes('funding')) return true;
  if (type.includes('spend_limit')) return true;
  return false;
}

export function classifyMeta(eventType: string): ChangeType {
  const type = eventType.toLowerCase();
  if (type.includes('billing') || type.includes('funding') || type.includes('spend_limit') || type.includes('first_delivery')) {
    return 'other';
  }
  if (type.startsWith('create_') || type.includes('create_campaign') || type.includes('create_ad')) return 'created';
  if (
    type.startsWith('delete') ||
    type.includes('archive') ||
    (type.includes('remove_') && !type.includes('spend_limit'))
  ) {
    return 'removed';
  }
  if (type.includes('budget') || type.includes('spend_cap') || type.includes('min_spend')) return 'budget';
  if (type.includes('bid') || type.includes('roas') || type.includes('optimization_goal')) return 'bid_or_target';
  if (type.includes('run_status') || type.includes('status') || type.includes('review')) return 'status';
  if (type.includes('creative')) return 'creative';
  if (type.includes('target') || type.includes('audience') || type.includes('placement')) return 'targeting';
  if (type.includes('name')) return 'name';
  return 'other';
}

function moneyPair(
  oldMinor: number,
  newMinor: number,
  currency: string,
  period: 'day' | 'lifetime' | null
): { oldText: string; newText: string; span: string; verb: 'raised' | 'cut' | 'set' } {
  const oldMajor = minorToMajor(oldMinor, currency);
  const newMajor = minorToMajor(newMinor, currency);
  const oldText = formatMoney(oldMajor, currency);
  const newText = formatMoney(newMajor, currency);
  const suffix = period === 'lifetime' ? ' lifetime' : '/day';
  let verb: 'raised' | 'cut' | 'set' = 'set';
  if (newMajor > oldMajor + 0.001) verb = 'raised';
  else if (newMajor < oldMajor - 0.001) verb = 'cut';
  return { oldText, newText, span: `from ${oldText} to ${newText}${suffix}`, verb };
}

function microsToMajor(micros: number): number {
  return micros / 1_000_000;
}

export function metaEventKey(accountId: string, event: MetaActivity): string {
  const extra = parseJson(event.extra_data);
  const digest = hashEventKey([
    'meta',
    accountId,
    event.event_time ?? '',
    event.event_type ?? '',
    event.object_id ?? '',
    event.actor_id ?? '',
    stableStringify(extra ?? null),
  ]);
  return `meta:${accountId}:${digest}`;
}

/** Graph `event_time` is an ISO string. Numeric unix seconds still parse. */
export function metaEventTime(value: unknown): Date | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    const ms = value > 10_000_000_000 ? value : value * 1000;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d+(\.\d+)?$/.test(trimmed)) return metaEventTime(Number(trimmed));
  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function oldestMetaEventMs(events: Array<{ event_time?: string | number }>): number | null {
  let oldest: number | null = null;
  for (const event of events) {
    const time = metaEventTime(event.event_time);
    if (!time) continue;
    const ms = time.getTime();
    if (oldest == null || ms < oldest) oldest = ms;
  }
  return oldest;
}

export function normalizeMetaActivity(
  event: MetaActivity,
  ctx: { accountId: string; currency: string | null }
): NormalizedActivity | null {
  const eventType = (event.event_type || '').trim();
  if (!eventType) return null;
  const occurred = metaEventTime(event.event_time);
  if (!occurred) return null;

  const extracted = extractExtra(event.extra_data);
  const currency = extracted.currency || (ctx.currency ? ctx.currency.toUpperCase() : null) || 'USD';
  const changeType = classifyMeta(eventType);
  const isSystem = metaIsSystem(eventType, event.translated_event_type);
  const actor = (event.actor_name || '').trim() || (isSystem ? 'Meta' : 'Someone');
  const tool = (event.application_name || '').trim() || null;
  const phrase = objectPhrase(event.object_type, event.object_name, null);
  const oldNum = asNumber(extracted.oldRaw);
  const newNum = asNumber(extracted.newRaw);
  const moneyChange = changeType === 'budget' || changeType === 'bid_or_target';

  let oldValue = displayScalar(extracted.oldRaw);
  let newValue = displayScalar(extracted.newRaw);
  let summary: string;

  if (moneyChange && oldNum != null && newNum != null) {
    const pair = moneyPair(oldNum, newNum, currency, extracted.period);
    oldValue = pair.oldText;
    newValue = pair.newText;
    const noun = changeType === 'budget' ? 'budget' : 'bid';
    summary = `${actor} ${pair.verb} ${noun} on ${phrase} ${pair.span}${toolSuffix(tool)}`;
  } else if (changeType === 'status' && (oldValue || newValue)) {
    summary = `${actor} changed status on ${phrase} from ${oldValue || 'unknown'} to ${newValue || 'unknown'}${toolSuffix(tool)}`;
  } else if (changeType === 'created') {
    summary = `${actor} created ${phrase}${toolSuffix(tool)}`;
  } else if (changeType === 'removed') {
    summary = `${actor} removed ${phrase}${toolSuffix(tool)}`;
  } else if (changeType === 'name' && (oldValue || newValue)) {
    summary = `${actor} renamed ${phrase} from ${oldValue || 'unknown'} to ${newValue || 'unknown'}${toolSuffix(tool)}`;
  } else if (changeType === 'creative') {
    summary = `${actor} updated the creative on ${phrase}${toolSuffix(tool)}`;
  } else if (changeType === 'targeting') {
    summary = `${actor} updated targeting on ${phrase}${toolSuffix(tool)}`;
  } else if (isSystem) {
    const what = (event.translated_event_type || eventType.replace(/_/g, ' ')).trim();
    summary = `${actor}: ${what} on ${phrase}${toolSuffix(tool)}`;
  } else {
    const what = (event.translated_event_type || eventType.replace(/_/g, ' ')).trim();
    summary = `${actor} updated ${phrase}${toolSuffix(tool)}: ${what}`;
  }

  return {
    event_key: metaEventKey(ctx.accountId, event),
    platform: 'meta',
    occurred_at: occurred.toISOString(),
    actor,
    tool,
    object_type: event.object_type || null,
    object_id: event.object_id ? String(event.object_id) : null,
    object_name: event.object_name || null,
    campaign_name: typeLabel(event.object_type) === 'campaign' ? event.object_name || null : null,
    change_type: changeType,
    old_value: oldValue,
    new_value: newValue,
    summary,
    is_system: isSystem,
    raw: stripSecrets(event),
  };
}

function dig(root: unknown, paths: string[][]): unknown {
  for (const path of paths) {
    let cur: unknown = root;
    let ok = true;
    for (const key of path) {
      if (!isDict(cur) || !(key in cur)) {
        ok = false;
        break;
      }
      cur = cur[key];
    }
    if (ok && cur != null) return cur;
  }
  return undefined;
}

function rowDict(row: unknown): Dict {
  return isDict(row) ? row : {};
}

function changeEventOf(row: Dict): Dict {
  const event = row.changeEvent ?? row.change_event ?? row;
  return isDict(event) ? event : {};
}

export function changedFieldPaths(fields: unknown): string[] {
  if (!fields) return [];
  if (typeof fields === 'string') {
    return fields.split(',').map((part) => part.trim()).filter(Boolean);
  }
  if (Array.isArray(fields)) return fields.map((part) => String(part));
  if (isDict(fields) && Array.isArray(fields.paths)) return fields.paths.map((part) => String(part));
  return [];
}

function resourceNameId(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  const parts = value.split('/');
  return parts[parts.length - 1] || null;
}

function readMicros(resource: unknown, paths: string[][]): number | null {
  const value = dig(resource, paths);
  return asNumber(value);
}

export function classifyGoogle(operation: string, resourceType: string, fields: string[]): ChangeType {
  const op = operation.toUpperCase();
  if (op === 'CREATE') return 'created';
  if (op === 'REMOVE') return 'removed';
  const joined = `${resourceType} ${fields.join(' ')}`.toLowerCase();
  if (joined.includes('amount_micros') || joined.includes('amountmicros') || resourceType.toUpperCase() === 'CAMPAIGN_BUDGET') {
    if (fields.length === 0 || joined.includes('amount')) return 'budget';
  }
  if (/bid|target_cpa|target_roas|cpc_bid/.test(joined)) return 'bid_or_target';
  if (joined.includes('status')) return 'status';
  if (joined.includes('name') && !joined.includes('resource_name')) return 'name';
  if (resourceType.toUpperCase() === 'AD' || joined.includes('ad.final') || joined.includes('creative')) return 'creative';
  if (/criterion|keyword|geo|audience|placement|targeting/.test(joined)) return 'targeting';
  if (resourceType.toUpperCase() === 'CAMPAIGN_BUDGET') return 'budget';
  return 'other';
}

export function googleIsSystem(clientType: string | null, userEmail: string | null): boolean {
  const client = (clientType || '').toUpperCase();
  if (client.includes('RECOMMENDATION')) return true;
  if (!userEmail && client.includes('AUTOMATED')) return true;
  return false;
}

export function googleEventKey(customerId: string, resourceName: string | null, fallback: string): string {
  if (resourceName) return `google:${customerId}:${resourceName}`;
  return `google:${customerId}:${fallback}`;
}

export function googleChangeOccurredMs(row: unknown, timeZone: string): number | null {
  const event = changeEventOf(rowDict(row));
  const when = String(event.changeDateTime ?? event.change_date_time ?? '');
  if (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(when)) return null;
  const local = when.replace('T', ' ').slice(0, 19);
  const occurred = zonedLocalToUtc(local, timeZone);
  return Number.isNaN(occurred.getTime()) ? null : occurred.getTime();
}

/**
 * Where to leave last_success_at after a pull.
 * Meta pages newest-first, so unsaved events are older than the oldest row
 * fetched. A truncated Meta pull leaves the bookmark where it is
 * (lastSuccessAt null) and keeps the page-cap error. Google is ascending, so
 * a truncated pull bookmarks the last row's timestamp and the next query
 * starts at that same second. Zero parsed rows do not move it.
 */
export function platformSyncBookmark(opts: {
  platform: 'meta' | 'google';
  windowUntilMs: number;
  rawCount: number;
  parsedCount: number;
  truncated?: boolean;
  oldestFetchedMs?: number | null;
}): { lastSuccessAt: string | null; error: string | null } {
  if (opts.rawCount > 0 && opts.parsedCount === 0) {
    const label = opts.platform === 'meta' ? 'Meta' : 'Google';
    const noun = opts.platform === 'meta' ? 'activities' : 'change events';
    return {
      lastSuccessAt: null,
      error: `${label}: ${opts.rawCount} ${noun} returned, 0 parsed`,
    };
  }
  if (opts.truncated) {
    if (opts.platform === 'meta') {
      return {
        lastSuccessAt: null,
        error: 'Meta activity page cap reached; some older events in this window were not saved',
      };
    }
    const earliest = opts.oldestFetchedMs;
    return {
      lastSuccessAt: earliest != null ? new Date(earliest).toISOString() : null,
      error: 'Google change_event page stopped before the window ended',
    };
  }
  return { lastSuccessAt: new Date(opts.windowUntilMs).toISOString(), error: null };
}

export function normalizeGoogleChange(
  row: unknown,
  ctx: { customerId: string; currency: string | null; timeZone: string }
): NormalizedActivity | null {
  const root = rowDict(row);
  const event = changeEventOf(root);
  const when = String(event.changeDateTime ?? event.change_date_time ?? '');
  if (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(when)) return null;
  const local = when.replace('T', ' ').slice(0, 19);
  const occurred = zonedLocalToUtc(local, ctx.timeZone);

  const resourceType = String(event.changeResourceType ?? event.change_resource_type ?? '');
  const operation = String(event.resourceChangeOperation ?? event.resource_change_operation ?? 'UPDATE');
  const fields = changedFieldPaths(event.changedFields ?? event.changed_fields);
  const oldResource = event.oldResource ?? event.old_resource;
  const newResource = event.newResource ?? event.new_resource;
  const campaign = isDict(root.campaign) ? root.campaign : {};
  const adGroup = isDict(root.adGroup) ? root.adGroup : isDict(root.ad_group) ? root.ad_group : {};
  const campaignName = String(campaign.name ?? campaign.campaignName ?? '') || null;
  const adGroupName = String(adGroup.name ?? '') || null;
  const userEmail = String(event.userEmail ?? event.user_email ?? '').trim() || null;
  const clientType = String(event.clientType ?? event.client_type ?? '') || null;
  const tool = googleClientLabel(clientType);
  const isSystem = googleIsSystem(clientType, userEmail);
  const actor = userEmail || (isSystem ? 'Google Ads' : 'Someone');
  const objectType = resourceType || null;
  const label = typeLabel(resourceType);
  const objectName = label === 'ad group' || label === 'ad'
    ? adGroupName || campaignName
    : campaignName || adGroupName;
  const phrase = objectPhrase(resourceType, objectName, campaignName);
  const changeType = classifyGoogle(operation, resourceType, fields);
  const currency = (ctx.currency || 'USD').toUpperCase();

  const budgetOld = readMicros(oldResource, [
    ['campaignBudget', 'amountMicros'],
    ['campaign_budget', 'amount_micros'],
  ]);
  const budgetNew = readMicros(newResource, [
    ['campaignBudget', 'amountMicros'],
    ['campaign_budget', 'amount_micros'],
  ]);
  const bidOld = readMicros(oldResource, [
    ['adGroup', 'cpcBidMicros'],
    ['ad_group', 'cpc_bid_micros'],
    ['adGroup', 'targetCpaMicros'],
    ['ad_group', 'target_cpa_micros'],
    ['campaign', 'targetCpa', 'targetCpaMicros'],
    ['campaign', 'target_cpa', 'target_cpa_micros'],
  ]);
  const bidNew = readMicros(newResource, [
    ['adGroup', 'cpcBidMicros'],
    ['ad_group', 'cpc_bid_micros'],
    ['adGroup', 'targetCpaMicros'],
    ['ad_group', 'target_cpa_micros'],
    ['campaign', 'targetCpa', 'targetCpaMicros'],
    ['campaign', 'target_cpa', 'target_cpa_micros'],
  ]);
  const statusOld = dig(oldResource, [
    ['campaign', 'status'],
    ['adGroup', 'status'],
    ['ad_group', 'status'],
    ['adGroupAd', 'status'],
    ['ad_group_ad', 'status'],
  ]);
  const statusNew = dig(newResource, [
    ['campaign', 'status'],
    ['adGroup', 'status'],
    ['ad_group', 'status'],
    ['adGroupAd', 'status'],
    ['ad_group_ad', 'status'],
  ]);
  const nameOld = dig(oldResource, [['campaign', 'name'], ['adGroup', 'name'], ['ad_group', 'name']]);
  const nameNew = dig(newResource, [['campaign', 'name'], ['adGroup', 'name'], ['ad_group', 'name']]);

  const periodRaw = String(
    dig(newResource, [['campaignBudget', 'period'], ['campaign_budget', 'period']]) ??
      dig(oldResource, [['campaignBudget', 'period'], ['campaign_budget', 'period']]) ??
      ''
  ).toUpperCase();
  const period: 'day' | 'lifetime' | null = periodRaw.includes('CUSTOM') ? 'lifetime' : 'day';

  let oldValue: string | null = null;
  let newValue: string | null = null;
  let summary: string;

  if (changeType === 'budget' && (budgetOld != null || budgetNew != null)) {
    const oldMajor = budgetOld == null ? null : microsToMajor(budgetOld);
    const newMajor = budgetNew == null ? null : microsToMajor(budgetNew);
    oldValue = oldMajor == null ? null : formatMoney(oldMajor, currency);
    newValue = newMajor == null ? null : formatMoney(newMajor, currency);
    const suffix = period === 'lifetime' ? ' lifetime' : '/day';
    if (oldMajor != null && newMajor != null) {
      const verb = newMajor > oldMajor + 0.001 ? 'raised' : newMajor < oldMajor - 0.001 ? 'cut' : 'set';
      summary = `${actor} ${verb} budget on ${phrase} from ${oldValue} to ${newValue}${suffix}${toolSuffix(tool)}`;
    } else if (newValue) {
      summary = `${actor} set budget on ${phrase} to ${newValue}${suffix}${toolSuffix(tool)}`;
    } else {
      summary = `${actor} updated budget on ${phrase}${toolSuffix(tool)}`;
    }
  } else if (changeType === 'bid_or_target' && (bidOld != null || bidNew != null)) {
    const oldMajor = bidOld == null ? null : microsToMajor(bidOld);
    const newMajor = bidNew == null ? null : microsToMajor(bidNew);
    oldValue = oldMajor == null ? null : formatMoney(oldMajor, currency);
    newValue = newMajor == null ? null : formatMoney(newMajor, currency);
    if (oldValue && newValue) {
      const verb = (newMajor ?? 0) > (oldMajor ?? 0) ? 'raised' : 'cut';
      summary = `${actor} ${verb} bid on ${phrase} from ${oldValue} to ${newValue}${toolSuffix(tool)}`;
    } else {
      summary = `${actor} changed the bid on ${phrase}${toolSuffix(tool)}`;
    }
  } else if (changeType === 'status') {
    oldValue = displayScalar(statusOld);
    newValue = displayScalar(statusNew);
    summary = `${actor} changed status on ${phrase} from ${oldValue || 'unknown'} to ${newValue || 'unknown'}${toolSuffix(tool)}`;
  } else if (changeType === 'name') {
    oldValue = displayScalar(nameOld);
    newValue = displayScalar(nameNew);
    summary = `${actor} renamed ${phrase} from ${oldValue || 'unknown'} to ${newValue || 'unknown'}${toolSuffix(tool)}`;
  } else if (changeType === 'created') {
    summary = `${actor} created ${phrase}${toolSuffix(tool)}`;
  } else if (changeType === 'removed') {
    summary = `${actor} removed ${phrase}${toolSuffix(tool)}`;
  } else if (changeType === 'creative') {
    summary = `${actor} updated the creative on ${phrase}${toolSuffix(tool)}`;
  } else if (changeType === 'targeting') {
    summary = `${actor} updated targeting on ${phrase}${toolSuffix(tool)}`;
  } else {
    const fieldText = fields.length > 0 ? fields.join(', ') : operation.toLowerCase();
    summary = `${actor} updated ${phrase}${toolSuffix(tool)}: ${fieldText}`;
  }

  const resourceName = String(event.resourceName ?? event.resource_name ?? '') || null;
  const fallback = hashEventKey([
    ctx.customerId,
    local,
    resourceType,
    operation,
    campaignName,
    fields.join(','),
    stableStringify(oldResource ?? null),
    stableStringify(newResource ?? null),
  ]);

  return {
    event_key: googleEventKey(ctx.customerId, resourceName, fallback),
    platform: 'google',
    occurred_at: occurred.toISOString(),
    actor,
    tool,
    object_type: objectType,
    object_id: resourceNameId(event.changeResourceName ?? event.change_resource_name) || resourceNameId(event.campaign),
    object_name: objectName,
    campaign_name: campaignName,
    change_type: changeType,
    old_value: oldValue,
    new_value: newValue,
    summary,
    is_system: isSystem,
    raw: stripSecrets(root),
  };
}

export function stripSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSecrets);
  if (!isDict(value)) return value;
  const out: Dict = {};
  for (const [key, child] of Object.entries(value)) {
    if (/token|secret|authorization|password/i.test(key)) continue;
    out[key] = stripSecrets(child);
  }
  return out;
}

/** Redact tokens that a failed request URL might have echoed into an error. */
export function safeErrorMessage(error: unknown, secret?: string): string {
  let message = error instanceof Error ? error.message : 'request failed';
  if (secret) message = message.split(secret).join('[redacted]');
  message = message.replace(/access_token=[^&\s]+/gi, 'access_token=[redacted]');
  message = message.replace(/token=[^&\s]+/gi, 'token=[redacted]');
  return message.slice(0, 500);
}

export function metaAccountId(raw: string | null | undefined): string {
  const id = (raw || '').trim();
  if (!id) return '';
  return id.startsWith('act_') ? id : `act_${id.replace(/^act_/, '')}`;
}

/** Confirms a formatted Google bound round-trips; used by the query builder. */
export function googleQueryBounds(
  sinceMs: number,
  untilMs: number,
  timeZone: string
): { startLocal: string; endLocal: string } {
  return {
    startLocal: formatInTimeZone(new Date(sinceMs), timeZone),
    endLocal: formatInTimeZone(new Date(untilMs), timeZone),
  };
}
