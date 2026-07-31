'use client';

import React, { useMemo, useState, useEffect } from 'react';
import { Image as ImageIcon, Video, Sparkles, Camera, Film, Shapes } from 'lucide-react';
import { CREATIVE_TYPE_GROUPS, CREATIVE_TYPES_MAP } from '@/lib/creative-types';

interface CreativeTypeSelectorProps {
  /** Currently selected creative type value ('' for none) */
  value: string;
  /** '' when the selection is mixed across a multi-select */
  isMixed?: boolean;
  /** Media format of the file(s) being tagged — used to dim mismatched groups */
  fileFormat?: 'static' | 'video' | null;
  onChange: (value: string) => void;
}

const GROUP_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  'High Def \u2014 Static': Camera,
  'High Def \u2014 Video': Film,
  'Lofi \u2014 Static': ImageIcon,
  'Lofi \u2014 Video': Video,
  'Other Formats \u2014 Static': Shapes,
  'Other Formats \u2014 Video': Sparkles,
};

const SHORT_LABELS: Record<string, string> = {
  'High Def \u2014 Static': 'High Def Static',
  'High Def \u2014 Video': 'High Def Video',
  'Lofi \u2014 Static': 'Lofi Static',
  'Lofi \u2014 Video': 'Lofi Video',
  'Other Formats \u2014 Static': 'Other Static',
  'Other Formats \u2014 Video': 'Other Video',
};

const CreativeTypeSelector: React.FC<CreativeTypeSelectorProps> = ({
  value,
  isMixed = false,
  fileFormat = null,
  onChange,
}) => {
  // Which group is expanded. Defaults to the group of the current value.
  const valueGroupLabel = useMemo(() => {
    if (!value) return null;
    const opt = CREATIVE_TYPES_MAP.get(value);
    if (!opt) return null;
    return (
      CREATIVE_TYPE_GROUPS.find(
        (g) => g.fidelity === opt.fidelity && g.format === opt.format
      )?.label ?? null
    );
  }, [value]);

  const [expandedGroup, setExpandedGroup] = useState<string | null>(valueGroupLabel);

  // Keep expansion in sync when the selected asset changes underneath us
  useEffect(() => {
    setExpandedGroup(valueGroupLabel);
  }, [valueGroupLabel]);

  const activeGroup = CREATIVE_TYPE_GROUPS.find((g) => g.label === expandedGroup);

  return (
    <div>
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-2">
        Creative Type
        {isMixed && (
          <span
            className="text-[9px] font-bold px-1.5 py-0.5 rounded normal-case tracking-normal"
            style={{ backgroundColor: 'rgba(234,179,8,0.12)', color: '#EAB308' }}
          >
            Mixed
          </span>
        )}
      </p>

      {/* Step 1: 3x2 grid of group pills */}
      <div className="grid grid-cols-3 gap-1.5">
        {CREATIVE_TYPE_GROUPS.map((group) => {
          const Icon = GROUP_ICONS[group.label] || Shapes;
          const isActive = expandedGroup === group.label;
          const hasSelection = valueGroupLabel === group.label;
          // Dim (but never disable) groups whose format doesn't match the file
          const dimmed = fileFormat !== null && group.format !== fileFormat;
          return (
            <button
              key={group.label}
              type="button"
              onClick={() =>
                setExpandedGroup(isActive ? null : group.label)
              }
              className="flex flex-col items-center gap-1 px-2 py-2.5 rounded-lg text-center transition-colors duration-150"
              style={{
                backgroundColor: hasSelection
                  ? 'rgba(200,184,154,0.15)'
                  : isActive
                  ? 'rgba(200,184,154,0.08)'
                  : 'rgba(255,255,255,0.03)',
                border: hasSelection
                  ? '1px solid rgba(200,184,154,0.5)'
                  : isActive
                  ? '1px solid rgba(200,184,154,0.3)'
                  : '1px solid rgba(255,255,255,0.06)',
                opacity: dimmed && !isActive && !hasSelection ? 0.4 : 1,
              }}
            >
              <span style={{ color: hasSelection || isActive ? '#C8B89A' : '#ABABAB' }}>
                <Icon className="w-3.5 h-3.5" />
              </span>
              <span
                className="text-[10px] font-medium leading-tight"
                style={{ color: hasSelection || isActive ? '#C8B89A' : '#ABABAB' }}
              >
                {SHORT_LABELS[group.label]}
              </span>
            </button>
          );
        })}
      </div>

      {/* Step 2: subtype pills for the expanded group */}
      <div
        className="overflow-hidden transition-all duration-200"
        style={{ maxHeight: activeGroup ? 200 : 0 }}
      >
        {activeGroup && (
          <div className="flex flex-wrap gap-1.5 pt-2.5">
            {activeGroup.types.map((t) => {
              const selected = value === t.value && !isMixed;
              return (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => onChange(selected ? '' : t.value)}
                  className="px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors duration-150"
                  style={{
                    backgroundColor: selected
                      ? 'rgba(200,184,154,0.9)'
                      : 'rgba(255,255,255,0.04)',
                    border: selected
                      ? '1px solid #C8B89A'
                      : '1px solid rgba(255,255,255,0.1)',
                    color: selected ? '#0A0A0A' : '#F5F5F8',
                  }}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default CreativeTypeSelector;
