'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import ControlCard from '@/components/upload-v2/ControlCard';
import {
  BATCH_MAX_CREATIVES,
  EMPTY_UPLOAD_MODES,
  addCarouselMedia,
  addFlexibleAssets,
  appendBatchCreatives,
  assetsFromMedia,
  attachedMedia,
  cardsFromMedia,
  creativesFromMedia,
  createLocalId,
  emptyCreative,
  followMove,
  mediaKind,
  moveItem,
  nearestAspectRatio,
  productAfterBrandChange,
  removeCarouselCard,
  replaceBatchMedia,
  brandLogoUrl,
  revokeMedia,
  toggleUploadMode,
  uploadStructure,
  weekFolderLabel,
  type Creative,
  type LocalMedia,
  type ReplaceTarget,
  type UploadBrand,
  type UploadModes,
  type UploadStructure,
} from '@/components/upload-v2/model';
import PhonePreview from '@/components/upload-v2/PhonePreview';
import { v2SubmitBlocker } from '@/components/upload-v2/map-submission';
import { submitUploadV2, type V2SubmitClient } from '@/components/upload-v2/submit-upload';
import { measuredFileMedia } from '@/lib/media-info';
import { createClient } from '@/lib/supabase';
import { localToday } from '@/lib/usage-end-date';

type CreativeDetails = Pick<Creative, 'caption' | 'productKey' | 'productLabel' | 'angle' | 'handle' | 'usageEndDate' | 'perpetual'>;

const EMPTY_DETAILS: CreativeDetails = {
  caption: '',
  productKey: '',
  productLabel: '',
  angle: '',
  handle: '',
  usageEndDate: '',
  perpetual: false,
};

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
  kind: 'cards' | 'assets' | 'creatives',
  leftover: number,
  skipped: number,
): string | null {
  const parts: string[] = [];
  if (kind === 'cards' && leftover > 0) {
    parts.push(`Carousel holds 10 cards. ${leftover} ${leftover === 1 ? 'file was' : 'files were'} not added.`);
  } else if (kind === 'assets' && leftover > 0) {
    parts.push(`A flexible creative holds 10 assets. ${leftover} ${leftover === 1 ? 'file was' : 'files were'} not added.`);
  } else if (kind === 'creatives' && leftover > 0) {
    parts.push(`You can add ${BATCH_MAX_CREATIVES} creatives. ${leftover} ${leftover === 1 ? 'file was' : 'files were'} not added.`);
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

function withDetails(creative: Creative, details: CreativeDetails): Creative {
  return { ...creative, ...details };
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
  const [weekLabel, setWeekLabel] = useState('Week');
  const [creatorName, setCreatorName] = useState('');
  const [modes, setModes] = useState<UploadModes>(EMPTY_UPLOAD_MODES);
  const [details, setDetails] = useState<CreativeDetails>(EMPTY_DETAILS);
  const [plainCreatives, setPlainCreatives] = useState<Creative[]>([]);
  const [plainIndex, setPlainIndex] = useState(0);
  const [plainRatio, setPlainRatio] = useState<Creative['ratio']>('9:16');
  const [grouped, setGrouped] = useState<Creative>(() => emptyCreative());
  const [cardIndex, setCardIndex] = useState(0);
  const [assetIndex, setAssetIndex] = useState(0);
  const [mediaNote, setMediaNote] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitPhase, setSubmitPhase] = useState<string | null>(null);
  const [submitMessage, setSubmitMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const submittingRef = useRef(false);

  const structure = uploadStructure(modes);
  const plainSafe = plainCreatives.length === 0
    ? 0
    : Math.min(plainCreatives.length - 1, Math.max(0, plainIndex));
  const activePlain = plainCreatives[plainSafe] ?? null;
  const cardCursor = grouped.cards.length === 0
    ? 0
    : Math.min(grouped.cards.length - 1, Math.max(0, cardIndex));
  const assetCursor = grouped.assets.length === 0
    ? 0
    : Math.min(grouped.assets.length - 1, Math.max(0, assetIndex));
  const baseCreative = structure === 'plain'
    ? (activePlain ?? emptyCreative(plainRatio))
    : grouped;
  const displayed = withDetails(baseCreative, details);
  const shownMedia = structure === 'carousel'
    ? grouped.cards[cardCursor]?.media ?? null
    : structure === 'flexible'
      ? grouped.assets[assetCursor]?.media ?? null
      : activePlain?.media ?? null;

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

  const pager = structure === 'carousel'
    ? {
      noun: 'card' as const,
      index: grouped.cards.length === 0 ? 0 : cardCursor + 1,
      count: grouped.cards.length,
    }
    : structure === 'flexible'
      ? {
        noun: 'asset' as const,
        index: grouped.assets.length === 0 ? 0 : assetCursor + 1,
        count: grouped.assets.length,
      }
      : {
        noun: 'creative' as const,
        index: plainCreatives.length === 0 ? 0 : plainSafe + 1,
        count: plainCreatives.length,
      };

  useEffect(() => {
    if (pager.count < 2) return;
    const { noun, count } = pager;
    const id = structure === 'plain' ? (activePlain?.id ?? 'empty') : grouped.id;
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('input, textarea, select, button, a, [role="combobox"], [role="listbox"]')) return;
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const delta = event.key === 'ArrowLeft' ? -1 : 1;
      if (noun === 'card') {
        setCardIndex((current) => Math.min(count - 1, Math.max(0, current + delta)));
      } else if (noun === 'asset') {
        setAssetIndex((current) => Math.min(count - 1, Math.max(0, current + delta)));
      } else {
        setPlainIndex((current) => Math.min(count - 1, Math.max(0, current + delta)));
      }
      setMediaNote(null);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pager, structure, grouped.id, activePlain?.id]);

  function mediaFor(current: UploadStructure): LocalMedia[] {
    if (current === 'carousel') return attachedMedia(grouped.cards);
    if (current === 'flexible') return attachedMedia(grouped.assets);
    return attachedMedia(plainCreatives);
  }

  function retarget(from: UploadStructure, to: UploadStructure) {
    const media = mediaFor(from);
    if (to === 'plain') {
      setPlainCreatives(creativesFromMedia(media, createLocalId));
      setPlainIndex(0);
      return;
    }
    const snapped = media.map(ratioOf).find(Boolean) ?? grouped.ratio;
    setGrouped((current) => ({
      ...current,
      id: current.id === 'empty' ? createLocalId('creative') : current.id,
      ratio: snapped,
      cards: to === 'carousel' ? cardsFromMedia(media, current.cards, createLocalId) : current.cards,
      assets: to === 'flexible' ? assetsFromMedia(media, current.assets, createLocalId) : current.assets,
    }));
    if (to === 'carousel') setCardIndex(0);
    if (to === 'flexible') setAssetIndex(0);
  }

  function onToggleMode(key: keyof UploadModes) {
    const next = toggleUploadMode(modes, key);
    const from = uploadStructure(modes);
    const to = uploadStructure(next);
    if (from !== to) retarget(from, to);
    setModes(next);
    setMediaNote(null);
  }

  function patchCreative(patch: Partial<CreativeDetails & { ratio: Creative['ratio'] }>) {
    if (patch.ratio) {
      const ratio = patch.ratio;
      if (structure === 'plain') {
        if (!activePlain) setPlainRatio(ratio);
        else {
          const id = activePlain.id;
          setPlainCreatives((current) => current.map((item) => (
            item.id === id ? { ...item, ratio } : item
          )));
        }
      } else {
        setGrouped((current) => ({ ...current, ratio }));
      }
    }
    const next: Partial<CreativeDetails> = {};
    if (patch.caption !== undefined) next.caption = patch.caption;
    if (patch.productKey !== undefined) next.productKey = patch.productKey;
    if (patch.productLabel !== undefined) next.productLabel = patch.productLabel;
    if (patch.angle !== undefined) next.angle = patch.angle;
    if (patch.handle !== undefined) next.handle = patch.handle;
    if (patch.usageEndDate !== undefined) next.usageEndDate = patch.usageEndDate;
    if (patch.perpetual !== undefined) next.perpetual = patch.perpetual;
    if (Object.keys(next).length > 0) setDetails((current) => ({ ...current, ...next }));
  }

  function setHeadline(headline: string) {
    const position = cardCursor;
    setGrouped((current) => ({
      ...current,
      cards: current.cards.map((card, cardPosition) => (
        cardPosition === position ? { ...card, headline } : card
      )),
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
      setMediaNote('Use an image or a video.');
      return null;
    }
    const measured = await Promise.all(accepted.map(async (item) => {
      const url = URL.createObjectURL(item.file);
      const size = await measureMedia(url, item.kind);
      const width = size?.width ?? null;
      const height = size?.height ?? null;
      const detected = measuredFileMedia(item.file, width, height);
      const media: LocalMedia = {
        url,
        kind: item.kind,
        name: item.file.name,
        bytes: item.file.size,
        width,
        height,
        file: item.file,
        mediaFormat: detected.mediaFormat,
        detectedAspectRatio: detected.detectedAspectRatio,
      };
      return media;
    }));
    return { measured, skipped: files.length - accepted.length };
  }

  async function applyFiles(files: File[]) {
    const read = await readFiles(files);
    if (!read) return;
    const { measured, skipped } = read;

    if (structure === 'plain') {
      const placement = appendBatchCreatives(plainCreatives, measured, createLocalId);
      measured.slice(placement.placed).forEach((media) => revokeMedia(media));
      setPlainCreatives(placement.creatives);
      if (placement.placed > 0) setPlainIndex(placement.firstNewIndex);
      setMediaNote(placementNote('creatives', placement.leftover, skipped));
      return;
    }

    if (structure === 'carousel') {
      const placement = addCarouselMedia(grouped.cards, measured, createLocalId);
      measured.slice(placement.placed).forEach((media) => revokeMedia(media));
      const snapped = measured.slice(0, placement.placed).map(ratioOf).find(Boolean) ?? null;
      setGrouped((current) => ({
        ...current,
        id: current.id === 'empty' ? createLocalId('creative') : current.id,
        cards: placement.cards ?? current.cards,
        ratio: snapped ?? current.ratio,
      }));
      setCardIndex(placement.focusIndex);
      setMediaNote(placementNote('cards', placement.leftover, skipped));
      return;
    }

    const placement = addFlexibleAssets(grouped.assets, measured, createLocalId);
    measured.slice(placement.placed).forEach((media) => revokeMedia(media));
    const snapped = measured.slice(0, placement.placed).map(ratioOf).find(Boolean) ?? null;
    setGrouped((current) => ({
      ...current,
      id: current.id === 'empty' ? createLocalId('creative') : current.id,
      assets: placement.assets ?? current.assets,
      ratio: snapped ?? current.ratio,
    }));
    if (placement.placed > 0) setAssetIndex(placement.focusIndex);
    setMediaNote(placementNote('assets', placement.leftover, skipped));
  }

  async function applyReplace(files: File[], target: ReplaceTarget) {
    const read = await readFiles(files);
    if (!read) return;
    const nextMedia = read.measured[0];
    read.measured.slice(1).forEach((media) => revokeMedia(media));

    if (structure === 'plain') {
      if (target.kind !== 'media') {
        revokeMedia(nextMedia);
        return;
      }
      const previous = plainCreatives[target.creativeIndex];
      if (!previous) {
        revokeMedia(nextMedia);
        return;
      }
      if (previous.media) {
        const previousMedia = previous.media;
        queueMicrotask(() => revokeMedia(previousMedia));
      }
      setPlainCreatives((current) => current.map((item) => (
        item.id === previous.id ? replaceBatchMedia(item, nextMedia) : item
      )));
      setPlainIndex(target.creativeIndex);
      setMediaNote(null);
      return;
    }

    if (target.kind === 'card' && structure === 'carousel') {
      const previous = grouped.cards[target.index]?.media ?? null;
      if (previous) queueMicrotask(() => revokeMedia(previous));
      setGrouped((current) => ({
        ...current,
        ratio: rememberRatio(nextMedia, current.ratio),
        cards: current.cards.map((card, cardPosition) => (
          cardPosition === target.index ? { ...card, media: nextMedia } : card
        )),
      }));
      setCardIndex(target.index);
      setMediaNote(null);
      return;
    }

    if (target.kind === 'asset' && structure === 'flexible') {
      const previous = grouped.assets[target.index]?.media ?? null;
      if (previous) queueMicrotask(() => revokeMedia(previous));
      setGrouped((current) => ({
        ...current,
        ratio: rememberRatio(nextMedia, current.ratio),
        assets: current.assets.map((asset, assetPosition) => (
          assetPosition === target.index ? { ...asset, media: nextMedia } : asset
        )),
      }));
      setAssetIndex(target.index);
      setMediaNote(null);
      return;
    }

    revokeMedia(nextMedia);
  }

  function removeMedia(creativeIndex: number) {
    const target = plainCreatives[creativeIndex];
    if (!target) return;
    queueMicrotask(() => revokeAll(target));
    setPlainCreatives((current) => current.filter((item) => item.id !== target.id));
    setPlainIndex((current) => (
      current > creativeIndex ? current - 1 : Math.min(current, Math.max(0, plainCreatives.length - 2))
    ));
    setMediaNote(null);
  }

  function removeCard(cardPosition: number) {
    const previous = grouped.cards[cardPosition]?.media ?? null;
    const nextCards = removeCarouselCard(grouped.cards, cardPosition);
    if (!nextCards) {
      if (grouped.cards.length >= 2) return;
      if (!grouped.cards[cardPosition]) return;
      if (previous) queueMicrotask(() => revokeMedia(previous));
      setGrouped((current) => ({
        ...current,
        cards: current.cards.filter((_, position) => position !== cardPosition),
      }));
      setCardIndex(0);
      setMediaNote(null);
      return;
    }
    if (previous) queueMicrotask(() => revokeMedia(previous));
    setGrouped((current) => ({ ...current, cards: nextCards }));
    setCardIndex((existing) => (
      existing > cardPosition ? existing - 1 : existing === cardPosition ? Math.max(0, cardPosition - 1) : existing
    ));
    setMediaNote(null);
  }

  function removeAsset(assetPosition: number) {
    const previous = grouped.assets[assetPosition]?.media ?? null;
    if (!grouped.assets[assetPosition]) return;
    if (previous) queueMicrotask(() => revokeMedia(previous));
    setGrouped((current) => ({
      ...current,
      assets: current.assets.filter((_, position) => position !== assetPosition),
    }));
    setAssetIndex((existing) => (
      existing > assetPosition ? existing - 1 : existing === assetPosition ? Math.max(0, assetPosition - 1) : existing
    ));
    setMediaNote(null);
  }

  function reorderCards(from: number, to: number) {
    setGrouped((current) => ({ ...current, cards: moveItem(current.cards, from, to) }));
    setCardIndex((current) => followMove(current, from, to));
  }

  function reorderAssets(from: number, to: number) {
    setGrouped((current) => ({ ...current, assets: moveItem(current.assets, from, to) }));
    setAssetIndex((current) => followMove(current, from, to));
  }

  function reorderCreatives(from: number, to: number) {
    setPlainCreatives((current) => moveItem(current, from, to));
    setPlainIndex((current) => followMove(current, from, to));
  }

  const today = localToday();
  const submitCreative = withDetails(
    structure === 'plain' ? (activePlain ?? emptyCreative(plainRatio)) : grouped,
    details,
  );
  const submitBlocker = v2SubmitBlocker({
    brandId,
    modes,
    creative: submitCreative,
    plainCreatives,
    today,
  });

  function resetAfterSubmit() {
    plainCreatives.forEach(revokeAll);
    revokeAll(grouped);
    setPlainCreatives([]);
    setPlainIndex(0);
    setPlainRatio('9:16');
    setGrouped(emptyCreative());
    setCardIndex(0);
    setAssetIndex(0);
    setModes(EMPTY_UPLOAD_MODES);
    setCreatorName('');
    setDetails(EMPTY_DETAILS);
    setMediaNote(null);
  }

  async function submit() {
    if (submittingRef.current) return;
    const creative = withDetails(
      structure === 'plain' ? (activePlain ?? emptyCreative(plainRatio)) : grouped,
      details,
    );
    const blocker = v2SubmitBlocker({
      brandId,
      modes,
      creative,
      plainCreatives,
      today: localToday(),
    });
    if (blocker || !brandId) {
      setSubmitMessage({ type: 'error', text: blocker || 'Choose a brand' });
      return;
    }
    const supabase = createClient();
    if (!supabase) {
      setSubmitMessage({ type: 'error', text: 'You need to be signed in' });
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    setSubmitMessage(null);
    setSubmitPhase('Assigning a batch name…');
    try {
      const result = await submitUploadV2({
        supabase: supabase as V2SubmitClient,
        fetch: globalThis.fetch.bind(globalThis),
        now: new Date(),
        onProgress: setSubmitPhase,
      }, {
        brandId,
        creatorName,
        modes,
        creative,
        plainCreatives,
        today: localToday(),
      });
      if (!result.ok) {
        setSubmitMessage({ type: 'error', text: result.error });
        return;
      }
      resetAfterSubmit();
      const filesLabel = result.fileCount === 1 ? 'file' : 'files';
      setSubmitMessage({
        type: 'success',
        text: `Submitted ${result.batchName} — ${result.fileCount} ${filesLabel} uploaded`,
      });
    } catch (error) {
      setSubmitMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Submission failed',
      });
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
      setSubmitPhase(null);
    }
  }

  function stepPager(delta: number) {
    if (pager.count < 2) return;
    const next = pager.index + delta;
    if (next < 1 || next > pager.count) return;
    setMediaNote(null);
    if (pager.noun === 'card') setCardIndex(next - 1);
    else if (pager.noun === 'asset') setAssetIndex(next - 1);
    else setPlainIndex(next - 1);
  }

  return (
    <div data-prototype="upload-v2" className="grid w-full grid-cols-1 items-start gap-6 lg:grid-cols-[280px_minmax(0,1fr)] lg:gap-x-10">
      <div className="order-2 lg:sticky lg:top-4 lg:col-start-1 lg:row-start-1 lg:self-start">
        <div className="mx-auto mb-3 flex h-11 w-full max-w-[280px] items-center justify-center gap-2">
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
        </div>
        <PhonePreview
          creative={displayed}
          structure={structure}
          whitelist={modes.whitelist}
          cardIndex={cardCursor}
          assetIndex={assetCursor}
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
            setDetails((current) => {
              const next = productAfterBrandChange(current.productKey, current.productLabel);
              if (next.productKey === current.productKey && next.productLabel === current.productLabel) return current;
              return { ...current, ...next };
            });
          }}
          creatorName={creatorName}
          creative={displayed}
          creativeIndex={plainSafe}
          modes={modes}
          plainCreatives={plainCreatives}
          cardIndex={cardCursor}
          assetIndex={assetCursor}
          shownMedia={shownMedia}
          mediaNote={mediaNote}
          onToggleMode={onToggleMode}
          onCreatorName={setCreatorName}
          onSelectCreative={(next) => {
            setPlainIndex(next);
            setMediaNote(null);
          }}
          onSelectCard={(next) => setCardIndex(next)}
          onSelectAsset={(next) => setAssetIndex(next)}
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
          canSubmit={!submitBlocker}
          submitting={submitting}
          submitPhase={submitPhase}
          submitHint={submitBlocker}
          submitError={submitMessage?.type === 'error' ? submitMessage.text : null}
          submitSuccess={submitMessage?.type === 'success' ? submitMessage.text : null}
          onSubmit={() => { void submit(); }}
        />
      </div>
    </div>
  );
}
