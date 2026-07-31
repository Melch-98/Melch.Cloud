'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { ChevronDown, ChevronUp, Grid3X3 } from 'lucide-react';
import { createClient } from '@/lib/supabase';
import { CREATIVE_TYPES_MAP } from '@/lib/creative-types';

interface MatrixRow {
  product_name: string;
  creative_type: string;
  fidelity: string;
  count: number;
}

/** column key = `${fidelity}_${format}` */
const COLUMNS: { key: string; label: string }[] = [
  { key: 'high_def_static', label: 'HD Static' },
  { key: 'high_def_video', label: 'HD Video' },
  { key: 'lofi_static', label: 'Lofi Static' },
  { key: 'lofi_video', label: 'Lofi Video' },
  { key: 'other_static', label: 'Other Static' },
  { key: 'other_video', label: 'Other Video' },
];

function columnKeyForType(creativeType: string): string | null {
  const opt = CREATIVE_TYPES_MAP.get(creativeType);
  if (!opt) return null;
  return `${opt.fidelity}_${opt.format}`;
}

function cellColor(count: number): { bg: string; fg: string } {
  if (count === 0) return { bg: 'rgba(239,68,68,0.08)', fg: '#7f4444' };
  if (count <= 3) return { bg: 'rgba(234,179,8,0.12)', fg: '#EAB308' };
  return { bg: 'rgba(34,197,94,0.12)', fg: '#4ade80' };
}

interface CreativeMatrixSummaryProps {
  brandId?: string;
  /** Pending uploads in the current form: creativeType + productName pairs */
  pendingTags: { creativeType: string; productName: string }[];
}

const CreativeMatrixSummary: React.FC<CreativeMatrixSummaryProps> = ({
  brandId,
  pendingTags,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [rows, setRows] = useState<MatrixRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    const fetchMatrix = async () => {
      if (!brandId) {
        setRows([]);
        return;
      }
      setLoading(true);
      setLoadError(false);
      try {
        const supabase = createClient();
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const res = await fetch(`/api/creative-matrix-summary?brand_id=${brandId}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (res.ok) {
          const json = await res.json();
          setRows(json.rows || []);
        } else {
          setLoadError(true);
        }
      } catch {
        setLoadError(true);
      } finally {
        setLoading(false);
      }
    };
    fetchMatrix();
  }, [brandId]);

  // Build grid: top 5 products by total creative count
  const grid = useMemo(() => {
    const productTotals = new Map<string, number>();
    const cells = new Map<string, number>(); // `${product}|${colKey}` -> count

    for (const row of rows) {
      const colKey = columnKeyForType(row.creative_type);
      if (!colKey) continue;
      productTotals.set(
        row.product_name,
        (productTotals.get(row.product_name) || 0) + row.count
      );
      const key = `${row.product_name}|${colKey}`;
      cells.set(key, (cells.get(key) || 0) + row.count);
    }

    const topProducts = Array.from(productTotals.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name]) => name);

    // Pending +N from the current form
    const pending = new Map<string, number>();
    for (const tag of pendingTags) {
      if (!tag.creativeType) continue;
      const colKey = columnKeyForType(tag.creativeType);
      if (!colKey) continue;
      const product = tag.productName || 'Unassigned';
      const key = `${product}|${colKey}`;
      pending.set(key, (pending.get(key) || 0) + 1);
      // Make sure products that only exist in pending still show (if room)
      if (!topProducts.includes(product) && topProducts.length < 5) {
        topProducts.push(product);
      }
    }

    return { topProducts, cells, pending };
  }, [rows, pendingTags]);

  if (!brandId) return null;

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{
        backgroundColor: '#111111',
        border: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 transition-colors hover:bg-[rgba(200,184,154,0.05)]"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-[#F5F5F8]">
          <Grid3X3 className="w-4 h-4 text-[#C8B89A]" />
          Creative Coverage
        </span>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-[#C8B89A]" />
        ) : (
          <ChevronDown className="w-4 h-4 text-[#C8B89A]" />
        )}
      </button>

      {expanded && (
        <div className="px-4 pb-4">
          {loading ? (
            <p className="text-xs text-gray-500 py-2">Loading coverage…</p>
          ) : loadError ? (
            <p className="text-xs text-gray-500 py-2">Couldn&apos;t load coverage data.</p>
          ) : grid.topProducts.length === 0 ? (
            <p className="text-xs text-gray-500 py-2">
              No tagged creatives yet for this brand.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className="text-left text-[9px] font-medium text-gray-500 uppercase tracking-wider py-1.5 pr-2" />
                    {COLUMNS.map((col) => (
                      <th
                        key={col.key}
                        className="text-center text-[9px] font-medium text-gray-500 uppercase tracking-wider py-1.5 px-1"
                      >
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {grid.topProducts.map((product) => (
                    <tr key={product}>
                      <td
                        className="text-[10px] text-[#ABABAB] py-1 pr-2 truncate"
                        style={{ maxWidth: 110 }}
                        title={product}
                      >
                        {product}
                      </td>
                      {COLUMNS.map((col) => {
                        const key = `${product}|${col.key}`;
                        const count = grid.cells.get(key) || 0;
                        const plus = grid.pending.get(key) || 0;
                        const { bg, fg } = cellColor(count);
                        return (
                          <td key={col.key} className="p-0.5">
                            <div
                              className="rounded-md text-center text-[10px] font-semibold py-1.5 relative"
                              style={{ backgroundColor: bg, color: fg }}
                            >
                              {count}
                              {plus > 0 && (
                                <span
                                  className="absolute -top-1 -right-1 text-[8px] font-bold px-1 rounded-full"
                                  style={{
                                    backgroundColor: '#C8B89A',
                                    color: '#0A0A0A',
                                  }}
                                >
                                  +{plus}
                                </span>
                              )}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default CreativeMatrixSummary;
