'use client';

import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import ControlCard from '@/components/upload-v2/ControlCard';
import {
  SAMPLE_CREATIVES,
  addCarouselMedia,
  addFlexibleAssets,
  appendBatchCreatives,
  cloneCreative,
  createLocalId,
  followMove,
  mediaKind,
  moveItem,
  nearestAspectRatio,
  productAfterBrandChange,
  removeCarouselCard,
  brandLogoUrl,
  revokeMedia,
  weekFolderLabel,
  type Creative,
  type CreativeType,
  type LocalMedia,
  type ReplaceTarget,
  type UploadBrand,
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

function ratioOf(media: LocalMedia): Creative['ratio'] | null {
  if (!media.width || !media.height) return null;
  return nearestAspectRatio(media.width, media.height);
}

function placementNote(
  kind: 'cards' | 'assets' | 'creatives' | 'single',
  leftover: number,
  skipped: number,
): string | null {
  const parts: string[] = [];
  if (kind === 'single' && leftover > 0) {
    parts.push('Showing the first file. Turn Batch on to add one creative per file.');
  } else if (kind === 'cards' && leftover > 0) {
    parts.push(`Carousel holds 10 cards. ${leftover} ${leftover === 1 ? 'file was' : 'files were'} not added.`);
  } else if (kind === 'assets' && leftover > 0) {
    parts.push(`A flexible creative holds 10 assets. ${leftover} ${leftover === 1 ? 'file was' : 'files were'} not added.`);
  } else if (kind === 'creatives' && leftover > 0) {
    parts.push(`A batch holds 20 creatives. ${leftover} ${leftover === 1 ? 'file was' : 'files were'} not added.`);
  }
  if (skipped > 0) {
    parts.push(`${skipped} ${skipped === 1 ? 'file is' : 'files are'} not an image or video.`);
  }
  return parts.length ? parts.join(' ') : null;
}

function revokeAll(creative: Creative) {
  revokeMedia(creative.media);
  creative.assets.forEach((asset) => revokeMedia(asset.media));
  creative.cards.forEach((card) => revokeMedia(card.media));
}

export default function UploadV2Studio({
  brands,
  lockedBrandId,
}: {
  brands: UploadBrand[];
  lockedBrandId?: string;
}) {
  const brandLocked = Boolean(lockedBrandId) || brands.length <= 1;
  const [brandId, setBrandId] = useState<string | undefined>(
    () => lockedBrandId || (brands.length === 1 ? brands[0]?.id : undefined),
  );
  const [creatives, setCreatives] = useState<Creative[]>(() => SAMPLE_CREATIVES.map(cloneCreative));
  const [weekLabel, setWeekLabel] = useState('Week');
  const [creatorName, setCreatorName] = useState('');
  const [creativeType, setCreativeType] = useState<CreativeType>('whitelist');
  const [batchOn, setBatchOn] = useState(false);
  const [index, setIndex] = useState(0);
  const [cardIndexById, setCardIndexById] = useState<Record<string, number>>({});
  const [assetIndexById, setAssetIndexById] = useState<Record<string, number>>({});
  const [mediaNote, setMediaNote] = useState<string | null>(null);

  const safeIndex = Math.min(creatives.length - 1, Math.max(0, index));
  const creative = creatives[safeIndex];
  const cardIndex = Math.min(
    creative.cards.length - 1,
    Math.max(0, cardIndexById[creative.id] ?? 0),
  );
  const assetIndex = Math.min(
    Math.max(0, creative.assets.length - 1),
    Math.max(0, assetIndexById[creative.id] ?? 0),
  );
  const shownMedia = creativeType === 'carousel'
    ? creative.cards[cardIndex]?.media ?? null
    : creativeType === 'flexible'
      ? creative.assets[assetIndex]?.media ?? null
      : creative.media;

  useEffect(() => {
    setWeekLabel(weekFolderLabel());
  }, []);

  useEffect(() => {
    if (lockedBrandId) {
      setBrandId(lockedBrandId);
      return;
    }
    if (brands.length === 1) setBrandId(brands[0].id);
  }, [lockedBrandId, brands]);

  const brand = brands.find((item) => item.id === brandId) ?? null;
  const logoUrl = brandLogoUrl(brand?.websiteUrl);

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

  const pager = creativeType === 'carousel'
    ? { noun: 'card' as const, index: cardIndex + 1, count: creative.cards.length }
    : creativeType === 'flexible'
      ? {
        noun: 'asset' as const,
        index: creative.assets.length === 0 ? 0 : assetIndex + 1,
        count: creative.assets.length,
      }
      : batchOn
        ? { noun: 'creative' as const, index: safeIndex + 1, count: creatives.length }
        : null;

  useEffect(() => {
    if (!pager || pager.count < 2) return;
    const { noun, count } = pager;
    const id = creative.id;
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('input, textarea, select, button, a, [role="combobox"], [role="listbox"]')) return;
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const delta = event.key === 'ArrowLeft' ? -1 : 1;
      if (noun === 'card') {
        setCardIndexById((current) => ({
          ...current,
          [id]: Math.min(count - 1, Math.max(0, (current[id] ?? 0) + delta)),
        }));
      } else if (noun === 'asset') {
        setAssetIndexById((current) => ({
          ...current,
          [id]: Math.min(count - 1, Math.max(0, (current[id] ?? 0) + delta)),
        }));
      } else {
        setIndex((current) => Math.min(count - 1, Math.max(0, current + delta)));
      }
      setMediaNote(null);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pager, creative.id]);

  function patchCreative(patch: Partial<Pick<Creative, 'caption' | 'productKey' | 'productLabel' | 'angle' | 'handle' | 'usageEndDate' | 'perpetual' | 'ratio'>>) {
    const id = creative.id;
    setCreatives((current) => current.map((item) => (
      item.id === id ? { ...item, ...patch } : item
    )));
  }

  function setHeadline(headline: string) {
    const id = creative.id;
    const position = cardIndex;
    setCreatives((current) => current.map((item) => {
      if (item.id !== id) return item;
      return {
        ...item,
        cards: item.cards.map((card, cardPosition) => (
          cardPosition === position ? { ...card, headline } : card
        )),
      };
    }));
  }

  function rememberRatio(media: LocalMedia, fallback: Creative['ratio']): Creative['ratio'] {
    return ratioOf(media) ?? fallback;
  }

  async function readFiles(files: File[]) {
    const accepted = files.flatMap((file) => {
      const kind = mediaKind(file);
      return kind ? [{ file, kind }] : [];
    });
    if (accepted.length === 0) {
      setMediaNote('Use an image or a video. Nothing is uploaded from this prototype.');
      return null;
    }
    const measured = await Promise.all(accepted.map(async (item) => {
      const url = URL.createObjectURL(item.file);
      const size = await measureMedia(url, item.kind);
      const media: LocalMedia = {
        url,
        kind: item.kind,
        name: item.file.name,
        bytes: item.file.size,
        width: size?.width ?? null,
        height: size?.height ?? null,
      };
      return media;
    }));
    return { measured, skipped: files.length - accepted.length };
  }

  async function applyFiles(files: File[]) {
    const read = await readFiles(files);
    if (!read) return;
    const { measured, skipped } = read;
    const snapshotId = creative.id;
    const snapshotType = creativeType;

    if (snapshotType === 'carousel') {
      const placement = addCarouselMedia(creative.cards, measured, createLocalId);
      measured.slice(placement.placed).forEach((media) => revokeMedia(media));
      const snapped = measured.slice(0, placement.placed).map(ratioOf).find(Boolean) ?? null;
      setCreatives((current) => current.map((item) => (
        item.id === snapshotId
          ? { ...item, cards: placement.cards ?? item.cards, ratio: snapped ?? item.ratio }
          : item
      )));
      setCardIndexById((current) => ({ ...current, [snapshotId]: placement.focusIndex }));
      setMediaNote(placementNote('cards', placement.leftover, skipped));
      return;
    }

    if (snapshotType === 'flexible') {
      const placement = addFlexibleAssets(creative.assets, measured, createLocalId);
      measured.slice(placement.placed).forEach((media) => revokeMedia(media));
      const snapped = measured.slice(0, placement.placed).map(ratioOf).find(Boolean) ?? null;
      setCreatives((current) => current.map((item) => (
        item.id === snapshotId
          ? { ...item, assets: placement.assets ?? item.assets, ratio: snapped ?? item.ratio }
          : item
      )));
      if (placement.placed > 0) {
        setAssetIndexById((current) => ({ ...current, [snapshotId]: placement.focusIndex }));
      }
      setMediaNote(placementNote('assets', placement.leftover, skipped));
      return;
    }

    if (batchOn) {
      const placement = appendBatchCreatives(creatives, measured, creative, createLocalId);
      measured.slice(placement.placed).forEach((media) => revokeMedia(media));
      setCreatives(placement.creatives);
      if (placement.placed > 0) setIndex(placement.firstNewIndex);
      setMediaNote(placementNote('creatives', placement.leftover, skipped));
      return;
    }

    const first = measured[0];
    measured.slice(1).forEach((media) => revokeMedia(media));
    if (creative.media) {
      const previous = creative.media;
      queueMicrotask(() => revokeMedia(previous));
    }
    setCreatives((current) => current.map((item) => (
      item.id === snapshotId
        ? { ...item, media: first, ratio: rememberRatio(first, item.ratio) }
        : item
    )));
    setMediaNote(placementNote('single', measured.length - 1, skipped));
  }

  async function applyReplace(files: File[], target: ReplaceTarget) {
    const read = await readFiles(files);
    if (!read) return;
    const nextMedia = read.measured[0];
    read.measured.slice(1).forEach((media) => revokeMedia(media));
    const snapshotId = creative.id;

    if (target.kind === 'card') {
      const previous = creative.cards[target.index]?.media ?? null;
      if (previous) queueMicrotask(() => revokeMedia(previous));
      setCreatives((current) => current.map((item) => {
        if (item.id !== snapshotId) return item;
        return {
          ...item,
          ratio: rememberRatio(nextMedia, item.ratio),
          cards: item.cards.map((card, cardPosition) => (
            cardPosition === target.index ? { ...card, media: nextMedia } : card
          )),
        };
      }));
      setCardIndexById((current) => ({ ...current, [snapshotId]: target.index }));
      setMediaNote(null);
      return;
    }

    if (target.kind === 'asset') {
      const previous = creative.assets[target.index]?.media ?? null;
      if (previous) queueMicrotask(() => revokeMedia(previous));
      setCreatives((current) => current.map((item) => {
        if (item.id !== snapshotId) return item;
        return {
          ...item,
          ratio: rememberRatio(nextMedia, item.ratio),
          assets: item.assets.map((asset, assetPosition) => (
            assetPosition === target.index ? { ...asset, media: nextMedia } : asset
          )),
        };
      }));
      setAssetIndexById((current) => ({ ...current, [snapshotId]: target.index }));
      setMediaNote(null);
      return;
    }

    const previous = creatives[target.creativeIndex]?.media ?? null;
    if (previous) queueMicrotask(() => revokeMedia(previous));
    const targetId = creatives[target.creativeIndex]?.id;
    setCreatives((current) => current.map((item) => (
      item.id === targetId
        ? { ...item, media: nextMedia, ratio: rememberRatio(nextMedia, item.ratio) }
        : item
    )));
    if (targetId) setIndex(target.creativeIndex);
    setMediaNote(null);
  }

  function removeMedia(creativeIndex: number) {
    const target = creatives[creativeIndex];
    if (!target) return;
    if (target.userAdded && creatives.length > 1) {
      queueMicrotask(() => revokeAll(target));
      setCreatives((current) => current.filter((item) => item.id !== target.id));
      setIndex((current) => Math.max(0, current > creativeIndex ? current - 1 : Math.min(current, creatives.length - 2)));
      setMediaNote(null);
      return;
    }
    if (target.media) {
      const previous = target.media;
      queueMicrotask(() => revokeMedia(previous));
    }
    setCreatives((current) => current.map((item) => (
      item.id === target.id ? { ...item, media: null } : item
    )));
    setMediaNote(null);
  }

  function removeCard(cardPosition: number) {
    const id = creative.id;
    const previous = creative.cards[cardPosition]?.media ?? null;
    const nextCards = removeCarouselCard(creative.cards, cardPosition);
    if (!nextCards) return;
    if (previous) queueMicrotask(() => revokeMedia(previous));
    setCreatives((current) => current.map((item) => (
      item.id === id ? { ...item, cards: nextCards } : item
    )));
    setCardIndexById((current) => {
      const existing = current[id] ?? 0;
      const nextIndex = existing > cardPosition ? existing - 1 : existing === cardPosition ? Math.max(0, cardPosition - 1) : existing;
      return { ...current, [id]: nextIndex };
    });
    setMediaNote(null);
  }

  function removeAsset(assetPosition: number) {
    const id = creative.id;
    const previous = creative.assets[assetPosition]?.media ?? null;
    if (!previous && !creative.assets[assetPosition]) return;
    if (previous) queueMicrotask(() => revokeMedia(previous));
    setCreatives((current) => current.map((item) => (
      item.id === id
        ? { ...item, assets: item.assets.filter((_, position) => position !== assetPosition) }
        : item
    )));
    setAssetIndexById((current) => {
      const existing = current[id] ?? 0;
      const nextIndex = existing > assetPosition ? existing - 1 : existing === assetPosition ? Math.max(0, assetPosition - 1) : existing;
      return { ...current, [id]: nextIndex };
    });
    setMediaNote(null);
  }

  function reorderCards(from: number, to: number) {
    const id = creative.id;
    setCreatives((current) => current.map((item) => (
      item.id === id ? { ...item, cards: moveItem(item.cards, from, to) } : item
    )));
    setCardIndexById((current) => ({ ...current, [id]: followMove(current[id] ?? 0, from, to) }));
  }

  function reorderAssets(from: number, to: number) {
    const id = creative.id;
    setCreatives((current) => current.map((item) => (
      item.id === id ? { ...item, assets: moveItem(item.assets, from, to) } : item
    )));
    setAssetIndexById((current) => ({ ...current, [id]: followMove(current[id] ?? 0, from, to) }));
  }

  function reorderCreatives(from: number, to: number) {
    setCreatives((current) => moveItem(current, from, to));
    setIndex((current) => followMove(current, from, to));
  }

  function stepPager(delta: number) {
    if (!pager || pager.count < 2) return;
    const next = pager.index + delta;
    if (next < 1 || next > pager.count) return;
    setMediaNote(null);
    if (pager.noun === 'card') {
      setCardIndexById((current) => ({ ...current, [creative.id]: next - 1 }));
    } else if (pager.noun === 'asset') {
      setAssetIndexById((current) => ({ ...current, [creative.id]: next - 1 }));
    } else {
      setIndex(next - 1);
    }
  }

  return (
    <div data-prototype="upload-v2" className="grid w-full grid-cols-1 items-start gap-6 lg:grid-cols-[280px_minmax(0,1fr)] lg:gap-x-10">
      <div className="order-2 lg:sticky lg:top-4 lg:col-start-1 lg:row-start-1 lg:self-start">
        <div className="mx-auto mb-3 flex h-11 w-full max-w-[280px] items-center justify-center gap-2">
          {pager ? (
            <>
              <button
                type="button"
                aria-label={`Previous ${pager.noun}`}
                disabled={pager.index <= 1}
                onClick={() => stepPager(-1)}
                className="flex h-11 w-11 items-center justify-center rounded-full text-[#F5F5F8] disabled:cursor-not-allowed disabled:opacity-30"
                style={{ backgroundColor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <p className="min-w-[9.5rem] text-center text-sm font-semibold tabular-nums text-[#F5F5F8]" aria-live="polite">
                {pager.noun === 'card' ? 'Card' : pager.noun === 'asset' ? 'Asset' : 'Creative'} {pager.index} of {pager.count}
              </p>
              <button
                type="button"
                aria-label={`Next ${pager.noun}`}
                disabled={pager.count < 1 || pager.index >= pager.count}
                onClick={() => stepPager(1)}
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
          assetIndex={assetIndex}
          brandName={brand?.name ?? ''}
          brandLogoUrl={logoUrl}
          onDropFiles={applyFiles}
        />
      </div>
      <div className="order-1 min-w-0 lg:col-start-2 lg:row-start-1">
        <ControlCard
          weekLabel={weekLabel}
          brandName={brand?.name ?? ''}
          brands={brands}
          brandId={brandId}
          brandLocked={brandLocked}
          onBrand={(id) => {
            setBrandId(id);
            setCreatives((current) => current.map((item) => {
              const next = productAfterBrandChange(item.productKey, item.productLabel);
              if (next.productKey === item.productKey && next.productLabel === item.productLabel) return item;
              return { ...item, ...next };
            }));
          }}
          creatorName={creatorName}
          creative={creative}
          creativeIndex={safeIndex}
          creativeCount={creatives.length}
          batchOn={batchOn}
          creatives={creatives}
          creativeType={creativeType}
          cardIndex={cardIndex}
          assetIndex={assetIndex}
          shownMedia={shownMedia}
          mediaNote={mediaNote}
          onCreativeType={(value) => {
            setCreativeType(value);
            setMediaNote(null);
          }}
          onCreatorName={setCreatorName}
          onBatch={(value) => {
            setBatchOn(value);
            setMediaNote(null);
          }}
          onSelectCreative={(next) => {
            setIndex(next);
            setMediaNote(null);
          }}
          onSelectCard={(next) => {
            setCardIndexById((current) => ({ ...current, [creative.id]: next }));
          }}
          onSelectAsset={(next) => {
            setAssetIndexById((current) => ({ ...current, [creative.id]: next }));
          }}
          onPatch={patchCreative}
          onHeadline={setHeadline}
          onFiles={applyFiles}
          onReplace={applyReplace}
          onRemoveMedia={removeMedia}
          onRemoveCard={removeCard}
          onRemoveAsset={removeAsset}
          onReorderCards={reorderCards}
          onReorderAssets={reorderAssets}
          onReorderCreatives={reorderCreatives}
        />
      </div>
    </div>
  );
}
