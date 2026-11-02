export type NotePart =
  | { kind: 'text'; text: string }
  | { kind: 'link'; text: string; href: string };

const LANDING_ERROR = 'Enter a landing page URL, or leave it blank';

const MEDIA_EXTENSION = /^(?:jpe?g|png|gif|webp|svg|heic|mp4|mov|webm|m4v|pdf|zip|csv|txt)$/i;

/**
 * Blank stays ''. A host with or without http(s):// is stored as https://.
 * Anything else is rejected so submit can stay disabled.
 */
export function normalizeLandingPageUrl(raw: string): { value: string; error: string | null } {
  const trimmed = raw.trim();
  if (!trimmed) return { value: '', error: null };
  if (/\s/.test(trimmed)) return { value: '', error: LANDING_ERROR };

  const scheme = trimmed.match(/^([a-z][a-z0-9+.-]*):/i);
  let body: string;
  if (scheme) {
    const name = scheme[1].toLowerCase();
    if (name !== 'http' && name !== 'https') return { value: '', error: LANDING_ERROR };
    body = trimmed.slice(scheme[0].length).replace(/^\/\//, '');
  } else {
    body = trimmed.replace(/^\/\//, '');
  }
  if (!body || body.startsWith('/')) return { value: '', error: LANDING_ERROR };

  const candidate = `https://${body}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { value: '', error: LANDING_ERROR };
  }
  if (parsed.protocol !== 'https:' || !parsed.hostname.includes('.')) {
    return { value: '', error: LANDING_ERROR };
  }
  return { value: candidate, error: null };
}

/** Href for a stored landing page. Blank and non-URLs return null so the card renders nothing. */
export function landingPageHref(raw: string | null | undefined): string | null {
  const normalized = normalizeLandingPageUrl(raw ?? '');
  return normalized.error ? null : normalized.value || null;
}

function noteHref(raw: string): string {
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw.replace(/^\/\//, '')}`;
}

function isNoteUrl(raw: string): boolean {
  try {
    const url = new URL(noteHref(raw));
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    if (!url.hostname.includes('.')) return false;
    const tld = url.hostname.split('.').pop() ?? '';
    return !MEDIA_EXTENSION.test(tld);
  } catch {
    return false;
  }
}

function trimTrail(raw: string): string {
  let url = raw;
  while (url && /[.,;:!?)]$/.test(url)) {
    const last = url[url.length - 1];
    if (last === ')') {
      const opens = url.split('(').length - 1;
      const closes = url.split(')').length - 1;
      if (opens >= closes) break;
    }
    url = url.slice(0, -1);
  }
  return url;
}

const NOTE_URL = /(?:https?:\/\/|www\.)[^\s<>"']+|(?<!@)\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s<>"']*)?/gi;

/** Split note text so each URL can be a link. The visible text stays as typed. */
export function noteParts(input: string): NotePart[] {
  const parts: NotePart[] = [];
  const re = new RegExp(NOTE_URL.source, NOTE_URL.flags);
  let cursor = 0;
  let match = re.exec(input);
  while (match) {
    const start = match.index;
    const url = trimTrail(match[0]);
    if (url && isNoteUrl(url)) {
      if (start > cursor) parts.push({ kind: 'text', text: input.slice(cursor, start) });
      parts.push({ kind: 'link', text: url, href: noteHref(url) });
      cursor = start + url.length;
    }
    if (match[0].length === 0) break;
    match = re.exec(input);
  }
  if (cursor < input.length) parts.push({ kind: 'text', text: input.slice(cursor) });
  if (parts.length === 0) parts.push({ kind: 'text', text: input });
  return parts;
}
