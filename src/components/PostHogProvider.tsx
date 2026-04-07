'use client';

import { useEffect, Suspense } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import posthog from 'posthog-js';
import { PostHogProvider as PHProvider } from 'posthog-js/react';
import { createClient } from '@/lib/supabase';

// ─── Identify helper ──────────────────────────────────────────
async function identifyCurrentUser() {
  try {
    const supabase = createClient();
    const { data: sessionData } = await supabase.auth.getSession();
    const user = sessionData.session?.user;
    if (!user) return;

    // Pull role + brand_id so PostHog knows what role/brand each event belongs to
    const { data: profile } = await supabase
      .from('users_profile')
      .select('role, brand_id, full_name')
      .eq('id', user.id)
      .single();

    let brandName: string | undefined;
    if (profile?.brand_id) {
      const { data: brand } = await supabase
        .from('brands')
        .select('name')
        .eq('id', profile.brand_id)
        .single();
      brandName = brand?.name;
    }

    posthog.identify(user.id, {
      email: user.email,
      name: profile?.full_name,
      role: profile?.role,
      brand_id: profile?.brand_id,
      brand_name: brandName,
    });

    if (profile?.brand_id) {
      // Group analytics — lets you slice events by brand in PostHog
      posthog.group('brand', profile.brand_id, {
        name: brandName,
      });
    }
  } catch (err) {
    console.warn('PostHog identify failed:', err);
  }
}

// ─── Pageview tracker (Next.js App Router) ────────────────────
function PostHogPageview() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!pathname || !posthog.__loaded) return;
    let url = window.origin + pathname;
    const qs = searchParams?.toString();
    if (qs) url += `?${qs}`;
    posthog.capture('$pageview', { $current_url: url });
  }, [pathname, searchParams]);

  return null;
}

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    const host = process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com';
    if (!key) return;
    if (posthog.__loaded) return;

    posthog.init(key, {
      api_host: host,
      person_profiles: 'identified_only',
      // We capture pageviews manually via PostHogPageview to handle client-side nav
      capture_pageview: false,
      capture_pageleave: true,
      session_recording: {
        maskAllInputs: false,
      },
    });

    // Initial identify on first load
    identifyCurrentUser();

    // Re-identify on sign-in / reset on sign-out
    const supabase = createClient();
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
        identifyCurrentUser();
      } else if (event === 'SIGNED_OUT') {
        posthog.reset();
      }
    });

    return () => {
      sub.subscription.unsubscribe();
    };
  }, []);

  return (
    <PHProvider client={posthog}>
      <Suspense fallback={null}>
        <PostHogPageview />
      </Suspense>
      {children}
    </PHProvider>
  );
}
