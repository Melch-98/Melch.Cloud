'use client';

import React, { useState, useEffect, useRef } from 'react';
import { X, Play } from 'lucide-react';
import { CREATIVE_TYPE_GROUPS } from '@/lib/creative-types';

interface FileMediaInfo {
  format: 'VIDEO' | 'STATIC' | 'AUDIO' | 'DOCUMENT';
  aspectRatio: '1x1' | '9x16' | '4x5' | '16x9' | 'OTHER';
  width: number;
  height: number;
}

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

interface FileCardProps {
  file: File;
  index: number;
  mediaInfo?: FileMediaInfo;
  productId: string;
  productName: string;
  creativeType: string;
  hookAngle: string;
  copyTemplate: string;
  products: Product[];
  copyTemplateOptions: CopyTemplateOption[];
  isCarousel: boolean;
  onRemove: (index: number) => void;
  onProductChange: (index: number, productId: string, productName: string) => void;
  onCreativeTypeChange: (index: number, value: string) => void;
  onHookAngleChange: (index: number, value: string) => void;
  onCopyTemplateChange: (index: number, value: string) => void;
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return (bytes / Math.pow(k, i)).toFixed(1) + ' ' + sizes[i];
}

function formatLabel(format: string): string {
  switch (format) {
    case 'VIDEO': return 'Video';
    case 'STATIC': return 'Image';
    case 'AUDIO': return 'Audio';
    default: return 'File';
  }
}

// Renders product <option>s grouped by product_type
function ProductOptions({ products }: { products: Product[] }) {
  const groups = new Map<string, Product[]>();
  for (const p of products) {
    const key = p.product_type || '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(p);
  }
  const entries = Array.from(groups.entries());

  if (entries.length === 1 && entries[0][0] === '') {
    return (
      <>
        {entries[0][1].map((p) => (
          <option key={p.shopify_product_id} value={p.shopify_product_id}>
            {p.title}
          </option>
        ))}
      </>
    );
  }

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

const selectStyle = {
  backgroundColor: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.08)',
};

const FileCard: React.FC<FileCardProps> = ({
  file,
  index,
  mediaInfo,
  productId,
  productName,
  creativeType,
  hookAngle,
  copyTemplate,
  products,
  copyTemplateOptions,
  isCarousel,
  onRemove,
  onProductChange,
  onCreativeTypeChange,
  onHookAngleChange,
  onCopyTemplateChange,
}) => {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [thumbError, setThumbError] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Generate thumbnail from file
  useEffect(() => {
    let revoke: string | null = null;

    if (file.type.startsWith('image/')) {
      const url = URL.createObjectURL(file);
      revoke = url;
      setThumbUrl(url);
      setThumbError(false);
    } else if (file.type.startsWith('video/')) {
      const url = URL.createObjectURL(file);
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
          const canvas = canvasRef.current || document.createElement('canvas');
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(video, 0, 0);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
            setThumbUrl(dataUrl);
          }
        } catch {
          setThumbError(true);
        }
        URL.revokeObjectURL(url);
      });

      video.addEventListener('error', () => {
        URL.revokeObjectURL(url);
        setThumbError(true);
      });
    }

    return () => {
      if (revoke && file.type.startsWith('image/')) {
        URL.revokeObjectURL(revoke);
      }
    };
  }, [file]);

  const isVideo = file.type.startsWith('video/');

  return (
    <div
      className="flex flex-wrap gap-3 p-3 rounded-xl transition-colors"
      style={{
        backgroundColor: 'rgba(255,255,255,0.03)',
        border: '0.5px solid rgba(255,255,255,0.08)',
      }}
    >
      {/* Hidden canvas for video frame extraction */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Thumbnail */}
      <div
        className="relative flex-shrink-0 rounded-lg overflow-hidden flex items-center justify-center"
        style={{
          width: 80,
          height: 80,
          backgroundColor: 'rgba(0,0,0,0.3)',
        }}
      >
        {thumbUrl && !thumbError ? (
          <img
            src={thumbUrl}
            alt={file.name}
            className="w-full h-full object-cover"
            onError={() => setThumbError(true)}
          />
        ) : (
          <div className="flex items-center justify-center w-full h-full">
            {isVideo ? (
              <Play className="w-6 h-6 text-gray-500" />
            ) : (
              <div className="w-6 h-6 rounded bg-gray-700" />
            )}
          </div>
        )}

        {/* Video play badge */}
        {isVideo && thumbUrl && !thumbError && (
          <div
            className="absolute top-1 left-1 flex items-center gap-0.5 px-1 py-0.5 rounded"
            style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
          >
            <Play className="w-2.5 h-2.5 text-white" fill="white" />
          </div>
        )}

        {/* Aspect ratio badge */}
        {mediaInfo?.aspectRatio && mediaInfo.aspectRatio !== 'OTHER' && (
          <div
            className="absolute bottom-1 right-1 text-[9px] font-bold px-1 py-0.5 rounded"
            style={{
              backgroundColor: 'rgba(0,0,0,0.6)',
              color: '#C8B89A',
            }}
          >
            {mediaInfo.aspectRatio}
          </div>
        )}
      </div>

      {/* Content area */}
      <div className="flex-1 min-w-0 flex flex-col gap-2">
        {/* Top row: filename + meta + delete */}
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-medium text-[#F5F5F8] truncate">
              {file.name}
            </p>
            <p className="text-[11px] text-gray-500">
              {mediaInfo ? formatLabel(mediaInfo.format) : 'File'} · {formatSize(file.size)}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onRemove(index)}
            className="p-1 rounded-md transition-colors flex-shrink-0 hover:bg-red-500/10"
          >
            <X className="w-3.5 h-3.5 text-gray-500 hover:text-red-400" />
          </button>
        </div>

        {/* Bottom row: inline tag dropdowns */}
        <div className="flex flex-wrap gap-1">
          <select
            value={productId}
            onChange={(e) => {
              const pid = e.target.value;
              const pname = products.find((p) => p.shopify_product_id === pid)?.title || '';
              onProductChange(index, pid, pname);
            }}
            className="flex-1 min-w-[100px] px-1.5 py-0.5 rounded-md text-[11px] text-[#F5F5F8] focus:outline-none focus:border-[#C8B89A]/40 transition-all"
            style={{ ...selectStyle, height: 26 }}
          >
            <option value="">Product...</option>
            <ProductOptions products={products} />
          </select>

          <select
            value={creativeType}
            onChange={(e) => onCreativeTypeChange(index, e.target.value)}
            className="flex-1 min-w-[100px] px-1.5 py-0.5 rounded-md text-[11px] text-[#F5F5F8] focus:outline-none focus:border-[#C8B89A]/40 transition-all"
            style={{ ...selectStyle, height: 26 }}
          >
            <option value="">Type...</option>
            {CREATIVE_TYPE_GROUPS.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.types.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>

          <input
            type="text"
            placeholder="Hook / angle..."
            value={hookAngle}
            onChange={(e) => onHookAngleChange(index, e.target.value)}
            className="flex-1 min-w-[80px] px-1.5 py-0.5 rounded-md text-[11px] text-[#F5F5F8] placeholder-gray-600 focus:outline-none focus:border-[#C8B89A]/40 transition-all"
            style={{ ...selectStyle, height: 26 }}
          />

          {!isCarousel && (
            <select
              value={copyTemplate}
              onChange={(e) => onCopyTemplateChange(index, e.target.value)}
              className="flex-1 min-w-[100px] px-1.5 py-0.5 rounded-md text-[11px] text-[#F5F5F8] focus:outline-none focus:border-[#C8B89A]/40 transition-all"
              style={{ ...selectStyle, height: 26 }}
            >
              <option value="">Copy...</option>
              {copyTemplateOptions.map((tpl) => (
                <option key={tpl.id} value={tpl.title}>
                  {tpl.title}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>
    </div>
  );
};

export default FileCard;
