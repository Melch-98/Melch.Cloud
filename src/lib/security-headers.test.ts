import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { securityHeaders } from './security-headers.mjs';

const require = createRequire(import.meta.url);
const { pathToRegexp } = require('next/dist/compiled/path-to-regexp');

function matches(source: string, pathname: string) {
  const regexp = pathToRegexp(source, [], {
    strict: true,
    sensitive: false,
    delimiter: '/',
  });
  return regexp.test(pathname);
}

function headersFor(pathname: string) {
  return securityHeaders()
    .filter((rule) => matches(rule.source, pathname))
    .flatMap((rule) => rule.headers);
}

function header(pathname: string, key: string) {
  return headersFor(pathname).filter((item) => item.key === key).map((item) => item.value);
}

describe('security headers', () => {
  it('denies framing on the login page and keeps Shopify framing on /app', () => {
    expect(header('/', 'X-Frame-Options')).toEqual(['DENY']);
    expect(header('/', 'Content-Security-Policy')).toEqual(["frame-ancestors 'none'"]);
    expect(header('/dashboard', 'X-Frame-Options')).toEqual(['DENY']);
    expect(header('/app', 'X-Frame-Options')).toEqual([]);
    expect(header('/app', 'Content-Security-Policy')).toEqual([
      'frame-ancestors https://*.myshopify.com https://admin.shopify.com',
    ]);
    expect(header('/app/embed', 'Content-Security-Policy')).toEqual([
      'frame-ancestors https://*.myshopify.com https://admin.shopify.com',
    ]);
    expect(header('/apple', 'X-Frame-Options')).toEqual(['DENY']);
  });

  it('sends nosniff, a strict referrer, and HSTS, and does not send a wildcard CORS header', () => {
    for (const pathname of ['/', '/dashboard', '/app', '/app/embed']) {
      expect(header(pathname, 'X-Content-Type-Options')).toEqual(['nosniff']);
      expect(header(pathname, 'Referrer-Policy')).toEqual(['strict-origin-when-cross-origin']);
      expect(header(pathname, 'Strict-Transport-Security')).toEqual([
        'max-age=63072000; includeSubDomains',
      ]);
      expect(header(pathname, 'Access-Control-Allow-Origin')).toEqual([]);
    }
  });
});
