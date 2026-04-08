'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Legacy redirect: /change-log was split into /releases + /feature-requests.
export default function ChangeLogRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/releases');
  }, [router]);
  return null;
}
