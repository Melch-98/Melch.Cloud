/*
 * Ported from Odylic Constellation
 * https://github.com/peterquads/odylic-constellation
 * commit 6ef04b6efc48ce3200bb317838f6ff6f796f4716
 *
 * MIT License
 *
 * Copyright (c) 2026 Odylic Media
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

/**
 * The drawer's Charts tab. Light on purpose: the tiles and recharts load on
 * first use in their own chunk (AdChartsPanel), so the space's first paint
 * carries none of it. The dates are the ones the cards were loaded for
 * (lib/adCharts setChartRange), unless the caller passes its own.
 */
import { lazy, Suspense, useMemo } from 'react'
import type { SpaceAd } from '../../lib/adModel'
import { useChartRange } from '../../lib/adCharts'

const AdChartsPanel = lazy(() => import('./AdChartsPanel'))

/** Start loading the chart chunk early (e.g. when the drawer opens), without rendering it. */
export const preloadAdCharts = () => { void import('./AdChartsPanel') }

export function AdCharts({ ad, demo, since, until }: { ad: SpaceAd; demo: boolean; since?: string; until?: string }) {
  const loaded = useChartRange()
  const range = useMemo(() => (since && until ? { since, until } : loaded), [since, until, loaded])
  if (!range) {
    return <div className="text-[12px] text-text-muted py-8 text-center">The charts show once the ads have loaded.</div>
  }
  return (
    <Suspense fallback={<ChartsLoading />}>
      <AdChartsPanel ad={ad} demo={demo} range={range} />
    </Suspense>
  )
}

function ChartsLoading() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading the charts">
      {[260, 120, 44, 44].map((h, i) => (
        <div key={i} className="rounded-xl border border-line ac-thumb-skeleton" style={{ height: h }} />
      ))}
    </div>
  )
}
