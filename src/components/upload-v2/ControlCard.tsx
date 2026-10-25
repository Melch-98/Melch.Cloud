'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { GalleryHorizontal, Layers, Upload, Users, type LucideIcon } from 'lucide-react';
import {
  SAMPLE_PRODUCTS,
  aspectCropNote,
  type AspectRatio,
  type Creative,
  type CreativeType,
  type LocalMedia,
  type SampleProduct,
} from '@/components/upload-v2/model';
import { localToday, usageEndDateError } from '@/lib/usage-end-date';

const inputClass =
  'w-full px-3.5 py-2.5 rounded-lg text-sm text-[#F5F5F8] placeholder-gray-600 focus:outline-none transition-all focus:border-[#C8B89A]/40';

const inputStyle: React.CSSProperties = {
  backgroundColor: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.08)',
};

const sectionLabelClass = 'text-xs font-medium text-gray-500 uppercase tracking-wider mb-2 block';

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
  creative: Creative;
  creativeIndex: number;
  creativeCount: number;
  batchOn: boolean;
  creatives: Creative[];
  creativeType: CreativeType;
  cardIndex: number;
  shownMedia: LocalMedia | null;
  mediaNote: string | null;
  onCreativeType: (value: CreativeType) => void;
  onBatch: (value: boolean) => void;
  onSelectCreative: (index: number) => void;
  onPatch: (patch: CreativePatch) => void;
  onHeadline: (headline: string) => void;
  onFiles: (files: File[]) => void;
  onClearMedia: () => void;
};

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; icon?: LucideIcon }[];
  onChange: (value: T) => void;
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
      <span id={labelId} className={sectionLabelClass}>
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
              className="flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-1.5 py-2 text-[11px] font-medium transition-colors sm:px-2 sm:text-[12px]"
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
}: {
  productKey: string;
  productLabel: string;
  creativeId: string;
  onChange: (choice: SampleProduct) => void;
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
      <label htmlFor={inputId} className={sectionLabelClass}>
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
      <p className="mt-1 text-[10px] text-gray-600">Sample catalog. Nothing is loaded from a store.</p>
    </div>
  );
}

export default function ControlCard(props: ControlCardProps) {
  const {
    creative,
    creativeIndex,
    creativeCount,
    batchOn,
    creatives,
    creativeType,
    cardIndex,
    shownMedia,
    mediaNote,
    onCreativeType,
    onBatch,
    onSelectCreative,
    onPatch,
    onHeadline,
    onFiles,
    onClearMedia,
  } = props;
  const switchId = useId();
  const handleId = useId();
  const usageDateId = useId();
  const perpetualId = useId();
  const angleId = useId();
  const captionId = useId();
  const headlineId = useId();
  const fileId = useId();
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const activeCard = creative.cards[Math.min(creative.cards.length - 1, Math.max(0, cardIndex))];
  const usageError = creative.perpetual ? null : usageEndDateError(creative.usageEndDate, localToday());
  const cropNote = shownMedia?.width && shownMedia.height
    ? aspectCropNote(shownMedia.width, shownMedia.height, creative.ratio)
    : null;
  const dropLabel = creativeType === 'carousel'
    ? `Drop media for card ${cardIndex + 1}`
    : 'Drop media for this creative';

  return (
    <div
      className="min-w-0 rounded-xl p-4 sm:p-5"
      style={{ backgroundColor: '#111111', border: '1px solid rgba(255,255,255,0.06)' }}
    >
      <div className="space-y-5">
        <Segmented
          label="Creative upload type"
          value={creativeType}
          options={TYPE_OPTIONS}
          onChange={onCreativeType}
        />

        <div>
          <div className="flex items-center justify-between gap-3">
            <label id={switchId} htmlFor={`${switchId}-switch`} className="text-xs font-medium uppercase tracking-wider text-gray-500">
              Batch
            </label>
            <button
              id={`${switchId}-switch`}
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
          <p className="mt-2 min-h-[2rem] text-[11px] leading-4 text-gray-500">
            {batchOn
              ? 'Arrows above the phone move through this sample batch.'
              : 'Batch is off. The preview shows one creative.'}
          </p>
          {batchOn ? (
            <div
              role="group"
              aria-label="Creatives in this batch"
              className="mt-2 flex gap-2 overflow-x-auto pb-1"
            >
              {creatives.map((item, index) => {
                const selected = index === creativeIndex;
                const thumb = item.media ?? item.cards[0]?.media ?? null;
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-current={selected ? 'true' : undefined}
                    aria-label={`${item.name}, creative ${index + 1} of ${creativeCount}`}
                    onClick={() => onSelectCreative(index)}
                    className="w-16 shrink-0 text-left"
                  >
                    <span
                      className="relative block h-[72px] overflow-hidden rounded-lg"
                      style={{
                        boxShadow: selected ? '0 0 0 2px #C8B89A' : '0 0 0 1px rgba(255,255,255,0.08)',
                        background: `linear-gradient(160deg, ${item.from}, ${item.to})`,
                      }}
                    >
                      {thumb?.kind === 'image' ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={thumb.url} alt="" className="h-full w-full object-cover" />
                      ) : null}
                      <span className="absolute left-1 top-1 rounded bg-black/65 px-1 text-[9px] font-semibold text-white">
                        {index + 1}
                      </span>
                    </span>
                    <span
                      className="mt-1 block truncate text-[10px]"
                      style={{ color: selected ? '#C8B89A' : '#ABABAB' }}
                    >
                      {item.name}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>

        {creativeType === 'whitelist' ? (
          <div className="space-y-4">
            <div>
              <label htmlFor={handleId} className={sectionLabelClass}>
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
            <div>
              <label htmlFor={usageDateId} className="text-[11px] text-gray-500 mb-1 block">
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
              <label htmlFor={perpetualId} className="mt-2 flex items-center gap-2 text-sm text-[#F5F5F8]">
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
              <span className="text-[10px] text-gray-600 mt-1 block">
                Optional. When whitelist or creator usage should end.
              </span>
              {usageError ? (
                <span className="text-[11px] text-red-400 mt-1 block">{usageError}</span>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="border-t border-white/5 pt-4">
          <p className={sectionLabelClass}>This creative</p>
          <p className="-mt-1 mb-3 truncate text-xs font-medium text-[#C8B89A]">
            {batchOn ? `${creativeIndex + 1}. ${creative.name}` : creative.name}
            <span className="ml-2 font-normal text-gray-600">Sample</span>
          </p>
          <div className="space-y-4">
            <div>
              <Segmented
                label="Aspect ratio"
                value={creative.ratio}
                options={RATIO_OPTIONS}
                onChange={(ratio) => onPatch({ ratio })}
              />
              <p className="mt-2 text-[10px] leading-4 text-gray-600">
                Sets this creative’s frame. A file snaps it to the nearest ratio.
              </p>
              {cropNote ? (
                <p role="status" className="mt-1 text-[11px] leading-4 text-[#C8B89A]">{cropNote}</p>
              ) : null}
            </div>
            <ProductField
              productKey={creative.productKey}
              productLabel={creative.productLabel}
              creativeId={creative.id}
              onChange={(choice) => onPatch({ productKey: choice.product_key, productLabel: choice.product_label })}
            />
            <div>
              <label htmlFor={angleId} className={sectionLabelClass}>
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
            <div>
              <label htmlFor={captionId} className={sectionLabelClass}>
                Caption / primary text
              </label>
              <textarea
                id={captionId}
                value={creative.caption}
                rows={3}
                placeholder="Type your caption"
                onChange={(event) => onPatch({ caption: event.target.value })}
                className={`${inputClass} resize-none`}
                style={inputStyle}
              />
            </div>
            {creativeType === 'carousel' ? (
              <div>
                <label htmlFor={headlineId} className={sectionLabelClass}>
                  Card headline
                </label>
                <input
                  id={headlineId}
                  value={activeCard.headline}
                  onChange={(event) => onHeadline(event.target.value)}
                  placeholder={`Headline for card ${cardIndex + 1}`}
                  className={inputClass}
                  style={inputStyle}
                />
                <p className="mt-1 text-[10px] text-gray-600">
                  Card {cardIndex + 1} of {creative.cards.length}. Swipe the phone or use the dots.
                </p>
              </div>
            ) : null}
            <div>
              <span className={sectionLabelClass}>Media</span>
              <div
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
                  onFiles(Array.from(event.dataTransfer.files));
                }}
                className="rounded-lg"
                style={{
                  border: dragOver ? '1px dashed #C8B89A' : '1px dashed rgba(255,255,255,0.16)',
                  backgroundColor: dragOver ? 'rgba(200,184,154,0.08)' : 'rgba(255,255,255,0.02)',
                }}
              >
                <label htmlFor={fileId} className="flex cursor-pointer flex-col items-center gap-1 px-4 py-5 text-center">
                  <Upload className="h-4 w-4 text-[#C8B89A]" aria-hidden />
                  <span className="text-sm text-[#F5F5F8]">{dropLabel}</span>
                  <span className="max-w-full truncate text-[11px] text-gray-500">
                    {shownMedia ? shownMedia.name : 'Image or video. Stays in this browser tab.'}
                  </span>
                  <input
                    ref={fileRef}
                    id={fileId}
                    type="file"
                    accept="image/*,video/*"
                    multiple
                    className="sr-only"
                    onChange={(event) => {
                      const files = event.target.files ? Array.from(event.target.files) : [];
                      event.target.value = '';
                      if (files.length) onFiles(files);
                    }}
                  />
                </label>
                {shownMedia ? (
                  <div className="flex justify-center pb-3">
                    <button
                      type="button"
                      onClick={onClearMedia}
                      className="rounded-md px-2 py-1 text-[11px] text-[#ABABAB] hover:text-[#F5F5F8]"
                    >
                      Remove media
                    </button>
                  </div>
                ) : null}
              </div>
              {mediaNote ? (
                <p role="alert" className="mt-2 text-[11px] text-[#C8B89A]">
                  {mediaNote}
                </p>
              ) : null}
            </div>
          </div>
        </div>

        <p className="text-[11px] leading-relaxed text-gray-500">
          Look-and-feel prototype. The six creatives are placeholders. A file you drop is previewed in this tab only and is not uploaded.
        </p>
      </div>
    </div>
  );
}
