import { describe, expect, it } from 'vitest';
import { deriveBatchCreativeType, fileMediaKind } from '@/lib/batch-creative-type';

describe('deriveBatchCreativeType', () => {
  it('reads video and image from the mime type', () => {
    expect(fileMediaKind({ type: 'video/mp4', name: 'clip.bin' })).toBe('video');
    expect(fileMediaKind({ type: 'image/png', name: 'shot.bin' })).toBe('image');
  });

  it('falls back to the file extension', () => {
    expect(fileMediaKind({ type: '', name: 'clip.MOV' })).toBe('video');
    expect(fileMediaKind({ type: '', name: 'shot.JPEG' })).toBe('image');
    expect(fileMediaKind({ type: 'application/pdf', name: 'brief.pdf' })).toBe('other');
  });

  it('labels a batch from the files in it', () => {
    expect(deriveBatchCreativeType([{ type: 'image/jpeg', name: 'a.jpg' }])).toBe('static');
    expect(
      deriveBatchCreativeType([
        { type: 'image/jpeg', name: 'a.jpg' },
        { type: 'image/png', name: 'b.png' },
      ])
    ).toBe('static');
    expect(deriveBatchCreativeType([{ type: 'video/mp4', name: 'a.mp4' }])).toBe('video');
    expect(
      deriveBatchCreativeType([
        { type: 'image/jpeg', name: 'a.jpg' },
        { type: 'video/mp4', name: 'b.mp4' },
      ])
    ).toBe('mixed');
    expect(deriveBatchCreativeType([{ type: 'application/pdf', name: 'a.pdf' }])).toBe('other');
    expect(deriveBatchCreativeType([])).toBe('other');
  });

  it('lets carousel and flexible describe the batch', () => {
    const images = [{ type: 'image/jpeg', name: 'a.jpg' }];
    const videos = [{ type: 'video/mp4', name: 'a.mp4' }];
    expect(deriveBatchCreativeType(images, { isCarousel: true })).toBe('carousel');
    expect(deriveBatchCreativeType(videos, { isFlexible: true })).toBe('flexible');
    expect(deriveBatchCreativeType(videos, { isCarousel: true, isFlexible: true })).toBe('carousel');
  });
});
