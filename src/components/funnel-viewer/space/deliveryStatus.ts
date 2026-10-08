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
 * Delivery status: Meta's `effective_status` folded into the buckets people
 * ask for ("is it live or paused?"), for group-by, the dimension filter, the
 * dashboards' creative source and the 3D space. An ad paused at the ad set or
 * campaign counts as Paused: it isn't delivering either way. The exact Meta
 * value stays on the row as `effective_status` (the Status column).
 */
export const DELIVERY_STATUS_KEY = 'delivery_status'

export const DELIVERY_STATUSES = ['Live', 'Paused', 'In review', 'Issues', 'Archived'] as const
export type DeliveryStatus = typeof DELIVERY_STATUSES[number]

export function deliveryStatus(effective?: string | null): DeliveryStatus | '' {
  switch ((effective || '').toUpperCase()) {
    case 'ACTIVE': return 'Live'
    case 'PAUSED':
    case 'ADSET_PAUSED':
    case 'CAMPAIGN_PAUSED': return 'Paused'
    case 'PENDING_REVIEW':
    case 'IN_PROCESS':
    case 'PREAPPROVED': return 'In review'
    case 'DISAPPROVED':
    case 'WITH_ISSUES':
    case 'PENDING_BILLING_INFO': return 'Issues'
    case 'ARCHIVED':
    case 'DELETED': return 'Archived'
    default: return ''
  }
}
