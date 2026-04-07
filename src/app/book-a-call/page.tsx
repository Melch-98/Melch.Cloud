// This page is intentionally empty — Book a Call is an external link in the nav.
// Redirect in case someone navigates here directly.
'use client';
import { useEffect } from 'react';
export default function BookACallRedirect() {
  useEffect(() => {
    window.open(
      'https://calendar.proton.me/bookings#v8kOqlT5iUURM7eCJ6GVXS7AMsKxa0ly4VwimFden-M=',
      '_blank'
    );
    window.history.back();
  }, []);
  return null;
}
