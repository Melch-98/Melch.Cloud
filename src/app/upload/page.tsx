'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader } from 'lucide-react';
import Navbar from '@/components/Navbar';
import SubmissionForm from '@/components/SubmissionForm';
import { createClient } from '@/lib/supabase';

export default function UploadPage() {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [noPermission, setNoPermission] = useState(false);
  const [brands, setBrands] = useState<Array<{ id: string; name: string; slug: string }>>([]);
  const [userBrandId, setUserBrandId] = useState<string | undefined>();

  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.push('/');
        return;
      }

      const { data: profile } = await supabase
        .from('users_profile')
        .select('role, brand_id')
        .eq('id', session.user.id)
        .single();

      if (profile?.role === 'admin') {
        router.push('/admin');
        return;
      }

      // Check upload permission for non-admin users
      if (profile?.role === 'strategist') {
        const { data: perms } = await supabase
          .from('user_permissions')
          .select('can_upload')
          .eq('user_id', session.user.id)
          .single();

        if (perms && !perms.can_upload) {
          setNoPermission(true);
          setLoading(false);
          return;
        }
      }

      // Fetch brands
      const { data: brandsData } = await supabase.from('brands').select('id, name, slug');
      setBrands(brandsData || []);
      setUserBrandId(profile?.brand_id || undefined);
      setLoading(false);
    };

    init();
  }, [supabase, router]);

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
      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-[#F5F5F8] tracking-tight">Upload Creatives</h1>
          <p className="text-sm text-[#ABABAB] mt-2">
            Queue up batches of ad creatives with context for your media buyer.
          </p>
        </div>
        <SubmissionForm brands={brands} selectedBrandId={userBrandId} />
      </div>
    </Navbar>
  );
}
