'use client';

import React, { useState, useRef, useCallback } from 'react';
import { Upload } from 'lucide-react';

export interface FileMediaInfo {
  format: 'VIDEO' | 'STATIC' | 'AUDIO' | 'DOCUMENT';
  aspectRatio: '1x1' | '9x16' | '4x5' | '16x9' | 'OTHER';
  width: number;
  height: number;
}

interface FileUploaderProps {
  files: File[];
  onFilesChange: (files: File[]) => void;
  onMediaInfoChange?: (index: number, info: FileMediaInfo) => void;
  mediaInfo?: Record<number, FileMediaInfo>;
  maxFileSize?: number; // in bytes, default 500MB
  accept?: string;
  /** Compact mode: slimmer drop zone for when assets are already present */
  compact?: boolean;
}

function detectFormat(mimeType: string): FileMediaInfo['format'] {
  if (mimeType.startsWith('video/')) return 'VIDEO';
  if (mimeType.startsWith('image/')) return 'STATIC';
  if (mimeType.startsWith('audio/')) return 'AUDIO';
  return 'DOCUMENT';
}

function detectAspectRatio(width: number, height: number): FileMediaInfo['aspectRatio'] {
  if (width === 0 || height === 0) return 'OTHER';
  const ratio = width / height;
  const tolerance = 0.05;

  if (Math.abs(ratio - 1) < tolerance) return '1x1';
  if (Math.abs(ratio - 9 / 16) < tolerance) return '9x16';
  if (Math.abs(ratio - 4 / 5) < tolerance) return '4x5';
  if (Math.abs(ratio - 16 / 9) < tolerance) return '16x9';
  return 'OTHER';
}

async function analyzeFile(file: File): Promise<FileMediaInfo> {
  const format = detectFormat(file.type);

  if (format === 'STATIC') {
    return new Promise((resolve) => {
      const img = new window.Image();
      img.onload = () => {
        const ratio = detectAspectRatio(img.naturalWidth, img.naturalHeight);
        URL.revokeObjectURL(img.src);
        resolve({ format, aspectRatio: ratio, width: img.naturalWidth, height: img.naturalHeight });
      };
      img.onerror = () => {
        URL.revokeObjectURL(img.src);
        resolve({ format, aspectRatio: 'OTHER', width: 0, height: 0 });
      };
      img.src = URL.createObjectURL(file);
    });
  }

  if (format === 'VIDEO') {
    return new Promise((resolve) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.onloadedmetadata = () => {
        const ratio = detectAspectRatio(video.videoWidth, video.videoHeight);
        URL.revokeObjectURL(video.src);
        resolve({ format, aspectRatio: ratio, width: video.videoWidth, height: video.videoHeight });
      };
      video.onerror = () => {
        URL.revokeObjectURL(video.src);
        resolve({ format, aspectRatio: 'OTHER', width: 0, height: 0 });
      };
      video.src = URL.createObjectURL(file);
    });
  }

  return { format, aspectRatio: 'OTHER', width: 0, height: 0 };
}

const formatSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return (bytes / Math.pow(k, i)).toFixed(1) + ' ' + sizes[i];
};

export default function FileUploader({
  files,
  onFilesChange,
  onMediaInfoChange,
  mediaInfo = {},
  maxFileSize = 2 * 1024 * 1024 * 1024,
  accept,
  compact = false,
}: FileUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [analyzing, setAnalyzing] = useState<Set<number>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);

  const handleNewFiles = useCallback(
    async (newFiles: FileList | File[]) => {
      const fileArray = Array.from(newFiles).filter((f) => f.size <= maxFileSize);
      const startIdx = files.length;
      const combined = [...files, ...fileArray];
      onFilesChange(combined);

      // Auto-analyze each new file
      for (let i = 0; i < fileArray.length; i++) {
        const idx = startIdx + i;
        setAnalyzing((prev) => new Set(prev).add(idx));
        try {
          const info = await analyzeFile(fileArray[i]);
          onMediaInfoChange?.(idx, info);
        } catch {
          // Silently fail analysis
        } finally {
          setAnalyzing((prev) => {
            const next = new Set(prev);
            next.delete(idx);
            return next;
          });
        }
      }
    },
    [files, onFilesChange, onMediaInfoChange, maxFileSize]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer.files.length) {
        handleNewFiles(e.dataTransfer.files);
      }
    },
    [handleNewFiles]
  );

  return (
    <div>
      {/* Drop Zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={`cursor-pointer transition-all duration-200 rounded-xl text-center ${
          compact ? 'p-3 flex items-center justify-center gap-2.5' : 'p-8'
        }`}
        style={{
          border: isDragging ? '2px dashed #C8B89A' : '2px dashed rgba(255,255,255,0.12)',
          backgroundColor: isDragging ? 'rgba(200,184,154,0.05)' : 'transparent',
        }}
      >
        {compact ? (
          <>
            <Upload size={16} className="text-[#ABABAB]" />
            <p className="text-[#F5F5F8] text-xs font-medium">
              {isDragging ? 'Drop files here' : 'Add more files — drag or click'}
            </p>
          </>
        ) : (
          <>
            <Upload size={32} className="mx-auto mb-3 text-[#ABABAB]" />
            <p className="text-[#F5F5F8] text-sm font-medium">
              {isDragging ? 'Drop files here' : 'Drag files here or click to browse'}
            </p>
            <p className="text-[#666] text-xs mt-1">
              Max {formatSize(maxFileSize)} per file. Format & aspect ratio auto-detected.
            </p>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={accept}
          className="hidden"
          onChange={(e) => e.target.files && handleNewFiles(e.target.files)}
        />
      </div>
    </div>
  );
}
