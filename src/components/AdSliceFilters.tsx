'use client';

import type { CSSProperties } from 'react';
import { ChevronDown } from 'lucide-react';
import {
  AD_FORMATS,
  AD_SOURCES,
  PRIMARY_FORMATS,
  matchesAdSlice,
  type AdFormat,
  type AdSource,
} from '@/lib/ad-classification';

export interface SliceAd {
  ad_source?: string;
  ad_format?: string;
}

interface Props {
  ads: SliceAd[];
  source: AdSource | 'all';
  format: AdFormat | 'all';
  onSource: (value: AdSource | 'all') => void;
  onFormat: (value: AdFormat | 'all') => void;
}

const selectStyle: CSSProperties = {
  backgroundColor: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.08)',
  color: '#F5F5F8',
};

function countWhere(ads: SliceAd[], pred: (ad: SliceAd) => boolean): number {
  let n = 0;
  for (const ad of ads) if (pred(ad)) n += 1;
  return n;
}

export function AdSliceFilters({ ads, source, format, onSource, onFormat }: Props) {
  const sourceUniverse = ads.filter((ad) => matchesAdSlice(ad, 'all', format));
  const formatUniverse = ads.filter((ad) => matchesAdSlice(ad, source, 'all'));

  const sourceOptions = AD_SOURCES.filter((option) => {
    if (option.value === source) return true;
    if (option.value === 'unknown') {
      return countWhere(sourceUniverse, (ad) => ad.ad_source === 'unknown') > 0;
    }
    return true;
  });

  const formatOptions = AD_FORMATS.filter((option) => {
    if (option.value === format) return true;
    if (PRIMARY_FORMATS.includes(option.value)) return true;
    return countWhere(formatUniverse, (ad) => ad.ad_format === option.value) > 0;
  });

  return (
    <>
      <div className="relative" title="Brand-run ads use the brand's own page. Whitelisted / Partner ads are Meta partnership or branded-content ads.">
        <select
          aria-label="Ad source"
          value={source}
          onChange={(e) => onSource(e.target.value as AdSource | 'all')}
          className="appearance-none text-sm rounded-lg pl-3 pr-8 py-2 cursor-pointer"
          style={selectStyle}
        >
          <option value="all" style={{ backgroundColor: '#1a1a1a' }}>
            All sources ({sourceUniverse.length})
          </option>
          {sourceOptions.map((option) => (
            <option key={option.value} value={option.value} style={{ backgroundColor: '#1a1a1a' }}>
              {option.label} ({countWhere(sourceUniverse, (ad) => ad.ad_source === option.value)})
            </option>
          ))}
        </select>
        <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: '#666' }} />
      </div>

      <div className="relative" title="Format comes from the ad creative. Catalog and Flexible show up when Meta marks an ad that way. Anything unclear is Other.">
        <select
          aria-label="Ad format"
          value={format}
          onChange={(e) => onFormat(e.target.value as AdFormat | 'all')}
          className="appearance-none text-sm rounded-lg pl-3 pr-8 py-2 cursor-pointer"
          style={selectStyle}
        >
          <option value="all" style={{ backgroundColor: '#1a1a1a' }}>
            All formats ({formatUniverse.length})
          </option>
          {formatOptions.map((option) => (
            <option key={option.value} value={option.value} style={{ backgroundColor: '#1a1a1a' }}>
              {option.label} ({countWhere(formatUniverse, (ad) => ad.ad_format === option.value)})
            </option>
          ))}
        </select>
        <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: '#666' }} />
      </div>
    </>
  );
}

export function PartnerPill({ source }: { source?: string }) {
  if (source !== 'partnership') return null;
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-md text-[9px] font-semibold uppercase tracking-widest"
      style={{
        backgroundColor: 'rgba(155,142,196,0.16)',
        color: '#C4B6E0',
        border: '1px solid rgba(155,142,196,0.35)',
      }}
    >
      Partner
    </span>
  );
}
