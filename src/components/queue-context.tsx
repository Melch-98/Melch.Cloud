import { ExternalLink } from 'lucide-react';
import { landingPageHref, noteParts } from '@/lib/landing-page-url';

export function LandingPageLink({
  url,
  compact = false,
}: {
  url?: string | null;
  compact?: boolean;
}) {
  const href = landingPageHref(url);
  if (!href) return null;
  const label = href.replace(/^https?:\/\//i, '');
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={href}
      onClick={(event) => event.stopPropagation()}
      className={`flex min-w-0 max-w-full items-center gap-1 text-amber-400 hover:underline ${compact ? 'text-[10px]' : ''}`}
    >
      <span className="truncate">{label}</span>
      <ExternalLink className={compact ? 'h-2.5 w-2.5 shrink-0' : 'h-3 w-3 shrink-0'} aria-hidden />
    </a>
  );
}

function LinkedText({ text }: { text: string }) {
  return noteParts(text).map((part, index) => {
    if (part.kind === 'text') return <span key={index}>{part.text}</span>;
    return (
      <a
        key={index}
        href={part.href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(event) => event.stopPropagation()}
        className="break-all text-amber-400 underline hover:text-[#C8B89A]"
      >
        {part.text}
      </a>
    );
  });
}

export function BatchNotes({ notes }: { notes?: string | null }) {
  const text = notes?.trim() ?? '';
  if (!text) return null;
  return (
    <div className="min-w-0 text-xs">
      <span className="mb-0.5 block text-gray-500">Notes</span>
      <p className="whitespace-pre-wrap break-words text-gray-300">
        <LinkedText text={text} />
      </p>
    </div>
  );
}

export function FileContext({
  landingPageUrl,
  notes,
}: {
  landingPageUrl?: string | null;
  notes?: string | null;
}) {
  const text = notes?.trim() ?? '';
  if (!landingPageHref(landingPageUrl) && !text) return null;
  return (
    <div className="mt-0.5 min-w-0 space-y-0.5">
      <LandingPageLink url={landingPageUrl} compact />
      {text ? (
        <p className="whitespace-pre-wrap break-words text-[10px] leading-snug text-gray-400">
          <LinkedText text={text} />
        </p>
      ) : null}
    </div>
  );
}
