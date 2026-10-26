import type { Metadata } from 'next';
import UploadV2Gate from '@/components/upload-v2/UploadV2Gate';

export const metadata: Metadata = {
  title: 'Upload | melch.cloud',
  description: 'Upload creatives and preview the ad.',
  robots: { index: false, follow: false },
};

export default function UploadPage() {
  const localPreview =
    process.env.NODE_ENV === 'development' &&
    process.env.UPLOAD_V2_LOCAL_PREVIEW === '1';

  return <UploadV2Gate localPreview={localPreview} />;
}
