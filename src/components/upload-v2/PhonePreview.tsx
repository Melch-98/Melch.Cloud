'use client';

import { useState } from 'react';
import {
  BatteryFull,
  Bookmark,
  Film,
  Heart,
  Home,
  MessageCircle,
  MoreHorizontal,
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
  assetIndex: number;
  onDropFiles: (files: File[]) => void;
};

const RAIL = [
  { key: 'like', icon: Heart, count: '128' },
  { key: 'comment', icon: MessageCircle, count: '14' },
  { key: 'share', icon: Send, count: '36' },
  { key: 'save', icon: Bookmark, count: '' },
];

function StatusBar({ ink }: { ink: 'white' | 'black' }) {
  return (
    <div aria-hidden className={`pointer-events-none absolute inset-x-0 top-0 z-30 flex items-center justify-between px-5 pt-3 text-[11px] font-semibold ${ink === 'white' ? 'text-white' : 'text-black'}`}>
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

function HomeIndicator({ ink }: { ink: 'white' | 'black' }) {
  return (
    <div aria-hidden className={`pointer-events-none absolute bottom-1.5 left-1/2 z-40 h-1 w-24 -translate-x-1/2 rounded-full ${ink === 'white' ? 'bg-white/80' : 'bg-black/35'}`} />
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

function FlexibleHint({ count, className = '' }: { count: number; className?: string }) {
  const text = count > 0
    ? `${count} ${count === 1 ? 'asset' : 'assets'} · multiple placements`
    : 'Multiple placements';
  return (
    <div className={`inline-flex max-w-full rounded-lg bg-black/55 px-2.5 py-1.5 backdrop-blur-sm ${className}`}>
      <span className="text-[11px] font-medium text-white/90">{text}</span>
    </div>
  );
}

export default function PhonePreview({
  creative,
  creativeType,
  cardIndex,
  assetIndex,
  onDropFiles,
}: PhonePreviewProps) {
  const [dragOver, setDragOver] = useState(false);
  const cards = creative.cards;
  const assets = creative.assets;
  const safeIndex = Math.min(cards.length - 1, Math.max(0, cardIndex));
  const safeAsset = Math.min(Math.max(0, assets.length - 1), Math.max(0, assetIndex));
  const activeCard = cards[safeIndex];
  const activeAsset = assets[safeAsset];
  const art = creativeType === 'carousel'
    ? { from: activeCard.from, to: activeCard.to, kicker: activeCard.kicker, media: activeCard.media, headline: activeCard.headline }
    : creativeType === 'flexible' && activeAsset
      ? { from: creative.from, to: creative.to, kicker: creative.kicker, media: activeAsset.media, headline: '' }
      : { from: creative.from, to: creative.to, kicker: creative.kicker, media: creative.media, headline: '' };
  const handle = displayHandle(creative.handle);
  const caption = creative.caption.trim();
  const ratio = creative.ratio;
  const feed = ratio !== '9:16';
  const accountName = creativeType === 'whitelist' ? handle : 'sample.brand';
  const previewLabel = [
    creativeType === 'whitelist' ? 'Whitelist ad preview' : creativeType === 'carousel' ? 'Carousel ad preview' : 'Flexible ad preview',
    ratio,
    creative.name,
    caption || 'No caption yet',
  ].join(', ');

  const stage = (
    <div className="absolute inset-0">
      <div key={creativeType === 'carousel' ? activeCard.id : activeAsset?.id ?? creative.id} className="absolute inset-0 animate-fade-in">
        <MediaFill media={art.media} from={art.from} to={art.to} kicker={art.kicker} />
      </div>
    </div>
  );

  const usageLine = creativeType === 'whitelist' && creative.perpetual
    ? 'Perpetual'
    : creativeType === 'whitelist' && !creative.perpetual && creative.usageEndDate
      ? `Usage ends ${formatUsageEnd(creative.usageEndDate)}`
      : null;

  const reels = (
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
        {creativeType === 'flexible' ? <FlexibleHint count={assets.length} /> : null}
        <div className="flex items-center gap-2">
          <Avatar letter={accountName.replace('@', '').slice(0, 1).toUpperCase() || 'S'} />
          <span className="truncate text-[13px] font-semibold">{accountName}</span>
          {creativeType === 'whitelist' ? null : (
            <span className="rounded border border-white/70 px-1.5 py-0.5 text-[11px] font-semibold">Follow</span>
          )}
        </div>
        {creativeType === 'whitelist' ? (
          <p className="text-[10px] text-white/75">Paid partnership with {SAMPLE_BRAND}</p>
        ) : null}
        {usageLine ? <p className="text-[10px] text-white/75">{usageLine}</p> : null}
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

  const feedPost = (
    <div className="absolute inset-0 flex flex-col overflow-hidden bg-white text-[#262626]">
      <div className="h-11 shrink-0" />
      <div className="flex shrink-0 items-center gap-2 px-3 py-2">
        <Avatar letter={accountName.replace('@', '').slice(0, 1).toUpperCase() || 'S'} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold leading-tight">{accountName}</p>
          {creativeType === 'whitelist' ? (
            <p className="text-[10px] leading-tight text-[#8e8e8e]">Paid partnership</p>
          ) : null}
        </div>
        <MoreHorizontal className="h-5 w-5 shrink-0" aria-hidden />
      </div>
      <div className="relative w-full shrink-0 bg-black" style={{ aspectRatio: ratio === '1:1' ? '1 / 1' : '4 / 5' }}>
        {stage}
      </div>
      <div aria-hidden className="flex shrink-0 items-center gap-3 px-3 py-2">
        <Heart className="h-5 w-5" strokeWidth={1.75} />
        <MessageCircle className="h-5 w-5" strokeWidth={1.75} />
        <Send className="h-5 w-5" strokeWidth={1.75} />
        <Bookmark className="ml-auto h-5 w-5" strokeWidth={1.75} />
      </div>
      <div className="min-h-0 flex-1 overflow-hidden px-3 pb-5">
        <p className="text-[12px] font-semibold">128 likes</p>
        {creativeType === 'flexible' ? <FlexibleHint count={assets.length} className="mt-1.5" /> : null}
        {creativeType === 'carousel' && art.headline ? (
          <p className="mt-1 text-[12px] font-semibold leading-snug">{art.headline}</p>
        ) : null}
        <p className="mt-1 line-clamp-2 text-[12px] leading-snug">
          <span className="font-semibold">{accountName} </span>
          {caption || <span className="text-[#8e8e8e]">Add a caption</span>}
        </p>
        {usageLine ? <p className="mt-1 text-[10px] text-[#8e8e8e]">{usageLine}</p> : null}
      </div>
    </div>
  );

  const screen = feed ? feedPost : reels;

  return (
    <div className="mx-auto w-full max-w-[280px]">
      <div
        role="region"
        aria-label={previewLabel}
        onDragEnter={(event) => {
          event.preventDefault();
          if (event.dataTransfer.types.includes('Files')) setDragOver(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (event.dataTransfer.types.includes('Files')) setDragOver(true);
        }}
        onDragLeave={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node)) return;
          setDragOver(false);
        }}
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
          <StatusBar ink={feed ? 'black' : 'white'} />
          <Notch />
          <HomeIndicator ink={feed ? 'black' : 'white'} />
        </div>
      </div>
    </div>
  );
}
