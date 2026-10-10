import { describe, expect, it } from 'vitest';
import { deriveBatchCreativeType } from '@/lib/batch-creative-type';
import { creativeTypeMix } from '@/lib/creative-type-mix';

describe('Stats creative type mix', () => {
  it('keeps historical slugs and counts new derived uploads in the same bars', () => {
    const historical = [
      { creative_type: 'static' },
      { creative_type: 'Static' },
      { creative_type: 'video' },
      { creative_type: 'ugc' },
      { creative_type: 'mixed' },
      { creative_type: 'product_love_testimonial' },
      { creative_type: null },
      { creative_type: '' },
    ];
    const fresh = [
      { creative_type: deriveBatchCreativeType([{ type: 'image/jpeg', name: 'a.jpg' }]) },
      { creative_type: deriveBatchCreativeType([{ type: 'video/mp4', name: 'a.mp4' }]) },
      {
        creative_type: deriveBatchCreativeType([{ type: 'image/png', name: 'card.png' }], {
          isCarousel: true,
        }),
      },
      {
        creative_type: deriveBatchCreativeType([{ type: 'video/mp4', name: 'clip.mp4' }], {
          isFlexible: true,
        }),
      },
      {
        creative_type: deriveBatchCreativeType([
          { type: 'image/jpeg', name: 'a.jpg' },
          { type: 'video/mp4', name: 'b.mp4' },
        ]),
      },
    ];

    const bars = creativeTypeMix([...historical, ...fresh]);
    const counts = Object.fromEntries(bars.map((bar) => [bar.type, bar.count]));

    expect(counts.static).toBe(2);
    expect(counts.video).toBe(2);
    expect(counts.ugc).toBe(1);
    expect(counts.mixed).toBe(2);
    expect(counts.product_love_testimonial).toBe(1);
    expect(counts.other).toBe(2);
    expect(counts.image).toBe(1);
    expect(counts.carousel).toBe(1);
    expect(counts.flexible).toBe(1);

    expect(bars.find((bar) => bar.type === 'static')).toMatchObject({
      label: 'Static',
      color: '#9AADCC',
    });
    expect(bars.find((bar) => bar.type === 'video')).toMatchObject({
      label: 'Video',
      color: '#9AC8A7',
    });
    expect(bars.find((bar) => bar.type === 'ugc')).toMatchObject({
      label: 'Ugc',
      color: '#C8B89A',
    });
    expect(bars.find((bar) => bar.type === 'product_love_testimonial')?.label).toBe(
      'Product_love_testimonial'
    );
    expect(bars.find((bar) => bar.type === 'image')?.label).toBe('Image');
    expect(bars.find((bar) => bar.type === 'carousel')?.label).toBe('Carousel');
    expect(bars.find((bar) => bar.type === 'flexible')?.label).toBe('Flexible');
    expect(bars.every((bar) => bar.label.length > 0 && bar.count > 0)).toBe(true);
  });
});
