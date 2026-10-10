import { withSentryConfig } from '@sentry/nextjs';

/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  async redirects() {
    // Retired pages. Old bookmarks land on the dashboard.
    return [
      { source: '/analytics/efficiency', destination: '/dashboard', permanent: true },
      { source: '/analytics/ltv-cohorts', destination: '/dashboard', permanent: true },
      { source: '/analytics/forecast', destination: '/dashboard', permanent: true },
      { source: '/analytics/creative-matrix', destination: '/dashboard', permanent: true },
      { source: '/analytics/ad-perspective', destination: '/dashboard', permanent: true },
      { source: '/calendar', destination: '/dashboard', permanent: true },
    ];
  },
  async headers() {
    const csp = "frame-ancestors https://*.myshopify.com https://admin.shopify.com";
    return [
      {
        source: '/app',
        headers: [{ key: 'Content-Security-Policy', value: csp }],
      },
      {
        source: '/app/:path*',
        headers: [{ key: 'Content-Security-Policy', value: csp }],
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: !process.env.CI,
  widenClientFileUpload: true,
  reactComponentAnnotation: { enabled: true },
  hideSourceMaps: true,
  disableLogger: true,
  automaticVercelMonitors: true,
});
