'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import type { Fmt } from '@/lib/format';
import type { ProductGroup } from '@/lib/live-creatives/present';

export interface ProductChoice {
  product_key: string;
  product_label: string;
  product_kind: string;
}

const selectStyle: CSSProperties = {
  backgroundColor: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.08)',
  color: '#F5F5F8',
};

export function ProductChip({ label, title }: { label: string; title?: string }) {
  return (
    <span
      title={title || label}
      className="inline-flex items-center max-w-full px-2 py-0.5 rounded-md text-[9px] font-semibold uppercase tracking-widest truncate"
      style={{
        backgroundColor: 'rgba(200,184,154,0.14)',
        color: '#C8B89A',
        border: '1px solid rgba(200,184,154,0.35)',
      }}
    >
      {label}
    </span>
  );
}

export function ProductFilter({
  options,
  selected,
  onChange,
}: {
  options: Array<ProductChoice & { count: number }>;
  selected: string[];
  onChange: (keys: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  const label = selected.length === 0
    ? 'All products'
    : `${selected.length} product${selected.length === 1 ? '' : 's'}`;

  const toggle = (key: string) => {
    onChange(selected.includes(key) ? selected.filter((item) => item !== key) : [...selected, key]);
  };

  return (
    <div className="relative" ref={root} title="Product comes from the ad's landing page. A manual override wins.">
      <button
        type="button"
        aria-label="Product"
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-2 text-sm rounded-lg pl-3 pr-3 py-2 cursor-pointer"
        style={selectStyle}
      >
        {label}
        <ChevronDown size={14} style={{ color: '#666' }} />
      </button>
      {open && (
        <div
          className="absolute top-full left-0 mt-1 w-72 rounded-lg py-1 z-50 max-h-80 overflow-auto"
          style={{
            backgroundColor: '#1A1A1A',
            border: '1px solid rgba(255,255,255,0.1)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          }}
        >
          <button
            type="button"
            onClick={() => onChange([])}
            className="w-full text-left px-3 py-2 text-sm flex items-center justify-between"
            style={{ color: selected.length === 0 ? '#C8B89A' : '#CCC' }}
          >
            All products
            {selected.length === 0 && <Check size={14} style={{ color: '#C8B89A' }} />}
          </button>
          {options.length === 0 && (
            <p className="px-3 py-2 text-xs" style={{ color: '#666' }}>
              No product tags yet. An admin can sync active ads.
            </p>
          )}
          {options.map((option) => {
            const on = selected.includes(option.product_key);
            return (
              <button
                key={option.product_key}
                type="button"
                onClick={() => toggle(option.product_key)}
                className="w-full text-left px-3 py-2 text-sm flex items-center justify-between gap-3"
                style={{ color: on ? '#C8B89A' : '#CCC', backgroundColor: on ? 'rgba(200,184,154,0.08)' : 'transparent' }}
              >
                <span className="truncate">{option.product_label}</span>
                <span className="flex items-center gap-2 flex-shrink-0">
                  <span style={{ color: '#666' }}>{option.count}</span>
                  {on && <Check size={14} style={{ color: '#C8B89A' }} />}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function ProductOverride({
  choices,
  value,
  disabled,
  onChange,
}: {
  choices: ProductChoice[];
  value: string;
  disabled?: boolean;
  onChange: (choice: ProductChoice | null) => void;
}) {
  const options = choices.some((choice) => choice.product_key === value) || !value
    ? choices
    : [{ product_key: value, product_label: value, product_kind: 'product' }, ...choices];
  return (
    <select
      aria-label="Override product"
      value={options.some((choice) => choice.product_key === value) ? value : ''}
      disabled={disabled}
      onClick={(event) => event.stopPropagation()}
      onChange={(event) => {
        event.stopPropagation();
        const next = event.target.value;
        if (!next) {
          onChange(null);
          return;
        }
        const choice = options.find((item) => item.product_key === next) || null;
        if (choice) onChange(choice);
      }}
      className="w-full text-[11px] rounded-lg pl-2 pr-6 py-1.5 cursor-pointer"
      style={{ ...selectStyle, color: '#C8B89A' }}
    >
      <option value="" style={{ backgroundColor: '#1a1a1a' }}>Use landing page</option>
      {options.map((choice) => (
        <option key={choice.product_key} value={choice.product_key} style={{ backgroundColor: '#1a1a1a' }}>
          {choice.product_label}
        </option>
      ))}
    </select>
  );
}

export function ByProductView({ groups, fmt }: { groups: ProductGroup[]; fmt: Fmt }) {
  if (!groups.length) {
    return (
      <p className="text-sm py-10 text-center" style={{ color: '#666' }}>
        No product groups for these ads.
      </p>
    );
  }
  return (
    <div
      className="rounded-xl overflow-hidden mb-8"
      style={{ backgroundColor: 'rgba(13,13,13,0.6)', border: '1px solid rgba(255,255,255,0.06)' }}
    >
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              {['Product', 'Active creatives', 'Spend', 'ROAS', 'CPA'].map((heading, index) => (
                <th
                  key={heading}
                  className={`${index === 0 ? 'text-left' : 'text-right'} px-4 py-3 text-[10px] font-bold uppercase tracking-widest`}
                  style={{ color: '#666' }}
                >
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <tr key={group.product_key} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                <td className="px-4 py-3">
                  <ProductChip label={group.product_label} />
                </td>
                <td className="px-4 py-3 text-right text-sm tabular-nums" style={{ color: '#F5F5F8' }}>{group.creatives}</td>
                <td className="px-4 py-3 text-right text-sm tabular-nums" style={{ color: '#C8B89A' }}>{fmt.currencyFull(group.spend)}</td>
                <td className="px-4 py-3 text-right text-sm tabular-nums" style={{ color: '#F5F5F8' }}>{fmt.x(group.roas)}</td>
                <td className="px-4 py-3 text-right text-sm tabular-nums" style={{ color: '#F5F5F8' }}>
                  {group.purchases > 0 ? fmt.currencyFull(group.cpa) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="px-4 py-3 text-[11px]" style={{ color: '#555' }}>
        ROAS is purchase value divided by spend. CPA is spend divided by purchases. A flexible ad splits those totals across its assets. A carousel stays on the first card.
      </p>
    </div>
  );
}
