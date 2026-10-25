import type { Metadata } from 'next';
import UploadV2Gate from '@/components/upload-v2/UploadV2Gate';

export const metadata: Metadata = {
  title: 'Upload prototype | melch.cloud',
  description: 'Look-and-feel prototype for creative upload. Nothing is saved.',
  robots: { index: false, follow: false },
};

export default function UploadV2Page() {
  const localPreview =
    process.env.NODE_ENV === 'development' &&
    process.env.UPLOAD_V2_LOCAL_PREVIEW === '1';

  return <UploadV2Gate localPreview={localPreview} />;
}
