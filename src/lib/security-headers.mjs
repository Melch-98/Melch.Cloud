const SHARED_SECURITY_HEADERS = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
];

const FRAME_DENY_HEADERS = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
];

const SHOPIFY_APP_CSP = "frame-ancestors https://*.myshopify.com https://admin.shopify.com";

const SHOPIFY_APP_HEADERS = [
  ...SHARED_SECURITY_HEADERS,
  { key: 'Content-Security-Policy', value: SHOPIFY_APP_CSP },
];

export function securityHeaders() {
  return [
    { source: '/app/:path*', headers: SHOPIFY_APP_HEADERS },
    { source: '/app/', headers: SHOPIFY_APP_HEADERS },
    {
      source: '/((?!app$|app/).*)',
      headers: [...SHARED_SECURITY_HEADERS, ...FRAME_DENY_HEADERS],
    },
  ];
}
