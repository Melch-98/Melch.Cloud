'use client';

import { useEffect, useId, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  GalleryHorizontal,
  GripVertical,
  Layers,
  Upload,
  Users,
  type LucideIcon,
} from 'lucide-react';
import {
  BATCH_MAX_CREATIVES,
  CAROUSEL_MAX_CARDS,
  CAROUSEL_MIN_CARDS,
  FLEXIBLE_MAX_ASSETS,
  SAMPLE_BRAND,
  SAMPLE_PRODUCTS,
  aspectCropNote,
  formatBytes,
  mediaRatioLabel,
  previewCreativeFileNames,
  type AspectRatio,
  type Creative,
  type CreativeType,
  type LocalMedia,
  type ReplaceTarget,
  type SampleProduct,
} from '@/components/upload-v2/model';
import { localToday, usageEndDateError } from '@/lib/usage-end-date';

const inputClass =
  'h-10 w-full rounded-lg px-3 text-sm text-[#F5F5F8] placeholder:text-gray-600 focus:outline-none focus:border-[#C8B89A]/40';

const inputStyle: React.CSSProperties = {
  backgroundColor: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.08)',
};

const fieldLabelClass = 'mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-gray-500';

const TYPE_OPTIONS: { value: CreativeType; label: string; icon: LucideIcon }[] = [
  { value: 'whitelist', label: 'Whitelist', icon: Users },
  { value: 'carousel', label: 'Carousel', icon: GalleryHorizontal },
  { value: 'flexible', label: 'Flexible', icon: Layers },
];

const RATIO_OPTIONS: { value: AspectRatio; label: string }[] = [
  { value: '9:16', label: '9:16' },
  { value: '4:5', label: '4:5' },
  { value: '1:1', label: '1:1' },
];

type CreativePatch = Partial<Pick<Creative, 'caption' | 'productKey' | 'productLabel' | 'angle' | 'handle' | 'usageEndDate' | 'perpetual' | 'ratio'>>;

type ControlCardProps = {
  weekLabel: string;
  creatorName: string;
  creative: Creative;
  creativeIndex: number;
  creativeCount: number;
  batchOn: boolean;
  creatives: Creative[];
  creativeType: CreativeType;
  cardIndex: number;
  assetIndex: number;
  shownMedia: LocalMedia | null;
  mediaNote: string | null;
  onCreativeType: (value: CreativeType) => void;
  onCreatorName: (value: string) => void;
  onBatch: (value: boolean) => void;
  onSelectCreative: (index: number) => void;
  onSelectCard: (index: number) => void;
  onSelectAsset: (index: number) => void;
  onPatch: (patch: CreativePatch) => void;
  onHeadline: (headline: string) => void;
  onFiles: (files: File[]) => void;
  onReplace: (files: File[], target: ReplaceTarget) => void;
  onRemoveMedia: (creativeIndex: number) => void;
  onRemoveCard: (index: number) => void;
  onRemoveAsset: (index: number) => void;
  onReorderCards: (from: number, to: number) => void;
  onReorderAssets: (from: number, to: number) => void;
  onReorderCreatives: (from: number, to: number) => void;
};

type FileRowModel = {
  key: string;
  index: number;
  creativeIndex: number;
  name: string;
  bytes: number | null;
  ratio: string;
  media: LocalMedia | null;
  from: string;
  to: string;
  selected: boolean;
  canRemove: boolean;
  removeLabel: string;
};

function SectionHeading({ index, title, hint, hintAlert = false }: { index: number; title: string; hint?: string; hintAlert?: boolean }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">
        <span className="tabular-nums text-[#C8B89A]">{index}</span>
        {title}
      </h2>
      {hint ? (
        <span className={`truncate text-[11px] ${hintAlert ? 'text-[#C8B89A]' : 'text-gray-500'}`}>{hint}</span>
      ) : null}
    </div>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  hideLabel = false,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; icon?: LucideIcon }[];
  onChange: (value: T) => void;
  hideLabel?: boolean;
}) {
  const labelId = useId();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  function onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const horizontal = event.key === 'ArrowRight' || event.key === 'ArrowLeft';
    const vertical = event.key === 'ArrowDown' || event.key === 'ArrowUp';
    if (!horizontal && !vertical) return;
    event.preventDefault();
    event.stopPropagation();
    const direction = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
    const next = (index + direction + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  }

  return (
    <div>
      <span id={labelId} className={hideLabel ? 'sr-only' : fieldLabelClass}>
        {label}
      </span>
      <div role="radiogroup" aria-labelledby={labelId} className="grid grid-cols-3 gap-2">
        {options.map((option, index) => {
          const selected = option.value === value;
          const Icon = option.icon;
          return (
            <button
              key={option.value}
              ref={(node) => {
                refs.current[index] = node;
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              onKeyDown={(event) => onKeyDown(event, index)}
              onClick={() => onChange(option.value)}
              className="flex h-10 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2 text-[12px] font-medium transition-colors"
              style={{
                backgroundColor: selected ? 'rgba(200,184,154,0.15)' : 'transparent',
                border: selected ? '1px solid rgba(200,184,154,0.35)' : '1px solid rgba(255,255,255,0.08)',
                color: selected ? '#C8B89A' : '#ABABAB',
              }}
            >
              {Icon ? <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden /> : null}
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ProductField({
  productKey,
  productLabel,
  creativeId,
  onChange,
  onClear,
}: {
  productKey: string;
  productLabel: string;
  creativeId: string;
  onChange: (choice: SampleProduct) => void;
  onClear: () => void;
}) {
  const inputId = useId();
  const listId = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [query, setQuery] = useState(productLabel);

  useEffect(() => {
    setQuery(productLabel);
    setOpen(false);
    setActive(0);
  }, [creativeId, productLabel]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!boxRef.current?.contains(event.target as Node)) {
        setQuery(productLabel);
        setOpen(false);
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, productLabel]);

  const trimmed = query.trim().toLowerCase();
  const showingAll = trimmed === '' || trimmed === productLabel.trim().toLowerCase();
  const options = showingAll
    ? SAMPLE_PRODUCTS
    : SAMPLE_PRODUCTS.filter((product) => product.product_label.toLowerCase().includes(trimmed));

  function choose(choice: SampleProduct) {
    onChange(choice);
    setQuery(choice.product_label);
    setOpen(false);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      if (!open) {
        setOpen(true);
        setActive(Math.max(0, options.findIndex((product) => product.product_key === productKey)));
        return;
      }
      if (options.length === 0) return;
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      setActive((current) => (current + direction + options.length) % options.length);
      return;
    }
    if (event.key === 'Enter' && open) {
      event.preventDefault();
      const option = options[active];
      if (option) choose(option);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setQuery(productLabel);
      setOpen(false);
    }
  }

  return (
    <div ref={boxRef} className="relative">
      <label htmlFor={inputId} className={fieldLabelClass}>
        Product
      </label>
      <input
        id={inputId}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && options[active] ? `${listId}-opt-${active}` : undefined}
        value={query}
        placeholder="Search products"
        autoComplete="off"
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={(event) => {
          setOpen(true);
          event.currentTarget.select();
        }}
        onBlur={() => {
          setQuery(productLabel);
          setOpen(false);
        }}
        onKeyDown={onKeyDown}
        className={inputClass}
        style={inputStyle}
      />
      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Products"
          className="absolute left-0 right-0 z-30 mt-1 max-h-52 overflow-auto rounded-lg py-1 shadow-popover"
          style={{ backgroundColor: '#1A1A1A', border: '1px solid rgba(255,255,255,0.1)' }}
        >
          {options.length === 0 ? (
            <li className="px-3 py-2 text-sm text-gray-500">No matches in the sample catalog.</li>
          ) : (
            options.map((product, index) => {
              const highlighted = index === active;
              const selected = product.product_key === productKey;
              return (
                <li key={product.product_key} id={`${listId}-opt-${index}`} role="option" aria-selected={selected}>
                  <button
                    type="button"
                    className="block w-full px-3 py-2 text-left text-sm"
                    style={{
                      backgroundColor: highlighted ? 'rgba(200,184,154,0.15)' : 'transparent',
                      color: highlighted || selected ? '#C8B89A' : '#F5F5F8',
                    }}
                    onMouseEnter={() => setActive(index)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => choose(product)}
                  >
                    {product.product_label}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      ) : null}
      {productKey ? (
        <button
          type="button"
          onClick={onClear}
          className="mt-1 text-[11px] text-gray-500 underline decoration-gray-700 underline-offset-2 hover:text-[#F5F5F8]"
        >
          Clear product
        </button>
      ) : null}
    </div>
  );
}

function Thumb({ media, from, to }: { media: LocalMedia | null; from: string; to: string }) {
  return (
    <span
      aria-hidden
      className="relative block h-8 w-8 shrink-0 overflow-hidden rounded-md"
      style={{ background: `linear-gradient(160deg, ${from}, ${to})` }}
    >
      {media?.kind === 'image' ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={media.url} alt="" className="h-full w-full object-cover" />
      ) : null}
      {media?.kind === 'video' ? (
        <video src={media.url} muted playsInline preload="metadata" className="h-full w-full object-cover" />
      ) : null}
    </span>
  );
}

function dropHint(creativeType: CreativeType, batchOn: boolean): string {
  if (creativeType === 'carousel') return 'Images and video · 2–10 cards';
  if (creativeType === 'flexible') return 'Images and video · up to 10 assets';
  if (batchOn) return 'Images and video · one creative per file';
  return 'Images and video';
}

export default function ControlCard(props: ControlCardProps) {
  const {
    weekLabel,
    creatorName,
    creative,
    creativeIndex,
    creativeCount,
    batchOn,
    creatives,
    creativeType,
    cardIndex,
    assetIndex,
    shownMedia,
    mediaNote,
    onCreativeType,
    onCreatorName,
    onBatch,
    onSelectCreative,
    onSelectCard,
    onSelectAsset,
    onPatch,
    onHeadline,
    onFiles,
    onReplace,
    onRemoveMedia,
    onRemoveCard,
    onRemoveAsset,
    onReorderCards,
    onReorderAssets,
    onReorderCreatives,
  } = props;
  const switchId = useId();
  const handleId = useId();
  const usageDateId = useId();
  const perpetualId = useId();
  const angleId = useId();
  const captionId = useId();
  const headlineId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const replaceTarget = useRef<ReplaceTarget | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const activeCard = creative.cards[Math.min(creative.cards.length - 1, Math.max(0, cardIndex))];
  const usageError = creative.perpetual ? null : usageEndDateError(creative.usageEndDate, localToday());
  const cropNote = shownMedia?.width && shownMedia.height
    ? aspectCropNote(shownMedia.width, shownMedia.height, creative.ratio)
    : null;
  const fileNames = previewCreativeFileNames({
    creatives,
    creatorName,
    creativeType,
    batchOn,
    activeIndex: creativeIndex,
    activeShownName: shownMedia?.name ?? null,
  });
  const filePreview = fileNames[creativeIndex];
  const savePath = `${SAMPLE_BRAND} / ${weekLabel} / ${filePreview.fileName}`;

  const carouselFull = creative.cards.length >= CAROUSEL_MAX_CARDS && creative.cards.every((card) => card.media);
  const flexibleFull = creative.assets.length >= FLEXIBLE_MAX_ASSETS;
  const batchFull = creatives.length >= BATCH_MAX_CREATIVES;
  const atCap = creativeType === 'carousel' ? carouselFull : creativeType === 'flexible' ? flexibleFull : batchOn && batchFull;

  const rows: FileRowModel[] = [];
  let listLabel = 'Files';
  let reorder: ((from: number, to: number) => void) | null = null;

  if (creativeType === 'carousel' && creative.cards.some((card) => card.media)) {
    listLabel = 'Carousel cards';
    reorder = onReorderCards;
    creative.cards.forEach((card, index) => {
      rows.push({
        key: card.id,
        index,
        creativeIndex,
        name: card.media?.name || 'Empty card',
        bytes: card.media?.bytes ?? null,
        ratio: mediaRatioLabel(card.media),
        media: card.media,
        from: card.from,
        to: card.to,
        selected: index === cardIndex,
        canRemove: creative.cards.length > CAROUSEL_MIN_CARDS,
        removeLabel: `Remove card ${index + 1}`,
      });
    });
  } else if (creativeType === 'flexible' && creative.assets.length > 0) {
    listLabel = 'Flexible assets';
    reorder = onReorderAssets;
    creative.assets.forEach((asset, index) => {
      rows.push({
        key: asset.id,
        index,
        creativeIndex,
        name: asset.media.name,
        bytes: asset.media.bytes,
        ratio: mediaRatioLabel(asset.media),
        media: asset.media,
        from: creative.from,
        to: creative.to,
        selected: index === assetIndex,
        canRemove: true,
        removeLabel: `Remove ${asset.media.name}`,
      });
    });
  } else if (creativeType === 'whitelist' && batchOn) {
    listLabel = 'Creatives in this batch';
    reorder = onReorderCreatives;
    creatives.forEach((item, index) => {
      if (!item.media && !item.userAdded) return;
      rows.push({
        key: item.id,
        index,
        creativeIndex: index,
        name: item.media?.name || item.originalName,
        bytes: item.media?.bytes ?? null,
        ratio: item.media ? mediaRatioLabel(item.media) : item.ratio,
        media: item.media,
        from: item.from,
        to: item.to,
        selected: index === creativeIndex,
        canRemove: true,
        removeLabel: `Remove ${item.media?.name || item.name}`,
      });
    });
  } else if (creative.media) {
    listLabel = 'File';
    rows.push({
      key: creative.id,
      index: 0,
      creativeIndex,
      name: creative.media.name,
      bytes: creative.media.bytes,
      ratio: mediaRatioLabel(creative.media),
      media: creative.media,
      from: creative.from,
      to: creative.to,
      selected: true,
      canRemove: true,
      removeLabel: `Remove ${creative.media.name}`,
    });
  }

  const showList = rows.length > 0;
  const countHint = !showList
    ? undefined
    : creativeType === 'carousel'
      ? `${creative.cards.length} of ${CAROUSEL_MAX_CARDS} cards`
      : creativeType === 'flexible'
        ? `${creative.assets.length} of ${FLEXIBLE_MAX_ASSETS} assets`
        : batchOn
          ? `${rows.length} ${rows.length === 1 ? 'creative' : 'creatives'}`
          : '1 file';
  const capCopy = creativeType === 'carousel'
    ? 'Carousel holds 10 cards.'
    : creativeType === 'flexible'
      ? 'A flexible creative holds 10 assets.'
      : 'A batch holds 20 creatives.';

  function openPicker(target?: ReplaceTarget) {
    replaceTarget.current = target ?? null;
    const input = fileRef.current;
    if (!input) return;
    input.multiple = !target;
    input.click();
  }

  function takeFiles(list: FileList | File[]) {
    const files = Array.from(list);
    const target = replaceTarget.current;
    replaceTarget.current = null;
    if (fileRef.current) fileRef.current.value = '';
    if (!files.length) return;
    if (target) onReplace(files, target);
    else onFiles(files);
  }

  function selectRow(row: FileRowModel) {
    if (creativeType === 'carousel') onSelectCard(row.index);
    else if (creativeType === 'flexible') onSelectAsset(row.index);
    else if (batchOn) onSelectCreative(row.creativeIndex);
  }

  function replaceRow(row: FileRowModel) {
    if (creativeType === 'carousel') openPicker({ kind: 'card', index: row.index });
    else if (creativeType === 'flexible') openPicker({ kind: 'asset', index: row.index });
    else openPicker({ kind: 'media', creativeIndex: row.creativeIndex });
  }

  function removeRow(row: FileRowModel) {
    if (creativeType === 'carousel') onRemoveCard(row.index);
    else if (creativeType === 'flexible') onRemoveAsset(row.index);
    else onRemoveMedia(row.creativeIndex);
  }

  function moveRow(from: number, to: number) {
    if (!reorder || from === to) return;
    reorder(from, to);
  }

  const dragHandlers = {
    onDragEnter: (event: React.DragEvent) => {
      event.preventDefault();
      if (event.dataTransfer.types.includes('Files')) setDragOver(true);
    },
    onDragOver: (event: React.DragEvent) => {
      event.preventDefault();
      if (event.dataTransfer.types.includes('Files')) {
        event.dataTransfer.dropEffect = 'copy';
        setDragOver(true);
      }
    },
    onDragLeave: (event: React.DragEvent) => {
      if (event.currentTarget.contains(event.relatedTarget as Node)) return;
      setDragOver(false);
    },
    onDrop: (event: React.DragEvent) => {
      if (!event.dataTransfer.files?.length) return;
      event.preventDefault();
      event.stopPropagation();
      setDragOver(false);
      replaceTarget.current = null;
      onFiles(Array.from(event.dataTransfer.files));
    },
  };

  return (
    <div
      className="min-w-0 rounded-xl"
      style={{ backgroundColor: '#111111', border: '1px solid rgba(255,255,255,0.06)' }}
    >
      <section data-section="files" className="p-4 sm:p-5" {...dragHandlers}>
        <SectionHeading index={1} title="Files" hint={countHint} hintAlert={atCap} />
        <input
          ref={fileRef}
          type="file"
          accept="image/*,video/*"
          multiple
          className="sr-only"
          aria-label="Upload images or video"
          onChange={(event) => {
            if (event.target.files) takeFiles(event.target.files);
          }}
        />
        {showList ? (
          <div>
            <ul aria-label={listLabel} className="space-y-1">
              {rows.map((row, visibleIndex) => (
                <li
                  key={row.key}
                  onDragOver={(event) => {
                    if (dragIndex == null) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                  }}
                  onDrop={(event) => {
                    if (event.dataTransfer.files?.length) return;
                    event.preventDefault();
                    event.stopPropagation();
                    if (dragIndex == null) return;
                    moveRow(dragIndex, row.index);
                    setDragIndex(null);
                  }}
                  className="flex items-center gap-1.5 rounded-lg px-1.5 py-1"
                  style={{
                    backgroundColor: row.selected ? 'rgba(200,184,154,0.08)' : 'rgba(255,255,255,0.02)',
                    boxShadow: row.selected ? 'inset 0 0 0 1px rgba(200,184,154,0.35)' : 'inset 0 0 0 1px rgba(255,255,255,0.04)',
                  }}
                >
                  {reorder && rows.length > 1 ? (
                    <button
                      type="button"
                      draggable
                      aria-label={`Reorder ${row.name}`}
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = 'move';
                        event.dataTransfer.setData('text/plain', String(row.index));
                        setDragIndex(row.index);
                      }}
                      onDragEnd={() => setDragIndex(null)}
                      onKeyDown={(event) => {
                        if (event.key === 'ArrowUp' && visibleIndex > 0) {
                          event.preventDefault();
                          moveRow(row.index, rows[visibleIndex - 1].index);
                        } else if (event.key === 'ArrowDown' && visibleIndex < rows.length - 1) {
                          event.preventDefault();
                          moveRow(row.index, rows[visibleIndex + 1].index);
                        }
                      }}
                      className="flex h-8 w-6 shrink-0 cursor-grab items-center justify-center rounded text-gray-500 hover:text-[#F5F5F8] active:cursor-grabbing"
                    >
                      <GripVertical className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => selectRow(row)}
                    aria-current={row.selected ? 'true' : undefined}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <Thumb media={row.media} from={row.from} to={row.to} />
                    <span className="w-4 shrink-0 text-[11px] tabular-nums text-gray-500">{visibleIndex + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-[13px] text-[#F5F5F8]">{row.name}</span>
                    <span className="hidden w-14 shrink-0 text-right text-[11px] tabular-nums text-gray-500 sm:block">
                      {row.bytes == null ? '—' : formatBytes(row.bytes)}
                    </span>
                    <span className="w-8 shrink-0 text-right text-[11px] font-medium tabular-nums text-[#C8B89A]">{row.ratio}</span>
                  </button>
                  {reorder && rows.length > 1 ? (
                    <span className="flex shrink-0">
                      <button
                        type="button"
                        aria-label={`Move ${row.name} up`}
                        disabled={visibleIndex === 0}
                        onClick={() => moveRow(row.index, rows[visibleIndex - 1].index)}
                        className="flex h-7 w-6 items-center justify-center rounded text-gray-500 hover:text-[#F5F5F8] disabled:opacity-30"
                      >
                        <ChevronUp className="h-3.5 w-3.5" aria-hidden />
                      </button>
                      <button
                        type="button"
                        aria-label={`Move ${row.name} down`}
                        disabled={visibleIndex === rows.length - 1}
                        onClick={() => moveRow(row.index, rows[visibleIndex + 1].index)}
                        className="flex h-7 w-6 items-center justify-center rounded text-gray-500 hover:text-[#F5F5F8] disabled:opacity-30"
                      >
                        <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    </span>
                  ) : null}
                  {row.media ? (
                    <button
                      type="button"
                      onClick={() => replaceRow(row)}
                      className="shrink-0 rounded px-1.5 py-1 text-[11px] font-medium text-[#C8B89A] hover:text-[#F5F5F8]"
                    >
                      Replace
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => removeRow(row)}
                    disabled={!row.canRemove}
                    aria-label={row.removeLabel}
                    title={row.canRemove ? undefined : 'A carousel needs at least 2 cards.'}
                    className="shrink-0 rounded px-1.5 py-1 text-[11px] font-medium text-gray-400 hover:text-[#F5F5F8] disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
            {atCap ? (
              <p className="mt-2 text-[11px] text-[#C8B89A]">{capCopy}</p>
            ) : creativeType === 'carousel' || creativeType === 'flexible' || batchOn ? (
              <button
                type="button"
                onClick={() => openPicker()}
                className="mt-2 flex h-9 w-full items-center justify-center rounded-lg text-[12px] font-medium text-[#C8B89A]"
                style={{
                  border: dragOver ? '1px dashed #C8B89A' : '1px dashed rgba(255,255,255,0.16)',
                  backgroundColor: dragOver ? 'rgba(200,184,154,0.08)' : 'transparent',
                }}
              >
                Drop more or browse
              </button>
            ) : null}
          </div>
        ) : (
          <button
            type="button"
            data-control="dropzone"
            onClick={() => openPicker()}
            className="flex min-h-[76px] w-full flex-col items-center justify-center gap-0.5 rounded-lg px-4 py-3 text-center"
            style={{
              border: dragOver ? '1px dashed #C8B89A' : '1px dashed rgba(255,255,255,0.2)',
              backgroundColor: dragOver ? 'rgba(200,184,154,0.08)' : 'rgba(255,255,255,0.02)',
            }}
          >
            <Upload className="mb-1 h-4 w-4 text-[#C8B89A]" aria-hidden />
            <span className="text-sm font-medium text-[#F5F5F8]">Drop files here or browse</span>
            <span className="text-[11px] text-gray-500">{dropHint(creativeType, batchOn)}</span>
          </button>
        )}
        {mediaNote ? (
          <p role="status" className="mt-2 text-[11px] leading-4 text-[#C8B89A]">{mediaNote}</p>
        ) : null}
      </section>

      <section data-section="type" className="border-t border-white/[0.06] px-4 py-4 sm:px-5">
        <SectionHeading index={2} title="Upload type" />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="min-w-[220px] flex-1">
            <Segmented
              label="Creative upload type"
              hideLabel
              value={creativeType}
              options={TYPE_OPTIONS}
              onChange={onCreativeType}
            />
          </div>
          <div className="flex h-10 items-center gap-2.5 pl-1">
            <label id={switchId} htmlFor={`${switchId}-switch`} className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">
              Batch
            </label>
            {batchOn ? (
              <span className="text-[11px] font-medium tabular-nums text-[#C8B89A]" aria-hidden>
                {creativeIndex + 1}/{creativeCount}
              </span>
            ) : null}
            <button
              id={`${switchId}-switch`}
              data-control="batch"
              type="button"
              role="switch"
              aria-checked={batchOn}
              aria-labelledby={switchId}
              onClick={() => onBatch(!batchOn)}
              className="relative h-6 w-11 shrink-0 rounded-full transition-colors"
              style={{ backgroundColor: batchOn ? '#C8B89A' : 'rgba(255,255,255,0.12)' }}
            >
              <span
                aria-hidden
                className="absolute top-0.5 h-5 w-5 rounded-full bg-[#0A0A0A] transition-transform duration-150"
                style={{ transform: batchOn ? 'translateX(22px)' : 'translateX(2px)' }}
              />
            </button>
          </div>
        </div>
        <div className="mt-3" data-control="ratio">
          <Segmented
            label="Aspect ratio"
            value={creative.ratio}
            options={RATIO_OPTIONS}
            onChange={(ratio) => onPatch({ ratio })}
          />
          {cropNote ? (
            <p role="status" className="mt-2 text-[11px] leading-4 text-[#C8B89A]">{cropNote}</p>
          ) : (
            <p className="mt-2 text-[11px] leading-4 text-gray-600">A file snaps this to the nearest ratio.</p>
          )}
        </div>
      </section>

      <section data-section="details" className="border-t border-white/[0.06] px-4 py-4 sm:px-5">
        <SectionHeading index={3} title="Details" />
        <div className="space-y-3">
          <div className={`grid grid-cols-1 gap-3 ${creativeType === 'whitelist' ? 'sm:grid-cols-2' : ''}`}>
            <div>
              <label htmlFor="upload-v2-creator-name" className={fieldLabelClass}>
                Creator name
              </label>
              <input
                id="upload-v2-creator-name"
                value={creatorName}
                onChange={(event) => onCreatorName(event.target.value)}
                placeholder="Creator name"
                autoComplete="off"
                className={inputClass}
                style={inputStyle}
              />
            </div>
            {creativeType === 'whitelist' ? (
              <div>
                <label htmlFor={handleId} className={fieldLabelClass}>
                  Creator handle
                </label>
                <input
                  id={handleId}
                  value={creative.handle}
                  onChange={(event) => onPatch({ handle: event.target.value })}
                  placeholder="@sample.creator"
                  autoComplete="off"
                  className={inputClass}
                  style={inputStyle}
                />
              </div>
            ) : null}
          </div>

          {creativeType === 'whitelist' ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor={usageDateId} className={fieldLabelClass}>
                  Usage end date
                </label>
                <input
                  id={usageDateId}
                  type="date"
                  value={creative.perpetual ? '' : creative.usageEndDate}
                  min={localToday()}
                  disabled={creative.perpetual}
                  onChange={(event) => {
                    const value = event.target.value;
                    onPatch({ usageEndDate: value, perpetual: value ? false : creative.perpetual });
                  }}
                  className={`${inputClass} disabled:cursor-not-allowed disabled:opacity-40`}
                  style={{ ...inputStyle, colorScheme: 'dark' }}
                />
              </div>
              <div className="flex items-end">
                <label htmlFor={perpetualId} className="flex h-10 items-center gap-2 text-sm text-[#F5F5F8]">
                  <input
                    id={perpetualId}
                    type="checkbox"
                    checked={creative.perpetual}
                    onChange={(event) => {
                      if (event.target.checked) onPatch({ perpetual: true, usageEndDate: '' });
                      else onPatch({ perpetual: false });
                    }}
                    className="h-3.5 w-3.5 accent-[#C8B89A]"
                  />
                  Perpetual
                </label>
              </div>
              {usageError ? (
                <p className="text-[11px] text-red-400 sm:col-span-2">{usageError}</p>
              ) : (
                <p className="text-[11px] text-gray-600 sm:col-span-2">Optional. Today or later.</p>
              )}
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <ProductField
              productKey={creative.productKey}
              productLabel={creative.productLabel}
              creativeId={creative.id}
              onChange={(choice) => onPatch({ productKey: choice.product_key, productLabel: choice.product_label })}
              onClear={() => onPatch({ productKey: '', productLabel: '' })}
            />
            <div>
              <label htmlFor={angleId} className={fieldLabelClass}>
                Angle
              </label>
              <input
                id={angleId}
                value={creative.angle}
                onChange={(event) => onPatch({ angle: event.target.value })}
                placeholder="Hook or angle"
                autoComplete="off"
                className={inputClass}
                style={inputStyle}
              />
            </div>
          </div>

          <div>
            <label htmlFor={captionId} className={fieldLabelClass}>
              Caption
            </label>
            <textarea
              id={captionId}
              value={creative.caption}
              rows={3}
              placeholder="Primary text"
              onChange={(event) => onPatch({ caption: event.target.value })}
              className={`${inputClass} h-auto resize-none py-2`}
              style={inputStyle}
            />
          </div>

          {creativeType === 'carousel' ? (
            <div>
              <label htmlFor={headlineId} className={fieldLabelClass}>
                Card headline
              </label>
              <input
                id={headlineId}
                value={activeCard?.headline ?? ''}
                onChange={(event) => onHeadline(event.target.value)}
                placeholder={`Headline for card ${cardIndex + 1}`}
                className={inputClass}
                style={inputStyle}
              />
            </div>
          ) : null}
        </div>
      </section>

      <section data-section="saves" className="border-t border-white/[0.06] px-4 py-4 sm:px-5" style={{ backgroundColor: 'rgba(255,255,255,0.02)' }}>
        <SectionHeading index={4} title="Saves to" />
        <p className="break-all text-sm leading-5 text-[#F5F5F8]">
          <span className="font-medium text-[#C8B89A]">{SAMPLE_BRAND}</span>
          <span className="text-gray-600"> / </span>
          {weekLabel}
          <span className="text-gray-600"> / </span>
          <span className="font-mono text-[13px]">{filePreview.fileName}</span>
        </p>
        <p className="mt-1 text-[11px] font-medium text-[#C8B89A]">{filePreview.label}</p>
        <button
          type="button"
          disabled
          className="mt-3 flex h-10 w-full cursor-not-allowed items-center justify-center rounded-lg text-sm font-semibold text-[#0A0A0A] opacity-50"
          style={{ backgroundColor: '#C8B89A' }}
        >
          Submit · prototype
        </button>
        <p className="mt-2 text-[11px] leading-4 text-gray-600">
          Nothing is saved. This week’s folder is the same for every file.
        </p>
        <p className="sr-only">{savePath}</p>
      </section>
    </div>
  );
}
