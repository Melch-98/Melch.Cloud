'use client';

import { useEffect } from 'react';
import posthog from 'posthog-js';
import { PostHogProvider as PHProvider } from 'posthog-js/react';
import { createClient } from '@/lib/supabase';

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    const host = process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com';
    if (!key) return;
    if (posthog.__loaded) return;

    posthog.init(key, {
      api_host: host,
      person_profiles: 'identified_only',
      capture_pageview: true,
      capture_pageleave: true,
      session_recording: {
        maskAllInputs: false,
      },
    });

    // Identify the current Supabase user, if any
    (async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase.auth.getUser();
        if (data.user) {
          posthog.identify(data.user.id, {
            email: data.user.email,
          });
        }
      } catch {
        // ignore — no auth yet
      }
    })();
  }, []);

  return <PHProvider client={posthog}>{children}</PHProvider>;
}
