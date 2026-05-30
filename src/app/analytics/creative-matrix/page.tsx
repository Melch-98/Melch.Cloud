'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Loader,
  Grid3X3,
  ChevronDown,
  ChevronRight,
  Package,
  AlertTriangle,
  Upload,
} from 'lucide-react';
import Navbar from '@/components/Navbar';
import { createClient } from '@/lib/supabase';
import { CREATIVE_TYPE_GROUPS, CREATIVE_TYPES_MAP, getCreativeTypeLabel } from '@/lib/creative-types';

// ─── Types ────────────────────────────────────────────────────────

interface Brand {
  id: string;
  name: string;
  slug: string;
}

interface RawFile {
  id: string;
  product_id: string | null;
  product_name: string | null;
  creative_type: string;
  fidelity: string | null;
  media_format: string | null;
  status: string | null;
  file_name: string;
  hook_angle: string | null;
}

interface Product {
  shopify_product_id: string;
  title: string;
  product_type: string;
}

// ─── Column groups ────────────────────────────────────────────────

const COLUMN_GROUPS = [
  { key: 'hd_static', label: 'Static', parent: 'High Def', fidelity: 'high_def', format: 'static' },
  { key: 'hd_video', label: 'Video', parent: 'High Def', fidelity: 'high_def', format: 'video' },
  { key: 'lofi_static', label: 'Static', parent: 'Lofi', fidelity: 'lofi', format: 'static' },
  { key: 'lofi_video', label: 'Video', parent: 'Lofi', fidelity: 'lofi', format: 'video' },
  { key: 'other_static', label: 'Static', parent: 'Other', fidelity: 'other', format: 'static' },
  { key: 'other_video', label: 'Video', parent: 'Other', fidelity: 'other', format: 'video' },
] as const;

type ColKey = (typeof COLUMN_GROUPS)[number]['key'];

const PARENT_GROUPS = ['High Def', 'Lofi', 'Other'] as const;

// ─── Cell color helpers ───────────────────────────────────────────

function cellStyle(count: number): { bg: string; text: string } {
  if (count === 0) return { bg: 'transparent', text: 'rgba(255,255,255,0.15)' };
  if (count === 1) return { bg: '#FCEBEB', text: '#791F1F' };
  if (count <= 3) return { bg: '#FAEEDA', text: '#633806' };
  if (count <= 5) return { bg: '#EAF3DE', text: '#27500A' };
  return { bg: '#E1F5EE', text: '#085041' };
}

// ─── Matrix row type ──────────────────────────────────────────────

interface MatrixRow {
  productId: string;
  productName: string;
  productType: string;
  counts: Record<ColKey, number>;
  details: Record<ColKey, Record<string, number>>; // creative_type -> count per col
  total: number;
}

// ─── Cell badge ───────────────────────────────────────────────────

function CellBadge({ count }: { count: number }) {
  const s = cellStyle(count);
  return (
    <span
      className="inline-flex items-center justify-center rounded-md text-xs font-medium"
      style={{
        width: 42,
        height: 28,
        borderRadius: 6,
        backgroundColor: s.bg,
        color: s.text,
      }}
    >
      {count === 0 ? '\u2014' : count}
    </span>
  );
}

// ─── KPI card ─────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub: string;
}) {
  return (
    <div
      className="flex-1 min-w-[140px] p-4 rounded-xl"
      style={{
        backgroundColor: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      <p className="text-[11px] text-gray-500 uppercase tracking-wider mb-1">{label}</p>
      <p className="text-xl font-bold text-[#F5F5F8]">{value}</p>
      <p className="text-[11px] text-gray-500 mt-0.5">{sub}</p>
    </div>
  );
}

// ─── Expandable product row ───────────────────────────────────────

function ProductRow({ row }: { row: MatrixRow }) {
  const [open, setOpen] = useState(false);
  const hasDetail = row.total > 0;

  return (
    <>
      <tr
        className="transition-colors cursor-pointer hover:bg-white/[0.03]"
        onClick={() => hasDetail && setOpen(!open)}
        style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
      >
        <td className="py-2 px-3 text-sm text-[#F5F5F8] whitespace-nowrap">
          <div className="flex items-center gap-1.5">
            {hasDetail ? (
              open ? (
                <ChevronDown className="w-3 h-3 text-gray-500 shrink-0" />
              ) : (
                <ChevronRight className="w-3 h-3 text-gray-500 shrink-0" />
              )
            ) : (
              <span className="w-3" />
            )}
            <span className="truncate max-w-[180px]">{row.productName}</span>
          </div>
          {row.productType && (
            <span className="text-[10px] text-gray-500 ml-[18px]">{row.productType}</span>
          )}
        </td>
        {COLUMN_GROUPS.map((col) => (
          <td key={col.key} className="py-2 px-1 text-center">
            <CellBadge count={row.counts[col.key]} />
          </td>
        ))}
        <td className="py-2 px-3 text-center text-sm font-semibold text-[#F5F5F8]">
          {row.total}
        </td>
      </tr>
      {open && (
        <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <td colSpan={COLUMN_GROUPS.length + 2} className="py-2 px-3 bg-white/[0.02]">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-1 ml-[18px] text-[11px]">
              {COLUMN_GROUPS.map((col) => {
                const detail = row.details[col.key];
                const entries = Object.entries(detail).sort((a, b) => b[1] - a[1]);
                return (
                  <div key={col.key}>
                    <span className="text-gray-500">{col.parent} {col.label}:</span>{' '}
                    {entries.length === 0 ? (
                      <span className="text-gray-600">{'\u2014'}</span>
                    ) : (
                      <span className="text-gray-300">
                        {entries.map(([type, cnt], i) => (
                          <span key={type}>
                            {getCreativeTypeLabel(type)} ({cnt})
                            {i < entries.length - 1 ? ', ' : ''}
                          </span>
                        ))}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Main page ────────────────────────────────────────────────────

export default function CreativeMatrixPage() {
  const router = useRouter();
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [selectedBrandId, setSelectedBrandId] = useState<string | null>(null);

  const [rawFiles, setRawFiles] = useState<RawFile[]>([]);
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [totalFiles, setTotalFiles] = useState(0);
  const [dataLoading, setDataLoading] = useState(false);

  // Auth + brand setup
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

      if (!profile) {
        setLoading(false);
        return;
      }

      setUserRole(profile.role);

      if (['admin', 'founder'].includes(profile.role)) {
        const { data: brandList } = await supabase
          .from('brands')
          .select('id, name, slug')
          .is('archived_at', null)
          .order('name');
        setBrands(brandList || []);
        if (brandList && brandList.length > 0) {
          setSelectedBrandId(brandList[0].id);
        }
      } else {
        setSelectedBrandId(profile.brand_id);
      }

      setLoading(false);
    };
    init();
  }, [supabase, router]);

  // Fetch data when brand changes
  const fetchData = useCallback(async () => {
    if (!selectedBrandId) return;
    setDataLoading(true);

    const sb = createClient();
    await sb.auth.getSession();

    const [filesRes, productsRes, totalRes] = await Promise.all([
      sb
        .from('submission_files')
        .select(`
          id, product_id, product_name, creative_type, fidelity,
          hook_angle, media_format, status, file_name,
          submissions!inner (brand_id)
        `)
        .eq('submissions.brand_id', selectedBrandId)
        .not('creative_type', 'is', null),
      sb
        .from('shopify_products')
        .select('shopify_product_id, title, product_type')
        .eq('brand_id', selectedBrandId)
        .eq('status', 'active')
        .order('product_type')
        .order('title'),
      sb
        .from('submission_files')
        .select('id', { count: 'exact', head: true })
        .eq('submissions.brand_id', selectedBrandId),
    ]);

    setRawFiles((filesRes.data as any[]) || []);
    setAllProducts((productsRes.data as any[]) || []);
    setTotalFiles(totalRes.count || 0);
    setDataLoading(false);
  }, [selectedBrandId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ─── Build matrix ───────────────────────────────────────────────

  const { rows, emptyProducts, kpis } = useMemo(() => {
    // Build a map: productKey -> MatrixRow
    const rowMap = new Map<string, MatrixRow>();

    // Seed from tagged files
    for (const file of rawFiles) {
      const productKey = file.product_id ? String(file.product_id) : '__brand_general__';
      const productName = file.product_name || 'Brand / General';

      if (!rowMap.has(productKey)) {
        rowMap.set(productKey, {
          productId: productKey,
          productName,
          productType: '',
          counts: { hd_static: 0, hd_video: 0, lofi_static: 0, lofi_video: 0, other_static: 0, other_video: 0 },
          details: { hd_static: {}, hd_video: {}, lofi_static: {}, lofi_video: {}, other_static: {}, other_video: {} },
          total: 0,
        });
      }

      const row = rowMap.get(productKey)!;

      // Determine column group from creative_type
      const typeInfo = CREATIVE_TYPES_MAP.get(file.creative_type);
      if (typeInfo) {
        const colKey = `${typeInfo.fidelity === 'high_def' ? 'hd' : typeInfo.fidelity}_${typeInfo.format}` as ColKey;
        row.counts[colKey]++;
        row.details[colKey][file.creative_type] = (row.details[colKey][file.creative_type] || 0) + 1;
        row.total++;
      }
    }

    // Seed products that don't have any creatives yet
    const emptyProds: Product[] = [];
    for (const prod of allProducts) {
      const key = String(prod.shopify_product_id);
      if (rowMap.has(key)) {
        // Fill in product_type for existing rows
        rowMap.get(key)!.productType = prod.product_type || '';
      } else {
        emptyProds.push(prod);
      }
    }

    // Sort rows by total descending
    const sortedRows = Array.from(rowMap.values()).sort((a, b) => b.total - a.total);

    // KPIs
    const taggedCount = rawFiles.length;
    const productsWithCreatives = new Set(
      rawFiles.map((f) => f.product_id ? String(f.product_id) : '__brand_general__')
    ).size;
    const totalProducts = allProducts.length + 1; // +1 for Brand/General
    const coveragePct = totalProducts > 0 ? Math.round((productsWithCreatives / totalProducts) * 100) : 0;

    const distinctTypes = new Set(rawFiles.map((f) => f.creative_type)).size;
    const totalPossible = CREATIVE_TYPE_GROUPS.reduce((sum, g) => sum + g.types.length, 0);
    const groupsUsed = new Set(
      rawFiles.map((f) => {
        const info = CREATIVE_TYPES_MAP.get(f.creative_type);
        return info ? `${info.fidelity}_${info.format}` : null;
      }).filter(Boolean)
    ).size;

    // Biggest gap: column group with fewest creatives across all products
    const colTotals: Record<string, number> = {};
    for (const col of COLUMN_GROUPS) {
      colTotals[col.key] = sortedRows.reduce((sum, r) => sum + r.counts[col.key], 0);
    }
    const gapEntries = Object.entries(colTotals).sort((a, b) => a[1] - b[1]);
    const biggestGapKey = gapEntries[0]?.[0] || '';
    const biggestGapCol = COLUMN_GROUPS.find((c) => c.key === biggestGapKey);
    const biggestGapCount = gapEntries[0]?.[1] || 0;
    const biggestGapLabel = biggestGapCol ? `${biggestGapCol.parent} ${biggestGapCol.label}` : 'N/A';

    return {
      rows: sortedRows,
      emptyProducts: emptyProds,
      kpis: {
        taggedCount,
        productsWithCreatives,
        totalProducts,
        coveragePct,
        distinctTypes,
        totalPossible,
        groupsUsed,
        biggestGapLabel,
        biggestGapCount,
      },
    };
  }, [rawFiles, allProducts]);

  // ─── Empty products expand state ────────────────────────────────

  const [showEmpty, setShowEmpty] = useState(false);

  // ─── Column totals ──────────────────────────────────────────────

  const columnTotals = useMemo(() => {
    const totals: Record<ColKey, number> = {
      hd_static: 0, hd_video: 0, lofi_static: 0, lofi_video: 0, other_static: 0, other_video: 0,
    };
    for (const row of rows) {
      for (const col of COLUMN_GROUPS) {
        totals[col.key] += row.counts[col.key];
      }
    }
    return totals;
  }, [rows]);

  const grandTotal = useMemo(
    () => Object.values(columnTotals).reduce((a, b) => a + b, 0),
    [columnTotals]
  );

  // ─── Render ─────────────────────────────────────────────────────

  if (loading) {
    return (
      <Navbar>
        <div className="min-h-screen flex items-center justify-center">
          <Loader className="w-8 h-8 text-[#C8B89A] animate-spin" />
        </div>
      </Navbar>
    );
  }

  return (
    <Navbar>
      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Grid3X3 className="w-5 h-5 text-[#C8B89A]" />
              <h1 className="text-2xl font-bold text-[#F5F5F8] tracking-tight">
                Creative Diversity Matrix
              </h1>
            </div>
            <p className="text-sm text-[#ABABAB]">
              See creative coverage across your product catalog and creative types.
              Identify gaps and plan new content.
            </p>
          </div>

          {/* Brand selector (admin/founder) */}
          {['admin', 'founder'].includes(userRole || '') && brands.length > 0 && (
            <select
              value={selectedBrandId || ''}
              onChange={(e) => setSelectedBrandId(e.target.value)}
              className="px-3 py-2 rounded-lg text-sm text-[#F5F5F8] focus:outline-none"
              style={{
                backgroundColor: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.1)',
              }}
            >
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          )}
        </div>

        {dataLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader className="w-6 h-6 text-[#C8B89A] animate-spin" />
          </div>
        ) : rawFiles.length === 0 ? (
          /* Empty state */
          <div className="text-center py-20">
            <div
              className="w-14 h-14 rounded-xl mx-auto mb-4 flex items-center justify-center"
              style={{ backgroundColor: 'rgba(200,184,154,0.1)' }}
            >
              <AlertTriangle className="w-7 h-7 text-[#C8B89A]" />
            </div>
            <h2 className="text-lg font-bold text-[#F5F5F8] mb-2">No tagged creatives yet</h2>
            <p className="text-sm text-gray-500 max-w-md mx-auto mb-6">
              Upload creatives with product and type tags to start building your coverage matrix.
              The upload form lets you tag each file with a product and creative type.
            </p>
            <a
              href="/upload"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold text-[#0A0A0A]"
              style={{ background: 'linear-gradient(135deg, #C8B89A 0%, #A89474 100%)' }}
            >
              <Upload className="w-4 h-4" />
              Go to Upload
            </a>
          </div>
        ) : (
          <>
            {/* KPI cards */}
            <div className="flex flex-wrap gap-3 mb-8">
              <KpiCard
                label="Tagged creatives"
                value={kpis.taggedCount}
                sub={`of ${totalFiles} total files`}
              />
              <KpiCard
                label="Products covered"
                value={`${kpis.productsWithCreatives} / ${kpis.totalProducts}`}
                sub={`${kpis.coveragePct}% coverage`}
              />
              <KpiCard
                label="Types used"
                value={`${kpis.distinctTypes} / ${kpis.totalPossible}`}
                sub={`${kpis.groupsUsed} groups represented`}
              />
              <KpiCard
                label="Biggest gap"
                value={kpis.biggestGapLabel}
                sub={`${kpis.biggestGapCount} creatives total`}
              />
            </div>

            {/* Matrix table */}
            <div
              className="rounded-xl overflow-x-auto"
              style={{
                backgroundColor: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(255,255,255,0.08)',
              }}
            >
              <table className="w-full border-collapse" style={{ minWidth: 700 }}>
                <thead>
                  {/* Parent group headers */}
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                    <th
                      className="py-2 px-3 text-left text-[11px] text-gray-500 uppercase tracking-wider font-medium"
                      rowSpan={2}
                      style={{ width: 220 }}
                    >
                      Product
                    </th>
                    {PARENT_GROUPS.map((parent) => (
                      <th
                        key={parent}
                        colSpan={2}
                        className="py-2 px-1 text-center text-[11px] text-[#C8B89A] uppercase tracking-wider font-semibold"
                        style={{ borderLeft: '1px solid rgba(255,255,255,0.06)' }}
                      >
                        {parent}
                      </th>
                    ))}
                    <th
                      className="py-2 px-3 text-center text-[11px] text-gray-500 uppercase tracking-wider font-medium"
                      rowSpan={2}
                      style={{ borderLeft: '1px solid rgba(255,255,255,0.06)', width: 60 }}
                    >
                      Total
                    </th>
                  </tr>
                  {/* Sub-group headers */}
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                    {COLUMN_GROUPS.map((col, i) => (
                      <th
                        key={col.key}
                        className="py-1.5 px-1 text-center text-[10px] text-gray-500 font-medium"
                        style={{
                          borderLeft: i % 2 === 0 ? '1px solid rgba(255,255,255,0.06)' : 'none',
                        }}
                      >
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <ProductRow key={row.productId} row={row} />
                  ))}

                  {/* Empty products section */}
                  {emptyProducts.length > 0 && (
                    <>
                      <tr
                        className="cursor-pointer hover:bg-white/[0.03] transition-colors"
                        style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
                        onClick={() => setShowEmpty(!showEmpty)}
                      >
                        <td
                          colSpan={COLUMN_GROUPS.length + 2}
                          className="py-2.5 px-3 text-xs text-gray-500"
                        >
                          <div className="flex items-center gap-1.5">
                            {showEmpty ? (
                              <ChevronDown className="w-3 h-3" />
                            ) : (
                              <ChevronRight className="w-3 h-3" />
                            )}
                            <Package className="w-3 h-3" />
                            {emptyProducts.length} more product{emptyProducts.length !== 1 ? 's' : ''} with no creatives
                          </div>
                        </td>
                      </tr>
                      {showEmpty &&
                        emptyProducts
                          .slice()
                          .sort((a, b) => a.title.localeCompare(b.title))
                          .map((prod) => (
                            <tr
                              key={String(prod.shopify_product_id)}
                              style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}
                            >
                              <td className="py-1.5 px-3 text-sm text-gray-500 pl-[30px]">
                                {prod.title}
                                {prod.product_type && (
                                  <span className="text-[10px] text-gray-600 ml-2">
                                    {prod.product_type}
                                  </span>
                                )}
                              </td>
                              {COLUMN_GROUPS.map((col) => (
                                <td key={col.key} className="py-1.5 px-1 text-center">
                                  <CellBadge count={0} />
                                </td>
                              ))}
                              <td className="py-1.5 px-3 text-center text-sm text-gray-600">0</td>
                            </tr>
                          ))}
                    </>
                  )}
                </tbody>

                {/* Totals row */}
                <tfoot>
                  <tr
                    style={{
                      borderTop: '2px solid rgba(255,255,255,0.1)',
                    }}
                  >
                    <td className="py-2.5 px-3 text-sm font-semibold text-[#C8B89A]">Total</td>
                    {COLUMN_GROUPS.map((col) => (
                      <td key={col.key} className="py-2.5 px-1 text-center">
                        <CellBadge count={columnTotals[col.key]} />
                      </td>
                    ))}
                    <td className="py-2.5 px-3 text-center text-sm font-bold text-[#F5F5F8]">
                      {grandTotal}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Legend */}
            <div className="flex items-center gap-4 mt-4 text-[11px] text-gray-500">
              <span>Legend:</span>
              {[
                { label: 'Gap', count: 0 },
                { label: '1', count: 1 },
                { label: '2\u20133', count: 2 },
                { label: '4\u20135', count: 4 },
                { label: '6+', count: 6 },
              ].map((item) => {
                const s = cellStyle(item.count);
                return (
                  <div key={item.label} className="flex items-center gap-1.5">
                    <span
                      className="inline-block w-4 h-4 rounded"
                      style={{
                        backgroundColor: item.count === 0 ? 'rgba(255,255,255,0.06)' : s.bg,
                      }}
                    />
                    <span>{item.label}</span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </Navbar>
  );
}
