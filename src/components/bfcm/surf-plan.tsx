'use client';

import { useEffect, useState } from 'react';

export interface PlanDay {
  date: string;
  dayLabel: string;
  actual: string;
  orders: string;
  vsLastYear: string;
  revenueGoal: number | null;
  spendBudget: number | null;
  metaSpendBudget: number | null;
  googleSpendBudget: number | null;
  blendedRoasTarget: number | null;
  metaRoasTarget: number | null;
  googleRoasTarget: number | null;
  amerTarget: number | null;
}

type Field = 'revenueGoal' | 'spendBudget' | 'metaSpendBudget' | 'googleSpendBudget' | 'blendedRoasTarget' | 'metaRoasTarget' | 'googleRoasTarget' | 'amerTarget';

const FIELDS: { key: Field; label: string; step: number }[] = [
  { key: 'spendBudget', label: 'Spend', step: 1 },
  { key: 'metaSpendBudget', label: 'Meta spend', step: 1 },
  { key: 'googleSpendBudget', label: 'Google spend', step: 1 },
  { key: 'revenueGoal', label: 'Sales', step: 1 },
  { key: 'blendedRoasTarget', label: 'Blended ROAS', step: 0.1 },
  { key: 'metaRoasTarget', label: 'Meta ROAS', step: 0.1 },
  { key: 'googleRoasTarget', label: 'Google ROAS', step: 0.1 },
  { key: 'amerTarget', label: 'aMER', step: 0.1 },
];

function FieldInput({
  value,
  step,
  disabled,
  onCommit,
}: {
  value: number | null;
  step: number;
  disabled: boolean;
  onCommit: (value: number | null) => void;
}) {
  const [draft, setDraft] = useState(value == null ? '' : String(value));
  useEffect(() => {
    setDraft(value == null ? '' : String(value));
  }, [value]);
  return (
    <input
      type="number"
      min={0}
      step={step}
      disabled={disabled}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft.trim() === '') {
          onCommit(null);
          return;
        }
        const parsed = Number(draft);
        if (Number.isFinite(parsed) && parsed >= 0) onCommit(parsed);
      }}
      className="w-24 rounded px-2 py-1 text-xs tabular-nums"
      style={{ backgroundColor: '#0A0A0A', border: '1px solid rgba(255,255,255,0.08)', color: disabled ? '#888888' : '#F5F5F8' }}
    />
  );
}

export default function SurfPlan({
  days,
  currency,
  canEdit,
  planColumns,
  onSave,
}: {
  days: PlanDay[];
  currency: string;
  canEdit: boolean;
  planColumns: boolean;
  onSave: (date: string, patch: Partial<PlanDay>) => void;
}) {
  return (
    <div className="rounded-2xl p-4" style={{ backgroundColor: '#111111', border: '1px solid rgba(255,255,255,0.08)' }}>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
        <div>
          <h2 className="text-sm font-semibold" style={{ color: '#F5F5F8' }}>Day plan</h2>
          <p className="text-xs mt-1" style={{ color: '#ABABAB' }}>
            Saved in {currency}. The tracker splits spend and sales evenly across the 24 shop hours. Channel spend and ROAS targets are admin edits.
            {canEdit ? '' : ' View only.'}
          </p>
        </div>
      </div>
      {!planColumns && (
        <p className="text-xs mb-3" style={{ color: '#C8B89A' }}>
          Channel plan columns are not on this database yet. Revenue, spend, and aMER still save. Apply supabase/migrations/add_bfcm_surf_plan.sql.
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr style={{ color: '#ABABAB' }}>
              <th className="text-left py-2 pr-3 font-medium">Day</th>
              <th className="text-left py-2 pr-3 font-medium">Actual gross</th>
              <th className="text-left py-2 pr-3 font-medium">Orders</th>
              <th className="text-left py-2 pr-3 font-medium">Vs last year</th>
              {FIELDS.map((field) => (
                <th key={field.key} className="text-left py-2 pr-3 font-medium whitespace-nowrap">{field.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {days.map((day) => (
              <tr key={day.date} style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                <td className="py-2 pr-3 whitespace-nowrap" style={{ color: '#F5F5F8' }}>
                  {day.dayLabel}
                  <div style={{ color: '#888888' }}>{day.date}</div>
                </td>
                <td className="py-2 pr-3 tabular-nums" style={{ color: '#F5F5F8' }}>{day.actual}</td>
                <td className="py-2 pr-3 tabular-nums" style={{ color: '#F5F5F8' }}>{day.orders}</td>
                <td className="py-2 pr-3 tabular-nums" style={{ color: '#F5F5F8' }}>{day.vsLastYear}</td>
                {FIELDS.map((field) => {
                  const channel = field.key !== 'revenueGoal' && field.key !== 'spendBudget' && field.key !== 'amerTarget';
                  const disabled = !canEdit || (channel && !planColumns);
                  return (
                    <td key={field.key} className="py-2 pr-3">
                      <FieldInput
                        value={day[field.key]}
                        step={field.step}
                        disabled={disabled}
                        onCommit={(value) => onSave(day.date, { [field.key]: value })}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
