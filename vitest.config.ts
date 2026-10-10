import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'src/components/funnel-viewer/**/*.test.ts',
      'src/lib/meta-funnel.test.ts',
      'src/lib/ad-activity/activity.test.ts',
      'src/lib/batch-creative-type.test.ts',
      'src/lib/creative-type-mix.test.ts',
      'src/lib/invite-status.test.ts',
      'src/lib/set-password-token.test.ts',
      'src/lib/set-password-limit.test.ts',
      'src/app/api/admin/invite-security.test.ts',
      'src/lib/bfcm/**/*.test.ts',
      'src/app/api/bfcm-goals/**/*.test.ts',
    ],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
