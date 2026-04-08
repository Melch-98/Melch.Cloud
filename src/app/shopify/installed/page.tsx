import Link from 'next/link';

export default function ShopifyInstalledPage({
  searchParams,
}: {
  searchParams: { shop?: string };
}) {
  const shop = searchParams.shop || 'your store';

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0B0B0E] text-[#F5F5F8] px-6">
      <div className="max-w-md text-center">
        <div className="text-5xl mb-4">✓</div>
        <h1 className="text-2xl font-semibold mb-3">Melch Cloud installed</h1>
        <p className="text-sm text-[#A0A0AA] mb-6">
          <strong className="text-[#F5F5F8]">{shop}</strong> is now connected. Orders, customers,
          and refunds will start syncing automatically.
        </p>
        <Link
          href="/"
          className="inline-block px-5 py-2.5 rounded-lg bg-[#C8B89A] text-[#0B0B0E] text-sm font-medium hover:bg-[#D8C8AA] transition"
        >
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
