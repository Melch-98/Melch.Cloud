'use client';

import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import ControlCard from '@/components/upload-v2/ControlCard';
import {
  SAMPLE_CREATIVES,
  cloneCreative,
  mediaKind,
  nearestAspectRatio,
  revokeMedia,
  type Creative,
  type CreativeType,
  type LocalMedia,
} from '@/components/upload-v2/model';
import PhonePreview from '@/components/upload-v2/PhonePreview';

function measureMedia(url: string, kind: 'image' | 'video'): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    let settled = false;
    let timer = 0;
    const finish = (value: { width: number; height: number } | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(value);
    };
    timer = window.setTimeout(() => finish(null), 4000);
    if (kind === 'image') {
      const image = new Image();
      image.onload = () => {
        finish(image.naturalWidth > 0 && image.naturalHeight > 0
          ? { width: image.naturalWidth, height: image.naturalHeight }
          : null);
      };
      image.onerror = () => finish(null);
      image.src = url;
      return;
    }
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.onloadedmetadata = () => {
      finish(video.videoWidth > 0 && video.videoHeight > 0
        ? { width: video.videoWidth, height: video.videoHeight }
        : null);
      video.removeAttribute('src');
      video.load();
    };
    video.onerror = () => finish(null);
    video.src = url;
  });
}

export default function UploadV2Studio() {
  const [creatives, setCreatives] = useState<Creative[]>(() => SAMPLE_CREATIVES.map(cloneCreative));
  const [creativeType, setCreativeType] = useState<CreativeType>('whitelist');
  const [batchOn, setBatchOn] = useState(false);
  const [index, setIndex] = useState(0);
  const [cardIndexById, setCardIndexById] = useState<Record<string, number>>({});
  const [mediaNote, setMediaNote] = useState<string | null>(null);

  const safeIndex = Math.min(creatives.length - 1, Math.max(0, index));
  const creative = creatives[safeIndex];
  const cardIndex = Math.min(
    creative.cards.length - 1,
    Math.max(0, cardIndexById[creative.id] ?? 0),
  );
  const activeCard = creative.cards[cardIndex];
  const shownMedia = creativeType === 'carousel' ? activeCard.media : creative.media;

  useEffect(() => {
    const stopNavigation = (event: DragEvent) => {
      event.preventDefault();
    };
    window.addEventListener('dragover', stopNavigation);
    window.addEventListener('drop', stopNavigation);
    return () => {
      window.removeEventListener('dragover', stopNavigation);
      window.removeEventListener('drop', stopNavigation);
    };
  }, []);

  useEffect(() => {
    if (!batchOn) return;
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('input, textarea, select, button, a, [role="combobox"], [role="listbox"], [data-carousel="true"]')) return;
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      setIndex((current) => {
        const next = event.key === 'ArrowLeft' ? current - 1 : current + 1;
        return Math.min(creatives.length - 1, Math.max(0, next));
      });
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [batchOn, creatives.length]);

  function patchCreative(patch: Partial<Pick<Creative, 'caption' | 'productKey' | 'productLabel' | 'angle' | 'handle' | 'usageEndDate' | 'perpetual' | 'ratio'>>) {
    setCreatives((current) => current.map((item) => (
      item.id === creative.id ? { ...item, ...patch } : item
    )));
  }

  function setHeadline(headline: string) {
    setCreatives((current) => current.map((item) => {
      if (item.id !== creative.id) return item;
      return {
        ...item,
        cards: item.cards.map((card, cardPosition) => (
          cardPosition === cardIndex ? { ...card, headline } : card
        )),
      };
    }));
  }

  async function applyFiles(files: File[]) {
    const accepted = files.flatMap((file) => {
      const kind = mediaKind(file);
      return kind ? [{ file, kind }] : [];
    });
    if (accepted.length === 0) {
      setMediaNote('Use an image or a video. Nothing is uploaded from this prototype.');
      return;
    }

    const snapshotType = creativeType;
    const snapshotIndex = safeIndex;
    const snapshotCard = cardIndex;
    const snapshotBatch = batchOn;
    const measured = await Promise.all(accepted.map(async (item) => {
      const url = URL.createObjectURL(item.file);
      const size = await measureMedia(url, item.kind);
      const media: LocalMedia = {
        url,
        kind: item.kind,
        name: item.file.name,
        width: size?.width ?? null,
        height: size?.height ?? null,
      };
      return media;
    }));

    const slots: { creativeIndex: number; cardIndex: number | null; media: LocalMedia }[] = [];
    measured.forEach((media, offset) => {
      if (snapshotType === 'carousel') {
        const position = snapshotCard + offset;
        if (position < 0 || position >= creatives[snapshotIndex].cards.length) return;
        slots.push({ creativeIndex: snapshotIndex, cardIndex: position, media });
        return;
      }
      const position = snapshotBatch ? snapshotIndex + offset : snapshotIndex;
      if (!snapshotBatch && offset > 0) return;
      if (position < 0 || position >= creatives.length) return;
      slots.push({ creativeIndex: position, cardIndex: null, media });
    });

    const placed = slots.length;
    const placedUrls = new Set(slots.map((slot) => slot.media.url));
    measured.forEach((media) => {
      if (!placedUrls.has(media.url)) URL.revokeObjectURL(media.url);
    });
    setCreatives((current) => {
      const next = current.map(cloneCreative);
      const stale: string[] = [];
      const carouselSnap = snapshotType === 'carousel'
        ? slots.find((slot) => slot.media.width && slot.media.height)
        : null;
      slots.forEach((slot) => {
        const target = next[slot.creativeIndex];
        if (!target) return;
        if (slot.cardIndex == null) {
          if (target.media?.url.startsWith('blob:')) stale.push(target.media.url);
          target.media = slot.media;
          if (slot.media.width && slot.media.height) {
            target.ratio = nearestAspectRatio(slot.media.width, slot.media.height);
          }
          return;
        }
        const card = target.cards[slot.cardIndex];
        if (!card) return;
        if (card.media?.url.startsWith('blob:')) stale.push(card.media.url);
        card.media = slot.media;
      });
      if (carouselSnap?.media.width && carouselSnap.media.height && next[snapshotIndex]) {
        next[snapshotIndex].ratio = nearestAspectRatio(carouselSnap.media.width, carouselSnap.media.height);
      }
      if (stale.length) queueMicrotask(() => stale.forEach((url) => URL.revokeObjectURL(url)));
      return next;
    });

    if (placed < accepted.length) {
      setMediaNote(
        creativeType === 'carousel'
          ? `Placed ${placed} of ${accepted.length}. This sample carousel has ${creative.cards.length} cards.`
          : `Placed ${placed} of ${accepted.length}. The sample batch has ${creatives.length} creatives.`,
      );
      return;
    }
    if (!batchOn && creativeType !== 'carousel' && accepted.length > 1) {
      setMediaNote('Showing the first file. Turn Batch on to spread files across the sample creatives.');
      return;
    }
    setMediaNote(null);
  }

  function clearMedia() {
    const next = creatives.map(cloneCreative);
    if (creativeType === 'carousel') {
      const card = next[safeIndex].cards[cardIndex];
      revokeMedia(card.media);
      card.media = null;
    } else {
      revokeMedia(next[safeIndex].media);
      next[safeIndex].media = null;
    }
    setCreatives(next);
    setMediaNote(null);
  }

  function stepCreative(delta: number) {
    setIndex((current) => Math.min(creatives.length - 1, Math.max(0, current + delta)));
    setMediaNote(null);
  }

  return (
    <div data-prototype="upload-v2" className="mx-auto grid w-full max-w-[860px] grid-cols-1 items-start gap-6 lg:grid-cols-[280px_minmax(0,1fr)] lg:gap-x-12 lg:gap-y-3">
      <div className="lg:col-start-1 lg:row-start-1">
        <div className="mx-auto mb-3 flex h-11 w-full max-w-[280px] items-center justify-center gap-2">
          {batchOn ? (
            <>
              <button
                type="button"
                aria-label="Previous creative"
                disabled={safeIndex === 0}
                onClick={() => stepCreative(-1)}
                className="flex h-11 w-11 items-center justify-center rounded-full text-[#F5F5F8] disabled:cursor-not-allowed disabled:opacity-30"
                style={{ backgroundColor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <p className="min-w-[9.5rem] text-center text-sm font-semibold tabular-nums text-[#F5F5F8]" aria-live="polite">
                Creative {safeIndex + 1} of {creatives.length}
              </p>
              <button
                type="button"
                aria-label="Next creative"
                disabled={safeIndex === creatives.length - 1}
                onClick={() => stepCreative(1)}
                className="flex h-11 w-11 items-center justify-center rounded-full text-[#F5F5F8] disabled:cursor-not-allowed disabled:opacity-30"
                style={{ backgroundColor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </>
          ) : (
            <p className="text-sm text-[#ABABAB]">Single creative</p>
          )}
        </div>
        <PhonePreview
          creative={creative}
          creativeType={creativeType}
          cardIndex={cardIndex}
          onCardIndex={(next) => {
            setCardIndexById((current) => ({ ...current, [creative.id]: next }));
            setMediaNote(null);
          }}
          onDropFiles={applyFiles}
        />
      </div>
      <div className="min-w-0 lg:col-start-2 lg:row-start-1">
        <ControlCard
          creative={creative}
          creativeIndex={safeIndex}
          creativeCount={creatives.length}
          batchOn={batchOn}
          creatives={creatives}
          creativeType={creativeType}
          cardIndex={cardIndex}
          shownMedia={shownMedia}
          mediaNote={mediaNote}
          onCreativeType={(value) => {
            setCreativeType(value);
            setMediaNote(null);
          }}
          onBatch={(value) => {
            setBatchOn(value);
            setMediaNote(null);
          }}
          onSelectCreative={(next) => {
            setIndex(next);
            setMediaNote(null);
          }}
          onPatch={patchCreative}
          onHeadline={setHeadline}
          onFiles={applyFiles}
          onClearMedia={clearMedia}
        />
      </div>
    </div>
  );
}
