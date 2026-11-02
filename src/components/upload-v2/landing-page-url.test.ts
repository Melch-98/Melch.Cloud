import { describe, expect, it } from 'vitest';
import { landingPageHref, normalizeLandingPageUrl, noteParts } from '@/lib/landing-page-url';

describe('normalizeLandingPageUrl', () => {
  it('keeps a blank value empty and adds https when the scheme is missing', () => {
    expect(normalizeLandingPageUrl('')).toEqual({ value: '', error: null });
    expect(normalizeLandingPageUrl('   ')).toEqual({ value: '', error: null });
    expect(normalizeLandingPageUrl('mintier.com/products/serum')).toEqual({
      value: 'https://mintier.com/products/serum',
      error: null,
    });
    expect(normalizeLandingPageUrl('https://mintier.com/products/serum?utm=1')).toEqual({
      value: 'https://mintier.com/products/serum?utm=1',
      error: null,
    });
    expect(normalizeLandingPageUrl('http://mintier.com/products/serum')).toEqual({
      value: 'https://mintier.com/products/serum',
      error: null,
    });
  });

  it('rejects text that is not a web address', () => {
    expect(normalizeLandingPageUrl('not a url').error).toBe('Enter a landing page URL, or leave it blank');
    expect(normalizeLandingPageUrl('javascript:alert(1)').value).toBe('');
    expect(landingPageHref('')).toBeNull();
    expect(landingPageHref('   ')).toBeNull();
    expect(landingPageHref('not a url')).toBeNull();
    expect(landingPageHref('mintier.com/products/serum')).toBe('https://mintier.com/products/serum');
  });
});

describe('noteParts', () => {
  it('links urls inside notes and leaves the surrounding text', () => {
    expect(noteParts('Use mintier.com/products/serum today.')).toEqual([
      { kind: 'text', text: 'Use ' },
      { kind: 'link', text: 'mintier.com/products/serum', href: 'https://mintier.com/products/serum' },
      { kind: 'text', text: ' today.' },
    ]);
    expect(noteParts('See https://mintier.com/products/serum and http://shop.example/path.')).toEqual([
      { kind: 'text', text: 'See ' },
      { kind: 'link', text: 'https://mintier.com/products/serum', href: 'https://mintier.com/products/serum' },
      { kind: 'text', text: ' and ' },
      { kind: 'link', text: 'http://shop.example/path', href: 'http://shop.example/path' },
      { kind: 'text', text: '.' },
    ]);
  });

  it('does not link a filename or a blank note', () => {
    expect(noteParts('pour.jpg')).toEqual([{ kind: 'text', text: 'pour.jpg' }]);
    expect(noteParts('')).toEqual([{ kind: 'text', text: '' }]);
    expect(noteParts('ask jane@mintier.com')).toEqual([{ kind: 'text', text: 'ask jane@mintier.com' }]);
  });
});