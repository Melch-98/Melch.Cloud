'use client';

import React, { useState, useEffect } from 'react';
import { X, Play, AlertTriangle } from 'lucide-react';
import type { FileMediaInfo } from './FileUploader';

interface AssetThumbnailProps {
  file: File;
  index: number;
  mediaInfo?: FileMediaInfo;
  isSelected: boolean;
  isTagged: boolean;
  dupeWarning?: string;
  onClick: (index: number, shiftKey: boolean) => void;
  onRemove: (index: number) => void;
  /** Drag-and-drop reordering */
  onDragStart: (index: number) => void;
  onDragOver: (e: React.DragEvent, index: number) => void;
  onDrop: (index: number) => void;
  isDragTarget: boolean;
}

function extBadge(file: File): string {
  const dot = file.name.lastIndexOf('.');
  if (dot === -1 || dot === file.name.length - 1) {
    return file.type.split('/')[1]?.toUpperCase().slice(0, 4) || 'FILE';
  }
  return file.name.slice(dot + 1).toUpperCase().slice(0, 4);
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

const badgeStyle: React.CSSProperties = {
  backgroundColor: 'rgba(0,0,0,0.65)',
  color: '#F5F5F8',
  backdropFilter: 'blur(4px)',
};

const AssetThumbnail: React.FC<AssetThumbnailProps> = ({
  file,
  index,
  mediaInfo,
  isSelected,
  isTagged,
  dupeWarning = '',
  onClick,
  onRemove,
  onDragStart,
  onDragOver,
  onDrop,
  isDragTarget,
}) => {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [thumbError, setThumbError] = useState(false);

  const isVideo = file.type.startsWith('video/');

  // Thumbnail generation — image object URL, or canvas frame grab at 0.5s for video
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
          const canvas = document.createElement('canvas');
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
    } else {
      setThumbUrl(null);
    }

    return () => {
      if (revoke && file.type.startsWith('image/')) {
        URL.revokeObjectURL(revoke);
      }
    };
  }, [file]);

  const ratio = prettyRatio(mediaInfo?.aspectRatio);

  return (
    <div
      draggable
      onDragStart={() => onDragStart(index)}
      onDragOver={(e) => onDragOver(e, index)}
      onDrop={(e) => {
        e.preventDefault();
        onDrop(index);
      }}
      onClick={(e) => onClick(index, e.shiftKey)}
      className="group relative rounded-xl overflow-hidden cursor-pointer select-none opacity-80 hover:opacity-100 transition-transform duration-150 hover:scale-[1.02]"
      style={{
        height: 160,
        backgroundColor: '#111111',
        border: isSelected
          ? '2px solid #C8B89A'
          : dupeWarning
          ? '2px solid rgba(234,179,8,0.6)'
          : isDragTarget
          ? '2px dashed rgba(200,184,154,0.5)'
          : '2px solid rgba(255,255,255,0.06)',
        opacity: isSelected ? 1 : undefined,
      }}
      title={dupeWarning || file.name}
    >
      {/* Thumbnail */}
      {thumbUrl && !thumbError ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={thumbUrl}
          alt={file.name}
          className="w-full h-full object-cover"
          draggable={false}
          onError={() => setThumbError(true)}
        />
      ) : (
        <div className="flex items-center justify-center w-full h-full">
          {isVideo ? (
            <Play className="w-8 h-8 text-gray-600" />
          ) : (
            <div className="w-8 h-8 rounded bg-gray-800" />
          )}
        </div>
      )}

      {/* Play overlay for videos */}
      {isVideo && thumbUrl && !thumbError && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center"
            style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
          >
            <Play className="w-4 h-4 text-white ml-0.5" fill="white" />
          </div>
        </div>
      )}

      {/* Format badge — top-left */}
      <div
        className="absolute top-1.5 left-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full"
        style={badgeStyle}
      >
        {extBadge(file)}
      </div>

      {/* Dupe warning — top-right */}
      {dupeWarning && (
        <div
          className="absolute top-1.5 right-7 p-0.5 rounded-full"
          style={{ backgroundColor: 'rgba(0,0,0,0.65)' }}
        >
          <AlertTriangle className="w-3 h-3 text-yellow-400" />
        </div>
      )}

      {/* Remove button — top-right, appears on hover */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRemove(index);
        }}
        className="absolute top-1.5 right-1.5 p-0.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500/40"
        style={{ backgroundColor: 'rgba(0,0,0,0.65)' }}
      >
        <X className="w-3 h-3 text-white" />
      </button>

      {/* Aspect ratio badge — bottom-right */}
      {ratio && (
        <div
          className="absolute bottom-1.5 right-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full"
          style={{ ...badgeStyle, color: '#C8B89A' }}
        >
          {ratio}
        </div>
      )}

      {/* Tagged indicator — bottom-left gold dot */}
      {isTagged && (
        <div
          className="absolute bottom-2 left-2 w-2 h-2 rounded-full"
          style={{ backgroundColor: '#C8B89A' }}
          title="Tagged"
        />
      )}

      {/* Filename strip */}
      <div
        className="absolute bottom-0 left-0 right-0 px-2 py-1 text-[10px] text-white truncate opacity-0 group-hover:opacity-100 transition-opacity"
        style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}
      >
        {file.name}
      </div>
    </div>
  );
};

export default AssetThumbnail;
