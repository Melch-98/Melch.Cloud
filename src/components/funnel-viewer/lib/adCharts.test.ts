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

import { afterEach, describe, expect, it, vi } from 'vitest'
import { requestChart } from './adCharts'
import { thumbUrl } from './api'

type Pending = { url: string; resolve: (body: unknown) => void }

function mockFetch() {
  const pending: Pending[] = []
  const fetchMock = vi.fn((url: string) => new Promise<Response>(resolve => {
    pending.push({ url, resolve: body => resolve(new Response(JSON.stringify(body), { status: 200 })) })
  }))
  vi.stubGlobal('fetch', fetchMock)
  return { pending, fetchMock }
}

const tick = () => new Promise(r => setTimeout(r, 0))

afterEach(() => { vi.unstubAllGlobals() })

describe('chart requests that reach Meta', () => {
  it('run one at a time, newest first, and drop the ones nobody waits for', async () => {
    const { pending, fetchMock } = mockFetch()
    const a = requestChart('/api/ads/1/daily?since=2026-09-01&until=2026-09-30')
    const b = requestChart('/api/ads/2/daily?since=2026-09-01&until=2026-09-30')
    const c = requestChart('/api/ads/3/daily?since=2026-09-01&until=2026-09-30')
    expect(fetchMock).toHaveBeenCalledTimes(1)   // only the first runs
    b.release()                                  // the viewer moved past card 2
    pending[0].resolve({ days: [] })
    await a.promise
    await tick()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(pending[1].url).toContain('/api/ads/3/')  // card 2 was never asked for
    pending[1].resolve({ days: [] })
    await c.promise
  })

  it('serve a repeat from the session memo without a request', async () => {
    const { pending, fetchMock } = mockFetch()
    const url = '/api/ads/9/breakdown?since=2026-09-01&until=2026-09-30&kind=age'
    const first = requestChart(url)
    pending[0].resolve({ rows: [] })
    await first.promise
    await requestChart(url).promise
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('let the demo skip the line', async () => {
    const { fetchMock } = mockFetch()
    requestChart('/api/ads/4/daily?since=2026-08-01&until=2026-08-31')
    requestChart('/api/ads/5/daily?since=2026-08-01&until=2026-08-31&demo=1')
    requestChart('/api/ads/6/daily?since=2026-08-01&until=2026-08-31&demo=1')
    expect(fetchMock.mock.calls.map(c => String(c[0])).filter(u => u.includes('demo=1'))).toHaveLength(2)
  })
})

describe('thumbUrl', () => {
  it('carries the creative version for a connected account, the demo set version for the demo', () => {
    expect(thumbUrl('12', false, 'abc123')).toBe('/api/thumb/12?v=abc123')
    expect(thumbUrl('12', true, 'abc123')).toBe('/api/thumb/12?demo=1&v=d2')
    expect(thumbUrl('12', false)).toBe('/api/thumb/12')
  })
})
