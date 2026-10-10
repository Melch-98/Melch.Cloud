import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    environment: 'node',
    include: [
      'src/components/funnel-viewer/**/*.test.ts',
      'src/lib/meta-funnel.test.ts',
      'src/lib/ad-activity/activity.test.ts',
      'src/lib/batch-creative-type.test.ts',
      'src/lib/creative-type-mix.test.ts',
      'src/lib/usage-end-date.test.ts',
      'src/lib/usage-task.test.ts',
      'src/lib/usage-task-sync.test.ts',
      'src/lib/supabase-server.test.ts',
      'src/lib/invite-status.test.ts',
      'src/lib/set-password-token.test.ts',
      'src/lib/set-password-limit.test.ts',
      'src/app/api/admin/invite-security.test.ts',
      'src/app/api/admin/shopify-scopes/**/*.test.ts',
      'src/lib/bfcm/**/*.test.ts',
      'src/app/api/bfcm-goals/**/*.test.ts',
      'src/lib/live-creatives/**/*.test.ts',
      'src/app/api/live-creatives/**/*.test.ts',
      'src/lib/supabase-session-cookie.test.ts',
      'src/lib/dropbox-oauth-state.test.ts',
      'src/lib/sync-brand-access.test.ts',
      'src/app/api/auth/dropbox/**/*.test.ts',
      'src/app/api/shopify-sync/**/*.test.ts',
      'src/app/api/triplewhale-sync/**/*.test.ts',
      'src/lib/shopify/run-triplewhale-brand-sync.test.ts',
      'src/app/admin/dropbox/**/*.test.ts',
    ],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
