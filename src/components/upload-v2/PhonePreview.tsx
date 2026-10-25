'use client';

import { useRef, useState } from 'react';
import {
  BatteryFull,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Film,
  Heart,
  Home,
  MessageCircle,
  Plus,
  Search,
  Send,
  Signal,
  UserRound,
  Wifi,
} from 'lucide-react';
import {
  SAMPLE_BRAND,
  displayHandle,
  formatUsageEnd,
  type Creative,
  type CreativeType,
  type LocalMedia,
} from '@/components/upload-v2/model';

type PhonePreviewProps = {
  creative: Creative;
  creativeType: CreativeType;
  cardIndex: number;
  onCardIndex: (index: number) => void;
  onDropFiles: (files: File[]) => void;
};

const RAIL = [
  { key: 'like', icon: Heart, count: '128' },
  { key: 'comment', icon: MessageCircle, count: '14' },
  { key: 'share', icon: Send, count: '36' },
  { key: 'save', icon: Bookmark, count: '' },
];

function StatusBar() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-center justify-between px-5 pt-3 text-[11px] font-semibold text-white">
      <span>9:41</span>
      <span className="flex items-center gap-1">
        <Signal className="h-3 w-3" strokeWidth={2.25} />
        <Wifi className="h-3 w-3" strokeWidth={2.25} />
        <BatteryFull className="h-3.5 w-3.5" strokeWidth={2.25} />
      </span>
    </div>
  );
}

function Notch() {
  return (
    <div aria-hidden className="pointer-events-none absolute left-1/2 top-2 z-40 h-[22px] w-[84px] -translate-x-1/2 rounded-full bg-black" />
  );
}

function HomeIndicator() {
  return (
    <div aria-hidden className="pointer-events-none absolute bottom-1.5 left-1/2 z-40 h-1 w-24 -translate-x-1/2 rounded-full bg-white/80" />
  );
}

function Avatar({ letter }: { letter: string }) {
  return (
    <span
      aria-hidden
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-[#0A0A0A]"
      style={{ background: 'linear-gradient(135deg, #C8B89A 0%, #A89474 100%)' }}
    >
      {letter}
    </span>
  );
}

function SampleArt({ from, to, kicker }: { from: string; to: string; kicker: string }) {
  return (
    <div className="absolute inset-0" style={{ background: `linear-gradient(165deg, ${from} 0%, ${to} 78%)` }}>
      <div
        className="absolute -right-8 top-10 h-44 w-44 rounded-full"
        style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.45), transparent 68%)' }}
      />
      <div className="absolute left-4 right-16 top-[24%]">
        <p className="text-[10px] font-bold tracking-[0.22em] text-white/75">SAMPLE</p>
        <p className="mt-1 text-[26px] font-semibold leading-[1.1] text-white">{kicker}</p>
      </div>
    </div>
  );
}

function MediaFill({ media, from, to, kicker }: { media: LocalMedia | null; from: string; to: string; kicker: string }) {
  if (!media) return <SampleArt from={from} to={to} kicker={kicker} />;
  if (media.kind === 'video') {
    return (
      <video
        key={media.url}
        src={media.url}
        className="absolute inset-0 h-full w-full object-cover"
        muted
        playsInline
        autoPlay
        loop
        preload="metadata"
      />
    );
  }
  return (
    // Local blob previews are not next/image sources.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={media.url} alt="" className="absolute inset-0 h-full w-full object-cover" />
  );
}

function Rail() {
  return (
    <div aria-hidden className="absolute bottom-[76px] right-2 z-20 flex flex-col items-center gap-3 text-white">
      {RAIL.map(({ key, icon: Icon, count }) => (
        <div key={key} className="flex flex-col items-center gap-0.5">
          <Icon className="h-6 w-6 drop-shadow" strokeWidth={1.75} />
          {count ? <span className="text-[10px] font-medium leading-none">{count}</span> : null}
        </div>
      ))}
    </div>
  );
}

function TabBar() {
  return (
    <div aria-hidden className="absolute inset-x-0 bottom-0 z-20 flex h-[52px] items-start justify-around border-t border-white/10 bg-black/45 px-2 pt-2 text-white backdrop-blur-md">
      <Home className="h-5 w-5" strokeWidth={1.75} />
      <Search className="h-5 w-5" strokeWidth={1.75} />
      <span className="flex h-6 w-6 items-center justify-center rounded-md border border-white/80">
        <Plus className="h-4 w-4" strokeWidth={2} />
      </span>
      <Film className="h-5 w-5" strokeWidth={1.75} />
      <UserRound className="h-5 w-5" strokeWidth={1.75} />
    </div>
  );
}

function PartnershipHeader({ handle }: { handle: string }) {
  return (
    <div className="absolute inset-x-3 top-11 z-20 flex items-center gap-2 text-white">
      <Avatar letter={handle.replace('@', '').slice(0, 1).toUpperCase() || 'S'} />
      <div className="min-w-0">
        <p className="truncate text-[12px] font-semibold leading-tight">{handle}</p>
        <p className="text-[10px] leading-tight text-white/80">Paid partnership</p>
      </div>
      <span className="ml-auto shrink-0 rounded border border-white/80 px-2 py-0.5 text-[11px] font-semibold">
        Follow
      </span>
    </div>
  );
}

function FlexibleHint({ className = '' }: { className?: string }) {
  return (
    <div className={`inline-flex max-w-full flex-col rounded-lg bg-black/55 px-2.5 py-1.5 backdrop-blur-sm ${className}`}>
      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#C8B89A]">Multiple placements</span>
      <span className="text-[11px] text-white/90">Feed · Stories · Reels</span>
    </div>
  );
}

export default function PhonePreview({
  creative,
  creativeType,
  cardIndex,
  onCardIndex,
  onDropFiles,
}: PhonePreviewProps) {
  const [dragOver, setDragOver] = useState(false);
  const startX = useRef<number | null>(null);
  const cards = creative.cards;
  const safeIndex = Math.min(cards.length - 1, Math.max(0, cardIndex));
  const activeCard = cards[safeIndex];
  const art = creativeType === 'carousel'
    ? { from: activeCard.from, to: activeCard.to, kicker: activeCard.kicker, media: activeCard.media, headline: activeCard.headline }
    : { from: creative.from, to: creative.to, kicker: creative.kicker, media: creative.media, headline: '' };
  const handle = displayHandle(creative.handle);
  const caption = creative.caption.trim();
  const previewLabel = [
    creativeType === 'whitelist' ? 'Whitelist ad preview' : creativeType === 'carousel' ? 'Carousel ad preview' : 'Flexible ad preview',
    creative.name,
    caption || 'No caption yet',
  ].join(', ');

  function stepCard(delta: number) {
    const next = Math.min(cards.length - 1, Math.max(0, safeIndex + delta));
    if (next !== safeIndex) onCardIndex(next);
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (creativeType !== 'carousel') return;
    if ((event.target as HTMLElement).closest('button')) return;
    startX.current = event.clientX;
  }

  function onPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (startX.current == null) return;
    const delta = event.clientX - startX.current;
    startX.current = null;
    if (delta <= -36) stepCard(1);
    else if (delta >= 36) stepCard(-1);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (creativeType !== 'carousel') return;
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      event.stopPropagation();
      stepCard(1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      event.stopPropagation();
      stepCard(-1);
    }
  }

  const dots = creativeType === 'carousel' ? (
    <div className="flex items-center justify-center gap-1.5">
      {cards.map((item, index) => {
        const selected = index === safeIndex;
        return (
          <button
            key={item.id}
            type="button"
            aria-label={`Card ${index + 1} of ${cards.length}`}
            aria-current={selected ? 'true' : undefined}
            onClick={() => onCardIndex(index)}
            className="h-1.5 rounded-full transition-[width,background-color] duration-150"
            style={{
              width: selected ? 14 : 6,
              backgroundColor: selected ? '#ffffff' : 'rgba(255,255,255,0.45)',
            }}
          />
        );
      })}
    </div>
  ) : null;

  const chevrons = creativeType === 'carousel' ? (
    <>
      <button
        type="button"
        aria-label="Previous card"
        disabled={safeIndex === 0}
        onClick={() => stepCard(-1)}
        className="absolute left-2 top-1/2 z-20 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm disabled:opacity-30"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <button
        type="button"
        aria-label="Next card"
        disabled={safeIndex === cards.length - 1}
        onClick={() => stepCard(1)}
        className="absolute right-12 top-1/2 z-20 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm disabled:opacity-30"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </>
  ) : null;

  const stage = (
    <div
      data-carousel={creativeType === 'carousel' ? 'true' : undefined}
      tabIndex={creativeType === 'carousel' ? 0 : undefined}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      className="absolute inset-0 outline-none"
      aria-label={creativeType === 'carousel' ? `Carousel cards, card ${safeIndex + 1} of ${cards.length}` : undefined}
    >
      <div key={creativeType === 'carousel' ? activeCard.id : creative.id} className="absolute inset-0 animate-fade-in">
        <MediaFill media={art.media} from={art.from} to={art.to} kicker={art.kicker} />
      </div>
      {chevrons}
    </div>
  );

  const screen = (
      <div className="absolute inset-0 text-white">
        {stage}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-48 bg-gradient-to-t from-black/80 to-transparent" />
        {creativeType === 'whitelist' ? (
          <PartnershipHeader handle={handle} />
        ) : (
          <div aria-hidden className="absolute inset-x-0 top-11 z-20 flex justify-center gap-5 text-[14px] font-semibold">
            <span>Reels</span>
            <span className="text-white/45">Friends</span>
          </div>
        )}
        <Rail />
        <div className="absolute inset-x-0 bottom-[52px] z-20 flex flex-col gap-2 px-3 pb-3 pr-16">
          {creativeType === 'flexible' ? <FlexibleHint /> : null}
          {dots}
          <div className="flex items-center gap-2">
            <Avatar letter={(creativeType === 'whitelist' ? handle : 'S').replace('@', '').slice(0, 1).toUpperCase()} />
            <span className="truncate text-[13px] font-semibold">
              {creativeType === 'whitelist' ? handle : 'sample.brand'}
            </span>
            {creativeType === 'whitelist' ? null : (
              <span className="rounded border border-white/70 px-1.5 py-0.5 text-[11px] font-semibold">Follow</span>
            )}
          </div>
          {creativeType === 'whitelist' ? (
            <p className="text-[10px] text-white/75">Paid partnership with {SAMPLE_BRAND}</p>
          ) : null}
          {creativeType === 'whitelist' && creative.perpetual ? (
            <p className="text-[10px] text-white/75">Perpetual</p>
          ) : null}
          {creativeType === 'whitelist' && !creative.perpetual && creative.usageEndDate ? (
            <p className="text-[10px] text-white/75">Usage ends {formatUsageEnd(creative.usageEndDate)}</p>
          ) : null}
          {creativeType === 'carousel' && art.headline ? (
            <p className="text-[13px] font-semibold leading-snug">{art.headline}</p>
          ) : null}
          <p className="line-clamp-3 text-[12px] leading-snug">
            {caption || <span className="text-white/55">Add a caption</span>}
          </p>
        </div>
        <TabBar />
      </div>
  );

  return (
    <div className="mx-auto w-full max-w-[280px]">
      <div
        role="region"
        aria-label={previewLabel}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragOver(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setDragOver(false);
          onDropFiles(Array.from(event.dataTransfer.files));
        }}
        className="rounded-[2.4rem] p-2.5 shadow-modal"
        style={{
          backgroundColor: '#141414',
          border: dragOver ? '1px solid #C8B89A' : '1px solid rgba(255,255,255,0.14)',
          boxShadow: dragOver ? '0 0 0 3px rgba(200,184,154,0.28)' : undefined,
        }}
      >
        <div className="relative aspect-[9/19.2] overflow-hidden rounded-[1.9rem] bg-black select-none">
          {screen}
          <StatusBar />
          <Notch />
          <HomeIndicator />
        </div>
      </div>
    </div>
  );
}
