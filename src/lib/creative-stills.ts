/** Grab a JPEG the vision model can read. Images: one frame. Videos: up to three. */

import { targetFrameSize } from '@/lib/auto-tag/image-size';

const JPEG_QUALITY = 0.6;

function drawScaled(source: CanvasImageSource, sw: number, sh: number): string | null {
  const size = targetFrameSize(sw, sh);
  if (!size) return null;
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, size.width, size.height);
  return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
}

function stillFromImage(file: File): Promise<string[]> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new window.Image();
    img.onload = () => {
      const frame = drawScaled(img, img.naturalWidth, img.naturalHeight);
      URL.revokeObjectURL(url);
      resolve(frame ? [frame] : []);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve([]);
    };
    img.src = url;
  });
}

function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error('seek timeout'));
    }, 4000);
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('seek failed'));
    };
    const cleanup = () => {
      window.clearTimeout(timer);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
    };
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('error', onError);
    video.currentTime = time;
  });
}

async function stillsFromVideo(file: File): Promise<string[]> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  video.src = url;

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('metadata timeout')), 8000);
      video.onloadeddata = () => {
        window.clearTimeout(timer);
        resolve();
      };
      video.onerror = () => {
        window.clearTimeout(timer);
        reject(new Error('video load failed'));
      };
    });

    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const rawTimes = duration > 0.4
      ? [0.5, Math.min(3, Math.max(0.5, duration * 0.35)), duration / 2]
      : [0];
    const times: number[] = [];
    for (const t of rawTimes) {
      const clamped = duration > 0.2 ? Math.min(Math.max(0.05, t), Math.max(0.05, duration - 0.05)) : 0;
      if (!times.some((existing) => Math.abs(existing - clamped) < 0.25)) times.push(clamped);
    }

    const frames: string[] = [];
    for (const time of times.slice(0, 3)) {
      try {
        await seekTo(video, time);
        const frame = drawScaled(video, video.videoWidth, video.videoHeight);
        if (frame) frames.push(frame);
      } catch {
        // Skip a frame we couldn't grab. The others may still be usable.
      }
    }
    return frames;
  } catch {
    return [];
  } finally {
    URL.revokeObjectURL(url);
    video.removeAttribute('src');
    video.load();
  }
}

export async function captureCreativeStills(file: File): Promise<string[]> {
  if (file.type.startsWith('image/')) return stillFromImage(file);
  if (file.type.startsWith('video/')) return stillsFromVideo(file);
  return [];
}
