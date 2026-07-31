'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Layers } from 'lucide-react';
import type { FileMediaInfo } from './FileUploader';
import { FileContext } from '@/lib/types';
import CreativeTypeSelector from './CreativeTypeSelector';

interface Product {
  shopify_product_id: string;
  title: string;
  product_type: string;
  handle: string;
}

interface CopyTemplateOption {
  id: string;
  title: string;
}

interface AssetDetailPanelProps {
  files: File[];
  selectedIndices: number[];
  mediaInfo: Record<number, FileMediaInfo>;
  fileContexts: Record<number, Partial<FileContext>>;
  products: Product[];
  copyTemplateOptions: CopyTemplateOption[];
  isCarousel: boolean;
  isWhitelist: boolean;
  errors: Record<string, string>;
  /** Apply a partial context update to every selected index */
  onContextChange: (indices: number[], updates: Partial<FileContext>) => void;
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return (bytes / Math.pow(k, i)).toFixed(1) + ' ' + sizes[i];
}

function prettyRatio(r?: string): string | null {
  switch (r) {
    case '1x1': return '1:1';
    case '9x16': return '9:16';
    case '4x5': return '4:5';
    case '16x9': return '16:9';
    default: return null;
  }
}

const inputClass =
  'w-full px-3 py-2 rounded-lg text-sm text-[#F5F5F8] placeholder-gray-600 focus:outline-none focus:border-[#C8B89A]/40 transition-all';

const inputStyle: React.CSSProperties = {
  backgroundColor: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.08)',
};

const labelClass =
  'block text-[10px] font-medium text-gray-500 uppercase tracking-wider mb-1 flex items-center gap-1.5';

const MixedBadge = () => (
  <span
    className="text-[9px] font-bold px-1.5 py-0.5 rounded normal-case tracking-normal"
    style={{ backgroundColor: 'rgba(234,179,8,0.12)', color: '#EAB308' }}
  >
    Mixed
  </span>
);

// Renders product <option>s grouped by product_type
function ProductOptions({ products }: { products: Product[] }) {
  const groups = new Map<string, Product[]>();
  for (const p of products) {
    const key = p.product_type || '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(p);
  }
  const entries = Array.from(groups.entries());

  return (
    <>
      {entries.map(([type, prods]) => {
        if (!type) {
          return prods.map((p) => (
            <option key={p.shopify_product_id} value={p.shopify_product_id}>
              {p.title}
            </option>
          ));
        }
        return (
          <optgroup key={type} label={type}>
            {prods.map((p) => (
              <option key={p.shopify_product_id} value={p.shopify_product_id}>
                {p.title}
              </option>
            ))}
          </optgroup>
        );
      })}
    </>
  );
}

const AssetDetailPanel: React.FC<AssetDetailPanelProps> = ({
  files,
  selectedIndices,
  mediaInfo,
  fileContexts,
  products,
  copyTemplateOptions,
  isCarousel,
  isWhitelist,
  errors,
  onContextChange,
}) => {
  const [visible, setVisible] = useState(false);
  const multi = selectedIndices.length > 1;
  const primaryIdx = selectedIndices[0];
  const primaryFile = files[primaryIdx];

  // Slide-in transition
  useEffect(() => {
    setVisible(false);
    const t = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(t);
  }, [primaryIdx, selectedIndices.length]);

  // Large preview thumbnail for the primary selection
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!primaryFile) return;
    if (primaryFile.type.startsWith('image/')) {
      const url = URL.createObjectURL(primaryFile);
      setPreviewUrl(url);
      return () => URL.revokeObjectURL(url);
    }
    if (primaryFile.type.startsWith('video/')) {
      const url = URL.createObjectURL(primaryFile);
      const video = document.createElement('video');
      video.preload = 'auto';
      video.muted = true;
      video.playsInline = true;
      video.src = url;
      video.addEventListener('loadeddata', () => {
        video.currentTime = 0.5;
      });
      video.addEventListener('seeked', () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(video, 0, 0);
            setPreviewUrl(canvas.toDataURL('image/jpeg', 0.7));
          }
        } catch {
          setPreviewUrl(null);
        }
        URL.revokeObjectURL(url);
      });
      video.addEventListener('error', () => {
        URL.revokeObjectURL(url);
        setPreviewUrl(null);
      });
      return;
    }
    setPreviewUrl(null);
  }, [primaryFile]);

  // Field value across selection: returns [value, isMixed]
  const fieldValue = useMemo(() => {
    return (key: keyof FileContext): [string, boolean] => {
      const vals = selectedIndices.map(
        (i) => ((fileContexts[i] as any)?.[key] as string) || ''
      );
      const first = vals[0] ?? '';
      const mixed = vals.some((v) => v !== first);
      return [mixed ? '' : first, mixed];
    };
  }, [selectedIndices, fileContexts]);

  if (!primaryFile) return null;

  const info = mediaInfo[primaryIdx];
  const ratio = prettyRatio(info?.aspectRatio);

  // Shared file format for the type selector dim logic. If the selection mixes
  // static + video, pass null (no dimming).
  const formats = selectedIndices.map((i) => {
    const f = files[i];
    if (!f) return null;
    if (f.type.startsWith('video/')) return 'video' as const;
    if (f.type.startsWith('image/')) return 'static' as const;
    return null;
  });
  const uniformFormat =
    formats.every((f) => f === formats[0]) ? formats[0] : null;

  const [creativeType, creativeTypeMixed] = fieldValue('creativeType');
  const [productId, productMixed] = fieldValue('productId');
  const [hookAngle, hookMixed] = fieldValue('hookAngle');
  const [copyTemplate, copyTplMixed] = fieldValue('copyTemplate');
  const [creatorName, creatorMixed] = fieldValue('creatorName');
  const [creatorHandle, handleMixed] = fieldValue('creatorHandle');
  const [copyHeadline] = fieldValue('copyHeadline');
  const [copyBody] = fieldValue('copyBody');

  const apply = (updates: Partial<FileContext>) =>
    onContextChange(selectedIndices, updates);

  return (
    <div
      className="rounded-xl overflow-hidden transition-all duration-200"
      style={{
        backgroundColor: '#111111',
        border: '1px solid rgba(255,255,255,0.08)',
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(12px)',
      }}
    >
      {/* Header: preview + meta OR bulk header */}
      <div
        className="flex gap-4 p-4"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
      >
        {!multi && (
          <div
            className="flex-shrink-0 rounded-lg overflow-hidden flex items-center justify-center"
            style={{ width: 120, height: 120, backgroundColor: 'rgba(0,0,0,0.4)' }}
          >
            {previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewUrl}
                alt={primaryFile.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-8 h-8 rounded bg-gray-800" />
            )}
          </div>
        )}
        <div className="flex-1 min-w-0 flex flex-col justify-center">
          {multi ? (
            <>
              <p className="text-sm font-semibold text-[#C8B89A] flex items-center gap-2">
                <Layers className="w-4 h-4" />
                Tagging {selectedIndices.length} assets
              </p>
              <p className="text-[11px] text-gray-500 mt-1">
                Changes apply to all selected assets. Fields marked
                &ldquo;Mixed&rdquo; differ across the selection.
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-medium text-[#F5F5F8] truncate">
                {primaryFile.name}
              </p>
              <p className="text-[11px] text-[#ABABAB] mt-1">
                {info && info.width > 0 ? `${info.width}x${info.height}` : '—'}
                {ratio ? ` • ${ratio}` : ''}
              </p>
              <p className="text-[11px] text-gray-500 mt-0.5">
                {formatSize(primaryFile.size)} • {info?.format || 'FILE'}
              </p>
            </>
          )}
        </div>
      </div>

      {/* Tagging fields */}
      <div className="p-4 space-y-4">
        <CreativeTypeSelector
          value={creativeType}
          isMixed={creativeTypeMixed}
          fileFormat={uniformFormat}
          onChange={(val) => apply({ creativeType: val })}
        />

        <div>
          <label className={labelClass}>
            Product {productMixed && <MixedBadge />}
          </label>
          <select
            value={productId}
            onChange={(e) => {
              const pid = e.target.value;
              const pname =
                products.find((p) => p.shopify_product_id === pid)?.title || '';
              apply({ productId: pid, productName: pname });
            }}
            className={inputClass}
            style={inputStyle}
          >
            <option value="">{productMixed ? 'Mixed…' : 'Select product…'}</option>
            <ProductOptions products={products} />
          </select>
        </div>

        <div>
          <label className={labelClass}>
            Hook / Angle {hookMixed && <MixedBadge />}
          </label>
          <input
            type="text"
            value={hookAngle}
            placeholder={hookMixed ? 'Mixed — type to overwrite all' : 'e.g. “Tired skin at 40”'}
            onChange={(e) => apply({ hookAngle: e.target.value })}
            className={inputClass}
            style={inputStyle}
          />
        </div>

        {!isCarousel && (
          <div>
            <label className={labelClass}>
              Copy Template {copyTplMixed && <MixedBadge />}
            </label>
            <select
              value={copyTemplate}
              onChange={(e) => apply({ copyTemplate: e.target.value })}
              className={inputClass}
              style={inputStyle}
            >
              <option value="">{copyTplMixed ? 'Mixed…' : 'Select template…'}</option>
              {copyTemplateOptions.map((tpl) => (
                <option key={tpl.id} value={tpl.title}>
                  {tpl.title}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Carousel per-card copy — single selection only */}
        {isCarousel && !multi && (
          <div
            className="p-3 rounded-lg space-y-3"
            style={{
              backgroundColor: 'rgba(200,184,154,0.04)',
              border: '1px solid rgba(200,184,154,0.15)',
            }}
          >
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#C8B89A] flex items-center gap-1.5">
              <Layers className="w-3 h-3" />
              Card {primaryIdx + 1} Copy
            </p>
            <div>
              <label className={labelClass}>Headline *</label>
              <input
                type="text"
                value={copyHeadline}
                maxLength={255}
                onChange={(e) => apply({ copyHeadline: e.target.value })}
                className={inputClass}
                style={inputStyle}
                placeholder="Card headline"
              />
              <div className="flex justify-between mt-1">
                {errors[`file_${primaryIdx}_headline`] ? (
                  <p className="text-xs text-red-400">
                    {errors[`file_${primaryIdx}_headline`]}
                  </p>
                ) : (
                  <span />
                )}
                <span
                  className="text-[10px]"
                  style={{ color: copyHeadline.length > 40 ? '#EAB308' : '#666' }}
                >
                  {copyHeadline.length}/40
                </span>
              </div>
            </div>
            <div>
              <label className={labelClass}>Description</label>
              <input
                type="text"
                value={copyBody}
                onChange={(e) => apply({ copyBody: e.target.value })}
                className={inputClass}
                style={inputStyle}
                placeholder="Card description"
              />
              <div className="flex justify-end mt-1">
                <span
                  className="text-[10px]"
                  style={{ color: copyBody.length > 30 ? '#EAB308' : '#666' }}
                >
                  {copyBody.length}/30
                </span>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>
              Creator {creatorMixed && <MixedBadge />}
            </label>
            <input
              type="text"
              value={creatorName}
              placeholder={creatorMixed ? 'Mixed' : 'Creator name'}
              onChange={(e) => apply({ creatorName: e.target.value })}
              className={inputClass}
              style={inputStyle}
            />
            {errors[`file_${primaryIdx}_creator`] && (
              <p className="text-xs text-red-400 mt-1">
                {errors[`file_${primaryIdx}_creator`]}
              </p>
            )}
          </div>
          {isWhitelist && (
            <div>
              <label className={labelClass}>
                @Handle {handleMixed && <MixedBadge />}
              </label>
              <input
                type="text"
                value={creatorHandle}
                placeholder={handleMixed ? 'Mixed' : '@handle'}
                onChange={(e) => apply({ creatorHandle: e.target.value })}
                className={inputClass}
                style={inputStyle}
              />
              {errors[`file_${primaryIdx}_handle`] && (
                <p className="text-xs text-red-400 mt-1">
                  {errors[`file_${primaryIdx}_handle`]}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AssetDetailPanel;
