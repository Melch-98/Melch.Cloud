'use client';

import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import ControlCard from '@/components/upload-v2/ControlCard';
import {
  SAMPLE_CREATIVES,
  cloneCreative,
  mediaKind,
  revokeMedia,
  type Creative,
  type CreativeType,
  type LocalMedia,
} from '@/components/upload-v2/model';
import PhonePreview from '@/components/upload-v2/PhonePreview';

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

  function patchCreative(patch: Partial<Pick<Creative, 'caption' | 'productKey' | 'productLabel' | 'angle' | 'handle' | 'usageEndDate' | 'perpetual'>>) {
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

  function applyFiles(files: File[]) {
    const accepted = files.flatMap((file) => {
      const kind = mediaKind(file);
      return kind ? [{ file, kind }] : [];
    });
    if (accepted.length === 0) {
      setMediaNote('Use an image or a video. Nothing is uploaded from this prototype.');
      return;
    }

    const next = creatives.map(cloneCreative);
    const replaced: LocalMedia[] = [];
    let placed = 0;

    if (creativeType === 'carousel') {
      accepted.forEach((item, offset) => {
        const position = cardIndex + offset;
        const card = next[safeIndex].cards[position];
        if (!card) return;
        if (card.media) replaced.push(card.media);
        card.media = {
          url: URL.createObjectURL(item.file),
          kind: item.kind,
          name: item.file.name,
        };
        placed += 1;
      });
    } else {
      accepted.forEach((item, offset) => {
        const position = batchOn ? safeIndex + offset : safeIndex;
        if (!batchOn && offset > 0) return;
        const target = next[position];
        if (!target) return;
        if (target.media) replaced.push(target.media);
        target.media = {
          url: URL.createObjectURL(item.file),
          kind: item.kind,
          name: item.file.name,
        };
        placed += 1;
      });
    }

    replaced.forEach((media) => revokeMedia(media));
    setCreatives(next);

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
