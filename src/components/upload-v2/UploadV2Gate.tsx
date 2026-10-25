'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader } from 'lucide-react';
import Navbar from '@/components/Navbar';
import UploadV2Studio from '@/components/upload-v2/UploadV2Studio';
import { createClient } from '@/lib/supabase';

/**
 * Same session gate as /upload. The studio underneath is local state only.
 * `localPreview` is true only for `next dev` when UPLOAD_V2_LOCAL_PREVIEW=1.
 * Production builds fold that flag off, so the Vercel preview still requires login.
 */
export default function UploadV2Gate({ localPreview = false }: { localPreview?: boolean }) {
  const router = useRouter();
  const [loading, setLoading] = useState(!localPreview);
  const [noPermission, setNoPermission] = useState(false);

  useEffect(() => {
    if (localPreview) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    const init = async () => {
      const supabase = createClient();
      if (!supabase) {
        router.push('/');
        return;
      }

      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (cancelled) return;
        if (!session) {
          router.push('/');
          return;
        }

        const { data: profile } = await supabase
          .from('users_profile')
          .select('role')
          .eq('id', session.user.id)
          .single();

        if (cancelled) return;

        if (profile?.role === 'admin') {
          router.push('/admin');
          return;
        }

        if (profile?.role === 'strategist') {
          const { data: perms } = await supabase
            .from('user_permissions')
            .select('can_upload')
            .eq('user_id', session.user.id)
            .single();

          if (cancelled) return;
          if (perms && !perms.can_upload) {
            setNoPermission(true);
            setLoading(false);
            return;
          }
        }

        setLoading(false);
      } catch {
        if (!cancelled) router.push('/');
      }
    };

    init();
    return () => {
      cancelled = true;
    };
  }, [localPreview, router]);

  if (loading) {
    return (
      <Navbar>
        <div className="min-h-screen flex items-center justify-center">
          <Loader className="w-8 h-8 text-[#C8B89A] animate-spin" />
        </div>
      </Navbar>
    );
  }

  if (noPermission) {
    return (
      <Navbar>
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-center max-w-sm">
            <div className="w-12 h-12 rounded-xl mx-auto mb-4 flex items-center justify-center" style={{ backgroundColor: 'rgba(255,50,50,0.1)' }}>
              <Loader className="w-6 h-6 text-red-400" />
            </div>
            <h2 className="text-lg font-bold text-[#F5F5F8] mb-2">Upload Access Restricted</h2>
            <p className="text-sm text-gray-500">
              You don&apos;t have permission to upload creatives. Contact your admin to request access.
            </p>
          </div>
        </div>
      </Navbar>
    );
  }

  return (
    <Navbar>
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-6 flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#C8B89A]">Post preview</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-[#F5F5F8]">Upload Creatives</h1>
            <p className="mt-2 text-sm text-[#ABABAB]">
              See the ad before anything is saved. This screen is a prototype.
            </p>
          </div>
          <span
            className="shrink-0 rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-wider"
            style={{ backgroundColor: 'rgba(200,184,154,0.15)', color: '#C8B89A' }}
          >
            Prototype
          </span>
        </div>
        <UploadV2Studio />
      </div>
    </Navbar>
  );
}
