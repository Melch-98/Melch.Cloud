import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'src/components/funnel-viewer/**/*.test.ts',
      'src/lib/meta-funnel.test.ts',
      'src/lib/ad-activity/activity.test.ts',
      'src/lib/creative-auto-tag.test.ts',
      'src/lib/creative-naming.test.ts',
      'src/lib/auto-tag/grok.test.ts',
      'src/lib/creative-tag-sync.test.ts',
      'src/lib/invite-status.test.ts',
      'src/lib/set-password-token.test.ts',
      'src/lib/set-password-limit.test.ts',
      'src/app/api/admin/invite-security.test.ts',
    ],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
