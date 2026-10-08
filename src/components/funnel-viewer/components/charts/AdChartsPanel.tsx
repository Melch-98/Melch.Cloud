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
 * The drawer's Charts tab body: Atelier's ad-level charts for one card, in
 * Atelier's order. Loaded lazily (AdCharts.tsx) with recharts in its own
 * chunk. By day and Customer segment start open; Age × gender, Placements
 * and Video retention open on a click, and every tile remembers its state.
 * A closed tile asks Meta for nothing; an open one asks once per card and
 * date range (the backend keeps the answer for 6 hours).
 */
import { useMemo } from 'react'
import type { SpaceAd } from '../../lib/adModel'
import { chartAdIds, type ChartRange } from '../../lib/adCharts'
import { EYEBROW } from '../../ui/theme'
import { AgeGenderChart } from './AgeGenderChart'
import type { ChartCtx } from './ChartKit'
import { DailyChart, PlacementChart, RetentionChart } from './PerformanceCharts'
import { SegmentMixTile } from './SegmentMixTile'
import './charts.css'

export default function AdChartsPanel({ ad, demo, range }: { ad: SpaceAd; demo: boolean; range: ChartRange }) {
  const adIds = useMemo(() => chartAdIds(ad), [ad])
  const video = !!(ad.is_video || ad.video_id)
  const spend = Number(ad.spend) || 0
  const ctx = useMemo<ChartCtx>(() => ({ adIds, range, demo, video, spend }), [adIds, range, demo, video, spend])
  return (
    <div className="fv-charts flex flex-col gap-3">
      {adIds.length > 1 && (
        <div className={EYEBROW}>Same creative in {adIds.length} ads (the charts add them up)</div>
      )}
      <DailyChart ctx={ctx} />
      <SegmentMixTile ad={ad} ctx={ctx} />
      <AgeGenderChart ctx={ctx} />
      <PlacementChart ctx={ctx} />
      {video && <RetentionChart ctx={ctx} />}
    </div>
  )
}
