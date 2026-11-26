'use client';

import { useState } from 'react';
import {
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { saleToDate, type Figure, type HourRow, type SurfView } from '@/lib/bfcm/surf';

// Melch.Cloud tokens, the same values the dashboard and the other analytics
// pages use (tailwind brand / surface / text / success / error / warning).
const TEXT = '#F5F5F8';
const MUTED = '#ABABAB';
const DIM = '#888888';
const CARD = '#111111';
const LINE_COLOR = 'rgba(255,255,255,0.08)';
const GOLD = '#C8B89A';
const INK = '#0A0A0A';
const SUCCESS = '#22C55E';
const DANGER = '#EF4444';
const WARNING = '#F59E0B';
const PLAN_LINE = '#888888';
const NOW_LINE = 'rgba(200,184,154,0.4)';

type SaleToDate = ReturnType<typeof saleToDate>;

function money(amount: number, currency: string): string {
  const symbols: Record<string, string> = { USD: '$', CAD: 'CA$', GBP: '£', EUR: '€', AUD: 'A$' };
  const prefix = symbols[currency] || `${currency} `;
  const abs = Math.abs(amount);
  const sign = amount < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}${prefix}${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 10_000) return `${sign}${prefix}${(abs / 1_000).toFixed(1)}K`;
  return `${sign}${prefix}${abs.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

function roas(amount: number): string {
  return `${amount.toFixed(2)}x`;
}

function show(figure: Figure, kind: 'money' | 'roas' | 'count' | 'pct', currency: string): string {
  if (figure.status === 'value') {
    if (kind === 'money') return money(figure.value, currency);
    if (kind === 'roas') return roas(figure.value);
    if (kind === 'pct') return `${figure.value.toFixed(0)}%`;
    return figure.value.toLocaleString('en-US', { maximumFractionDigits: 0 });
  }
  if (figure.status === 'unavailable') return 'unavailable';
  if (figure.status === 'no_plan') return 'no plan';
  return '—';
}

function reason(figure: Figure): string | undefined {
  if (figure.status === 'unavailable' || figure.status === 'no_plan') return figure.reason;
  return undefined;
}

function toneColor(tone: 'green' | 'red' | 'neutral'): string {
  if (tone === 'green') return SUCCESS;
  if (tone === 'red') return DANGER;
  return MUTED;
}

function callColor(call: SurfView['recommendation']['call']): string {
  if (call === 'HOLD') return GOLD;
  if (call === 'PUSH') return SUCCESS;
  if (call === 'PULL') return DANGER;
  return MUTED;
}

function feedColor(label: string): string {
  if (label === 'No Shopify connected') return DANGER;
  if (label === 'delayed (Triple Whale)') return WARNING;
  return GOLD;
}

function dateChip(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return date;
  const stamp = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
  const weekday = stamp.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
  return `${weekday} ${Number(match[2])}-${Number(match[3])}`;
}

function Kpi({ card, currency }: { card: SurfView['kpis'][number]; currency: string }) {
  const width = card.progress == null ? 0 : Math.max(0, Math.min(100, card.progress * 100));
  const bar = card.tone === 'red' ? DANGER : GOLD;
  const sub = card.id === 'roas'
    ? card.dayPlan.status === 'value'
      ? `target ${roas(card.dayPlan.value)}`
      : 'no blended ROAS target'
    : card.plannedByNow.status === 'value' && card.dayPlan.status === 'value'
      ? `${money(card.plannedByNow.value, currency)} planned by now · day ${money(card.dayPlan.value, currency)}`
      : card.plannedByNow.status === 'no_plan'
        ? card.plannedByNow.reason
        : reason(card.value) || '—';
  return (
    <div className="rounded-2xl px-4 py-3 min-w-0" style={{ backgroundColor: CARD, border: `1px solid ${LINE_COLOR}` }}>
      <div className="text-[11px] uppercase tracking-wide" style={{ color: MUTED }}>{card.label}</div>
      <div className="text-2xl font-semibold tabular-nums mt-1" style={{ color: card.value.status === 'value' ? TEXT : MUTED }}>
        {show(card.value, card.id === 'roas' ? 'roas' : 'money', currency)}
      </div>
      <div className="text-[11px] mt-1 leading-snug" style={{ color: MUTED }}>{sub}</div>
      <div className="h-1.5 rounded-full mt-3 overflow-hidden" style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}>
        <div className="h-full rounded-full" style={{ width: `${width}%`, backgroundColor: card.value.status === 'value' ? bar : 'transparent' }} />
      </div>
      <div className="text-[11px] mt-1.5" style={{ color: toneColor(card.tone) }}>{card.deltaLabel}</div>
    </div>
  );
}

function Cell({ figure, kind, currency, tone }: { figure: Figure; kind: 'money' | 'roas' | 'count' | 'pct'; currency: string; tone?: 'green' | 'red' | 'neutral' }) {
  return (
      <td className="px-2 py-1.5 tabular-nums whitespace-nowrap" title={reason(figure)} style={{ color: figure.status === 'value' ? (tone && tone !== 'neutral' ? toneColor(tone) : TEXT) : MUTED }}>
      {show(figure, kind, currency)}
    </td>
  );
}

function HourCells({ row, currency, estimate }: { row: HourRow; currency: string; estimate?: boolean }) {
  return (
    <>
      <Cell figure={row.metaSpend} kind="money" currency={currency} />
      <Cell figure={row.googleSpend} kind="money" currency={currency} />
      <Cell figure={row.spend} kind="money" currency={currency} />
      <Cell figure={row.sales} kind="money" currency={currency} />
      <Cell figure={row.roas} kind="roas" currency={currency} tone={row.roasTone} />
      <td className="px-2 py-1.5 tabular-nums whitespace-nowrap" title={estimate ? 'Estimate. Default Meta backfill curve, not measured on this brand.' : reason(row.expectedFinalRoas)} style={{ color: row.expectedFinalRoas.status === 'value' ? toneColor(row.roasTone) : MUTED }}>
        {show(row.expectedFinalRoas, 'roas', currency)}
        {estimate ? ' est' : ''}
      </td>
      <Cell figure={row.trendingRoas} kind="roas" currency={currency} tone={row.trendingTone} />
      <Cell figure={row.orders} kind="count" currency={currency} />
      <Cell figure={row.newPct} kind="pct" currency={currency} />
      <Cell figure={row.aov} kind="money" currency={currency} />
      <Cell figure={row.sessions} kind="count" currency={currency} />
      <Cell figure={row.cvr} kind="pct" currency={currency} />
    </>
  );
}

export default function SurfTracker({
  currency,
  timezone,
  date,
  windowStart,
  windowEnd,
  feedLabel,
  refreshedAt,
  view,
  toDate,
  notes,
  canEditNotes,
  onSaveNote,
  onRefresh,
  onChangeBudgets,
}: {
  currency: string;
  timezone: string;
  date: string;
  windowStart: string;
  windowEnd: string;
  feedLabel: string;
  refreshedAt: Date | null;
  view: SurfView;
  toDate: SaleToDate | null;
  notes: { status: 'ready'; byHour: Record<number, string> } | { status: 'unavailable'; reason: string };
  canEditNotes: boolean;
  onSaveNote: (hour: number, note: string) => void;
  onRefresh: () => void;
  onChangeBudgets: () => void;
}) {
  const [why, setWhy] = useState(false);
  const [compact, setCompact] = useState(false);
  const [chart, setChart] = useState<'spend' | 'sales'>('sales');
  const series = chart === 'spend' ? view.charts.spend : view.charts.sales;
  const liveLabel = view.hours.find((row) => row.settled === 'live')?.label;
  const spend = view.kpis.find((card) => card.id === 'spend');
  const call = view.recommendation.call;
  const refreshed = refreshedAt
    ? refreshedAt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: timezone })
    : '—';

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-2" style={{ backgroundColor: CARD, border: `1px solid ${LINE_COLOR}` }}>
        <div>
          <div className="text-[11px] uppercase tracking-wide" style={{ color: MUTED }}>Sale</div>
          <div className="text-sm" style={{ color: TEXT }}>{windowStart} – {windowEnd}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide" style={{ color: MUTED }}>Sync</div>
          <div className="text-sm" style={{ color: feedColor(feedLabel) }}>{feedLabel}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide" style={{ color: MUTED }}>Target ROAS</div>
          <div className="text-sm tabular-nums" style={{ color: TEXT }}>{view.recommendation.target == null ? 'no target' : roas(view.recommendation.target)}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide" style={{ color: MUTED }}>Sale to date</div>
          <div className="text-sm tabular-nums" style={{ color: TEXT }}>
            {toDate?.sales == null ? 'unavailable' : money(toDate.sales, currency)}
            {toDate?.salesPlanComplete && toDate.salesPlan != null ? ` vs plan ${money(toDate.salesPlan, currency)}` : ' · plan incomplete'}
          </div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide" style={{ color: MUTED }}>Today spend vs plan</div>
          <div className="text-sm tabular-nums" style={{ color: toneColor(spend?.tone || 'neutral') }}>
            {spend ? show(spend.value, 'money', currency) : '—'}
            {spend?.plannedByNow.status === 'value' ? ` · ${spend.deltaLabel}` : ''}
          </div>
        </div>
        <div className="ml-auto text-[11px]" style={{ color: MUTED }}>
          {timezone} · refreshed {refreshed}
        </div>
      </div>

      <div className="rounded-2xl px-4 py-3 flex flex-wrap items-start gap-4" style={{ backgroundColor: CARD, border: `1px solid ${LINE_COLOR}` }}>
        <div className="rounded-full px-3 py-1 text-xs font-semibold tracking-wide" style={{ color: INK, backgroundColor: callColor(call) }}>
          {call === 'NO_PLAN' ? 'NO PLAN' : call === 'NO_CALL' ? 'NO CALL' : call}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm" style={{ color: TEXT }}>{view.recommendation.headline}</div>
          <div className="text-xs mt-1" style={{ color: MUTED }}>{view.recommendation.detail}</div>
          <div className="text-xs mt-1" style={{ color: GOLD }}>{view.recommendation.siteNote}</div>
          {why && (
            <ul className="mt-2 text-xs space-y-1" style={{ color: MUTED }}>
              {view.method.slice(4, 9).map((line) => <li key={line}>{line}</li>)}
            </ul>
          )}
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => setWhy((open) => !open)} className="rounded-full px-3 py-1 text-xs" style={{ color: TEXT, border: `1px solid ${LINE_COLOR}` }}>Why?</button>
          <button type="button" onClick={onChangeBudgets} className="rounded-full px-3 py-1 text-xs" style={{ color: INK, backgroundColor: GOLD }}>Change budgets</button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {view.kpis.map((card) => <Kpi key={card.id} card={card} currency={currency} />)}
      </div>

      <div className="rounded-2xl px-4 py-2 text-xs flex flex-wrap gap-x-5 gap-y-1" style={{ backgroundColor: CARD, color: MUTED }}>
        <span>Sales {view.saleSoFar.salesDeltaPct == null ? 'no sales plan' : `${view.saleSoFar.salesDeltaPct >= 0 ? '+' : ''}${view.saleSoFar.salesDeltaPct.toFixed(0)}% vs expected`}</span>
        <span>
          On course for {view.saleSoFar.onCourse == null ? 'unavailable' : money(view.saleSoFar.onCourse, currency)}
          {view.saleSoFar.salesPlan != null ? ` vs ${money(view.saleSoFar.salesPlan, currency)}` : ''}
        </span>
        <span>Spend {view.saleSoFar.spendDeltaPct == null ? 'no spend plan' : `${view.saleSoFar.spendDeltaPct >= 0 ? '+' : ''}${view.saleSoFar.spendDeltaPct.toFixed(0)}% vs planned`}</span>
        {view.saleSoFar.note && <span>{view.saleSoFar.note}</span>}
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="rounded-full px-3 py-1 text-xs" style={{ backgroundColor: GOLD, color: INK }}>{dateChip(date)} · today</div>
      </div>

      <div className="rounded-2xl p-4" style={{ backgroundColor: CARD, border: `1px solid ${LINE_COLOR}` }}>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div className="flex rounded-full p-0.5" style={{ backgroundColor: '#0A0A0A' }}>
            {(['spend', 'sales'] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setChart(key)}
                className="rounded-full px-3 py-1 text-xs"
                style={{ backgroundColor: chart === key ? GOLD : 'transparent', color: chart === key ? INK : MUTED }}
              >
                {key === 'spend' ? 'Ad spend' : 'Store sales'}
              </button>
            ))}
          </div>
          <div className="text-xs tabular-nums text-right" style={{ color: MUTED }}>
            <div>So far <span style={{ color: TEXT }}>{series.soFar == null ? 'unavailable' : money(series.soFar, currency)}</span></div>
            <div>Plan by now <span style={{ color: TEXT }}>{series.planByNow == null ? 'no plan' : money(series.planByNow, currency)}</span>
              {series.pacePct != null && <span style={{ color: series.pacePct >= 0 ? SUCCESS : DANGER }}> {series.pacePct >= 0 ? '+' : ''}{series.pacePct.toFixed(1)}%</span>}
            </div>
            <div>Day plan <span style={{ color: TEXT }}>{series.dayPlan == null ? 'no plan' : money(series.dayPlan, currency)}</span></div>
          </div>
        </div>
        {series.available ? (
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series.points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <XAxis dataKey="label" tick={{ fill: DIM, fontSize: 10 }} interval={3} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: DIM, fontSize: 10 }} axisLine={false} tickLine={false} width={48} tickFormatter={(n: number) => money(n, currency)} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1a1a1a', border: `1px solid ${LINE_COLOR}`, borderRadius: 8, fontSize: 12, color: TEXT }}
                  formatter={(n) => (typeof n === 'number' ? money(n, currency) : '—')}
                />
                {liveLabel && <ReferenceLine x={liveLabel} stroke={NOW_LINE} strokeDasharray="3 3" />}
                <Line type="monotone" dataKey="actual" stroke={GOLD} strokeWidth={2} dot={false} connectNulls={false} name="Actual" />
                <Line type="monotone" dataKey="plan" stroke={PLAN_LINE} strokeWidth={1.5} strokeDasharray="5 5" dot={false} name="Plan" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="h-40 flex items-center justify-center text-sm" style={{ color: MUTED }}>{series.reason || 'unavailable'}</div>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Total label="Spend" primary={show(view.totals.spend, 'money', currency)} secondary={`Meta ${show(view.totals.metaSpend, 'money', currency)} · Google ${show(view.totals.googleSpend, 'money', currency)}`} title={reason(view.totals.spend)} />
        <Total label="Store sales" primary={show(view.totals.sales, 'money', currency)} secondary="Shopify gross" title={reason(view.totals.sales)} />
        <Total label="Blended ROAS" primary={show(view.totals.roas, 'roas', currency)} secondary={view.totals.expectedFinalRoas.status === 'value' ? `exp. final ${roas(view.totals.expectedFinalRoas.value)} est` : 'exp. final unavailable'} title={reason(view.totals.roas)} tone={view.totals.roasTone} />
        <Total label="Orders" primary={show(view.totals.orders, 'count', currency)} secondary={view.totals.newPct.status === 'value' ? `${view.totals.newPct.value.toFixed(0)}% new` : view.totals.newPct.status === 'unavailable' ? 'new % unavailable' : '—'} title={reason(view.totals.orders) || reason(view.totals.newPct)} />
        <Total label="AOV" primary={show(view.totals.aov, 'money', currency)} secondary="gross / orders" title={reason(view.totals.aov)} />
        <Total label="Sessions" primary="unavailable" secondary="CVR unavailable" title={SESSIONS_TITLE} />
      </div>

      <div className="rounded-2xl px-4 py-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs" style={{ backgroundColor: CARD, border: `1px solid ${LINE_COLOR}` }}>
        <Stat label="Spend rate" value={view.rate.perMinute.status === 'value' ? `${money(view.rate.perMinute.value, currency)}/min` : 'unavailable'} title={view.rate.measureLabel} />
        <Stat label="At this rate" value={view.rate.perHour.status === 'value' ? `${money(view.rate.perHour.value, currency)}/hr` : 'unavailable'} title={reason(view.rate.perHour)} />
        <Stat label="This hour" value={view.rate.thisHourProjected.status === 'value' ? money(view.rate.thisHourProjected.value, currency) : 'unavailable'} title="Linear projection of the open hour." />
        <Stat label="Vs last hour" value={view.rate.vsLastHourPct == null ? '—' : `${view.rate.vsLastHourPct >= 0 ? '+' : ''}${view.rate.vsLastHourPct.toFixed(0)}%`} />
        <Stat label="Backfill est" value={view.rate.metaBackfill.status === 'value' ? money(view.rate.metaBackfill.value, currency) : 'unavailable'} title="Meta only. Estimate." />
        <Stat label="Backfill default" value={view.rate.curveLabel} title={reason(view.rate.googleBackfill)} />
        <div className="ml-auto flex gap-2">
          <button type="button" onClick={() => setCompact((on) => !on)} className="rounded-full px-3 py-1" style={{ color: TEXT, border: `1px solid ${LINE_COLOR}` }}>{compact ? 'Expanded' : 'Compact'}</button>
          <button type="button" onClick={onRefresh} className="rounded-full px-3 py-1" style={{ color: INK, backgroundColor: GOLD }}>Refresh now</button>
        </div>
      </div>

      <div className="rounded-2xl overflow-x-auto" style={{ backgroundColor: CARD, border: `1px solid ${LINE_COLOR}` }}>
        <table className={`w-full text-left ${compact ? 'text-[10px]' : 'text-xs'}`}>
          <thead>
            <tr style={{ color: MUTED }}>
              {['Hour', 'Settled', 'Meta', 'Google', 'Spend', 'Sales', 'ROAS', 'Exp. final', 'Trending', 'Orders', 'New %', 'AOV', 'Sessions', 'CVR', 'Note'].map((heading) => (
                <th key={heading} className="px-2 py-2 font-medium whitespace-nowrap">{heading}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.hours.map((row) => (
              <tr key={row.hour} style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                <td className="px-2 py-1.5" style={{ color: row.settled === 'live' ? GOLD : TEXT }}>{row.label}</td>
                <td className="px-2 py-1.5 whitespace-nowrap" style={{ color: row.settled === 'final' ? MUTED : row.settled === 'upcoming' ? DIM : GOLD }}>{row.settledLabel}</td>
                <HourCells row={row} currency={currency} estimate={row.expectedFinalIsEstimate} />
                <td className="px-2 py-1.5 min-w-[140px]">
                  {row.settled === 'upcoming' ? (
                    <span style={{ color: DIM }}>—</span>
                  ) : notes.status === 'unavailable' ? (
                    <span title={notes.reason} style={{ color: MUTED }}>unavailable</span>
                  ) : canEditNotes ? (
                    <input
                      defaultValue={notes.byHour[row.hour] || ''}
                      key={`${date}-${row.hour}-${notes.byHour[row.hour] || ''}`}
                      onBlur={(event) => {
                        const next = event.target.value.trim();
                        if (next !== (notes.byHour[row.hour] || '')) onSaveNote(row.hour, next);
                      }}
                      className="w-full bg-transparent outline-none"
                      style={{ color: TEXT }}
                      placeholder="note"
                      maxLength={500}
                    />
                  ) : (
                    <span style={{ color: TEXT }}>{notes.byHour[row.hour] || '—'}</span>
                  )}
                </td>
              </tr>
            ))}
            <tr style={{ borderTop: `1px solid ${LINE_COLOR}` }}>
              <td className="px-2 py-2 font-medium" style={{ color: TEXT }}>Day</td>
              <td className="px-2 py-2" style={{ color: MUTED }}>{view.day.settledLabel}</td>
              <HourCells row={view.day} currency={currency} estimate={view.day.expectedFinalIsEstimate} />
              <td />
            </tr>
          </tbody>
        </table>
      </div>

      <div className="text-[11px] leading-relaxed space-y-1 px-1" style={{ color: MUTED }}>
        {view.method.map((line) => <p key={line}>{line}</p>)}
      </div>
    </div>
  );
}

const SESSIONS_TITLE = 'Sessions and conversion rate are unavailable. Melch.Cloud has no session source.';

function Total({ label, primary, secondary, title, tone }: { label: string; primary: string; secondary: string; title?: string; tone?: 'green' | 'red' | 'neutral' }) {
  return (
    <div className="rounded-2xl px-4 py-3" style={{ backgroundColor: CARD, border: `1px solid ${LINE_COLOR}` }} title={title}>
      <div className="text-[11px] uppercase tracking-wide" style={{ color: MUTED }}>{label}</div>
      <div className="text-lg font-semibold tabular-nums mt-1" style={{ color: primary === 'unavailable' ? MUTED : toneColor(tone || 'neutral') === MUTED ? TEXT : toneColor(tone || 'neutral') }}>{primary}</div>
      <div className="text-[11px] mt-1" style={{ color: MUTED }}>{secondary}</div>
    </div>
  );
}

function Stat({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div title={title}>
      <div className="uppercase tracking-wide" style={{ color: MUTED }}>{label}</div>
      <div className="mt-0.5 max-w-xs" style={{ color: TEXT }}>{value}</div>
    </div>
  );
}
