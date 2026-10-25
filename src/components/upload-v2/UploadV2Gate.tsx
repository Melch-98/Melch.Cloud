'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader } from 'lucide-react';
import Navbar from '@/components/Navbar';
import type { UploadBrand } from '@/components/upload-v2/model';
import UploadV2Studio from '@/components/upload-v2/UploadV2Studio';
import { createClient } from '@/lib/supabase';

function toUploadBrands(rows: Array<{ id: string; name: string; slug: string; website_url: string | null }> | null): UploadBrand[] {
  return (rows || []).map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    websiteUrl: row.website_url,
  }));
}

/**
 * Same session gate as /upload. Submit uses that session for storage and row inserts.
 * `localPreview` is true only for `next dev` when UPLOAD_V2_LOCAL_PREVIEW=1.
 * Production builds fold that flag off, so the Vercel preview still requires login.
 */
export default function UploadV2Gate({ localPreview = false }: { localPreview?: boolean }) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [noPermission, setNoPermission] = useState(false);
  const [brands, setBrands] = useState<UploadBrand[]>([]);
  const [lockedBrandId, setLockedBrandId] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;

    const loadBrands = async (supabase: NonNullable<ReturnType<typeof createClient>>, userId?: string) => {
      let locked: string | undefined;
      if (userId) {
        const { data: profile } = await supabase
          .from('users_profile')
          .select('brand_id')
          .eq('id', userId)
          .maybeSingle();
        locked = profile?.brand_id || undefined;
      }
      const { data } = await supabase
        .from('brands')
        .select('id, name, slug, website_url')
        .is('archived_at', null)
        .order('name');
      if (cancelled) return;
      setLockedBrandId(locked);
      setBrands(toUploadBrands(data));
    };

    const init = async () => {
      const supabase = createClient();
      if (!supabase) {
        if (localPreview) setLoading(false);
        else router.push('/');
        return;
      }

      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (cancelled) return;

        if (localPreview) {
          await loadBrands(supabase, session?.user?.id);
          if (!cancelled) setLoading(false);
          return;
        }

        if (!session) {
          router.push('/');
          return;
        }

        const { data: profile } = await supabase
          .from('users_profile')
          .select('role, brand_id')
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

        setLockedBrandId(profile?.brand_id || undefined);
        const { data } = await supabase
          .from('brands')
          .select('id, name, slug, website_url')
          .is('archived_at', null)
          .order('name');
        if (cancelled) return;
        setBrands(toUploadBrands(data));
        setLoading(false);
      } catch {
        if (cancelled) return;
        if (localPreview) setLoading(false);
        else router.push('/');
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
      <div className="mx-auto max-w-[1100px] px-4 py-4 sm:px-6 sm:py-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#C8B89A]">Post preview</p>
            <h1 className="mt-1 text-xl font-bold tracking-tight text-[#F5F5F8] sm:text-2xl">Upload Creatives</h1>
            <p className="mt-1 text-sm text-[#ABABAB]">
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
        <UploadV2Studio brands={brands} lockedBrandId={lockedBrandId} />
      </div>
    </Navbar>
  );
}
