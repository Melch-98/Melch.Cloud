import { toReportingCurrency } from '@/lib/currency';
import { addCalendarDays } from '@/lib/shopify/shop-time';
import {
  bfcmWindow,
  daysBetween,
  lastYearFigure,
  lastYearTotal,
  weekdayName,
  type BfcmWindow,
  type LastYearFigure,
} from '@/lib/bfcm/calendar';
import { merRatio } from '@/lib/bfcm/pacing';

export type PnlRatio = number | 'no data' | null;

export interface LastYearPnlInputRow {
  date: string;
  nc_orders?: number | string | null;
  rc_orders?: number | string | null;
  nc_revenue?: number | string | null;
  gross_sales?: number | string | null;
  discounts?: number | string | null;
  refunds?: number | string | null;
  meta_spend?: number | string | null;
  google_spend?: number | string | null;
  currency?: string | null;
}

export interface LastYearBfcmDay {
  date: string;
  label: string;
  alignedDate: string;
  inCore: boolean;
  orders: LastYearFigure;
  gross: LastYearFigure;
  net: LastYearFigure;
  ncRevenue: LastYearFigure;
  metaSpend: LastYearFigure;
  googleSpend: LastYearFigure;
  mer: PnlRatio;
  amer: PnlRatio;
}

export interface LastYearBfcmTotals {
  orders: LastYearFigure;
  gross: LastYearFigure;
  net: LastYearFigure;
  ncRevenue: LastYearFigure;
  metaSpend: LastYearFigure;
  googleSpend: LastYearFigure;
  mer: PnlRatio;
  amer: PnlRatio;
}

export interface LastYearBfcmPnl {
  year: number;
  rangeStart: string;
  rangeEnd: string;
  coreStart: string;
  coreEnd: string;
  currency: string;
  ncEstimated: boolean;
  days: LastYearBfcmDay[];
  core: LastYearBfcmTotals;
  extended: LastYearBfcmTotals;
}

export interface LastYearBfcmRange {
  start: string;
  end: string;
  core: BfcmWindow;
  thisYear: BfcmWindow;
}

/** Last year's BFCM window, plus four days before the Monday and four days after Cyber Monday. */
export function lastYearBfcmRange(year: number): LastYearBfcmRange {
  const thisYear = bfcmWindow(year);
  const core = bfcmWindow(year - 1);
  return {
    start: addCalendarDays(core.start, -4),
    end: addCalendarDays(core.cyberMonday, 4),
    core,
    thisYear,
  };
}

/** Shopify CSV imports mark new vs returning from email and renewals. */
export function isCsvImportSource(source: string | null | undefined): boolean {
  return typeof source === 'string' && source.startsWith('csv_import');
}

function num(value: number | string | null | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundFigure(figure: LastYearFigure): LastYearFigure {
  return figure === 'no data' ? figure : Math.round(figure * 100) / 100;
}

function ratioFigure(numerator: LastYearFigure, spend: LastYearFigure): PnlRatio {
  if (numerator === 'no data' || spend === 'no data') return 'no data';
  const ratio = merRatio(numerator, spend);
  return ratio == null ? null : Math.round(ratio * 100) / 100;
}

function eachDay(start: string, end: string): string[] {
  const days: string[] = [];
  for (let date = start; date <= end; date = addCalendarDays(date, 1)) days.push(date);
  return days;
}

interface MoneyDay {
  date: string;
  orders: number;
  gross: number;
  net: number;
  merRevenue: number;
  ncRevenue: number;
  metaSpend: number;
  googleSpend: number;
  spend: number;
}

function summarize(days: MoneyDay[], earliestOrderDay: string | null | undefined): LastYearBfcmTotals {
  const total = (pick: (day: MoneyDay) => number): LastYearFigure =>
    roundFigure(lastYearTotal(days.map((day) => ({ date: day.date, amount: pick(day) })), earliestOrderDay));
  const orders = total((day) => day.orders);
  const gross = total((day) => day.gross);
  const net = total((day) => day.net);
  const ncRevenue = total((day) => day.ncRevenue);
  const metaSpend = total((day) => day.metaSpend);
  const googleSpend = total((day) => day.googleSpend);
  const merRevenue = total((day) => day.merRevenue);
  const spend = total((day) => day.spend);
  return {
    orders,
    gross,
    net,
    ncRevenue,
    metaSpend,
    googleSpend,
    mer: ratioFigure(merRevenue, spend),
    amer: ratioFigure(ncRevenue, spend),
  };
}

/**
 * One row per calendar day from the extended last-year window.
 * Discounts and refunds are stored negative, so net is gross + discounts + refunds.
 * MER is (gross + discounts) / (Meta + Google). aMER is NC gross / (Meta + Google),
 * the same split the command center uses for today.
 */
export function buildLastYearBfcmPnl(input: {
  year: number;
  rows: LastYearPnlInputRow[];
  earliestOrderDay: string | null | undefined;
  ncEstimated: boolean;
  reportingCurrency: string;
  fxRates: Record<string, number>;
}): LastYearBfcmPnl {
  const range = lastYearBfcmRange(input.year);
  const byDate = new Map<string, LastYearPnlInputRow>();
  for (const row of input.rows) {
    const date = String(row.date || '').slice(0, 10);
    if (date) byDate.set(date, row);
  }

  const moneyDays: MoneyDay[] = eachDay(range.start, range.end).map((date) => {
    const row = byDate.get(date);
    const from = row?.currency || input.reportingCurrency;
    const convert = (amount: number) =>
      toReportingCurrency(amount, from, input.reportingCurrency, input.fxRates);
    const gross = convert(num(row?.gross_sales));
    const discounts = convert(num(row?.discounts));
    const refunds = convert(num(row?.refunds));
    const metaSpend = convert(num(row?.meta_spend));
    const googleSpend = convert(num(row?.google_spend));
    return {
      date,
      orders: num(row?.nc_orders) + num(row?.rc_orders),
      gross,
      net: gross + discounts + refunds,
      merRevenue: gross + discounts,
      ncRevenue: convert(num(row?.nc_revenue)),
      metaSpend,
      googleSpend,
      spend: metaSpend + googleSpend,
    };
  });

  const days: LastYearBfcmDay[] = moneyDays.map((day) => {
    const offset = daysBetween(range.core.blackFriday, day.date);
    const known = range.core.days.find((coreDay) => coreDay.date === day.date);
    const figure = (amount: number) => roundFigure(lastYearFigure(amount, day.date, input.earliestOrderDay));
    const gross = figure(day.gross);
    const ncRevenue = figure(day.ncRevenue);
    const metaSpend = figure(day.metaSpend);
    const googleSpend = figure(day.googleSpend);
    const spend = figure(day.spend);
    return {
      date: day.date,
      label: known?.dayLabel || weekdayName(day.date),
      alignedDate: addCalendarDays(range.thisYear.blackFriday, offset),
      inCore: day.date >= range.core.start && day.date <= range.core.end,
      orders: figure(day.orders),
      gross,
      net: figure(day.net),
      ncRevenue,
      metaSpend,
      googleSpend,
      mer: ratioFigure(figure(day.merRevenue), spend),
      amer: ratioFigure(ncRevenue, spend),
    };
  });

  return {
    year: input.year - 1,
    rangeStart: range.start,
    rangeEnd: range.end,
    coreStart: range.core.start,
    coreEnd: range.core.end,
    currency: input.reportingCurrency,
    ncEstimated: input.ncEstimated,
    days,
    core: summarize(moneyDays.filter((day) => day.date >= range.core.start && day.date <= range.core.end), input.earliestOrderDay),
    extended: summarize(moneyDays, input.earliestOrderDay),
  };
}
