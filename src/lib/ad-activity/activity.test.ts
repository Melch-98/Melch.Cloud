import { describe, expect, it } from 'vitest';
import {
  googleChangeEventQuery,
  metaEventKey,
  metaEventTime,
  normalizeGoogleChange,
  normalizeMetaActivity,
  platformSyncBookmark,
  type MetaActivity,
} from '@/lib/ad-activity/normalize';
import { gaqlResultRows } from '@/lib/pipeboard-google';
import {
  GOOGLE_MAX_WINDOW_MS,
  META_BACKFILL_MS,
  META_OVERLAP_MS,
  META_SLICE_MS,
  chicagoDayBounds,
  formatInTimeZone,
  ingestionWindow,
  sliceWindow,
  zonedLocalToUtc,
} from '@/lib/ad-activity/windows';

const NOW = Date.parse('2026-10-09T20:00:00.000Z');

function metaBudget(): MetaActivity {
  return {
    event_type: 'update_campaign_budget',
    event_time: '2026-10-09T13:03:57+0000',
    actor_name: 'Nick Melcher',
    actor_id: '111',
    application_name: 'Power Editor',
    object_id: '222',
    object_name: 'X',
    object_type: 'CAMPAIGN',
    translated_event_type: 'Campaign budget updated',
    extra_data: {
      type: 'composite_data',
      old_value: {
        type: 'payment_amount',
        currency: 'CAD',
        old_value: 15000,
        additional_value: 'Daily budget',
      },
      new_value: {
        type: 'payment_amount',
        currency: 'CAD',
        new_value: 20000,
        additional_value: 'Daily budget',
      },
    },
  };
}

describe('Meta activity normalization', () => {
  it('turns budget extra_data minor units into a daily CAD summary', () => {
    const event = normalizeMetaActivity(metaBudget(), { accountId: 'act_1', currency: 'CAD' });
    expect(event).not.toBeNull();
    expect(event?.change_type).toBe('budget');
    expect(event?.is_system).toBe(false);
    expect(event?.old_value).toBe('CAD 150');
    expect(event?.new_value).toBe('CAD 200');
    expect(event?.occurred_at).toBe('2026-10-09T13:03:57.000Z');
    expect(event?.summary).toBe(
      'Nick Melcher raised budget on campaign X from CAD 150 to CAD 200/day (Power Editor)'
    );
  });

  it('reads a live Graph composite budget payload', () => {
    const event = normalizeMetaActivity(
      {
        event_type: 'update_campaign_budget',
        event_time: '2026-10-09T13:03:57+0000',
        actor_name: 'Nick Melcher',
        actor_id: '111',
        application_name: 'Power Editor',
        object_id: '222',
        object_name: 'Fall Prospecting',
        object_type: 'CAMPAIGN_GROUP',
        translated_event_type: 'Campaign budget updated',
        extra_data: {
          old_value: {
            type: 'payment_amount',
            currency: 'CAD',
            old_value: 15000,
            additional_type: 'status_string',
            additional_value: 'Per day',
          },
          new_value: {
            type: 'payment_amount',
            currency: 'CAD',
            new_value: 20000,
            additional_type: 'status_string',
            additional_value: 'Per day',
          },
          type: 'composite_data',
        },
      },
      { accountId: 'act_1', currency: 'USD' }
    );
    expect(event?.change_type).toBe('budget');
    expect(event?.occurred_at).toBe('2026-10-09T13:03:57.000Z');
    expect(event?.summary).toBe(
      'Nick Melcher raised budget on campaign Fall Prospecting from CAD 150 to CAD 200/day (Power Editor)'
    );
  });

  it('accepts unix seconds and drops an unparseable event_time', () => {
    const seconds = normalizeMetaActivity(
      { ...metaBudget(), event_time: 1760000000 },
      { accountId: 'act_1', currency: 'CAD' }
    );
    expect(seconds?.occurred_at).toBe(new Date(1760000000 * 1000).toISOString());
    const numeric = normalizeMetaActivity(
      { ...metaBudget(), event_time: '1760000000' },
      { accountId: 'act_1', currency: 'CAD' }
    );
    expect(numeric?.occurred_at).toBe(seconds?.occurred_at);
    expect(metaEventTime('not-a-time')).toBeNull();
    expect(
      normalizeMetaActivity({ ...metaBudget(), event_time: 'not-a-time' }, { accountId: 'act_1', currency: 'CAD' })
    ).toBeNull();
  });

  it('reads a flat extra_data budget payload the same way', () => {
    const event = normalizeMetaActivity(
      {
        ...metaBudget(),
        extra_data: JSON.stringify({
          old_value: '15000',
          new_value: '20000',
          currency: 'CAD',
          type: 'payment_amount',
          additional_type: 'daily_budget',
        }),
      },
      { accountId: 'act_1', currency: 'USD' }
    );
    expect(event?.summary).toBe(
      'Nick Melcher raised budget on campaign X from CAD 150 to CAD 200/day (Power Editor)'
    );
  });

  it('describes a status change and leaves it visible', () => {
    const event = normalizeMetaActivity(
      {
        event_type: 'update_campaign_run_status',
        event_time: '2026-10-09T13:04:01+0000',
        actor_name: 'Nick Melcher',
        actor_id: '111',
        application_name: 'Ads Manager',
        object_id: '222',
        object_name: 'X',
        object_type: 'CAMPAIGN',
        translated_event_type: 'Campaign status updated',
        extra_data: { old_value: 'ACTIVE', new_value: 'PAUSED' },
      },
      { accountId: 'act_1', currency: 'USD' }
    );
    expect(event?.change_type).toBe('status');
    expect(event?.is_system).toBe(false);
    expect(event?.old_value).toBe('Active');
    expect(event?.new_value).toBe('Paused');
    expect(event?.summary).toBe(
      'Nick Melcher changed status on campaign X from Active to Paused (Ads Manager)'
    );
  });

  it('hides review, billing, spend-limit, and first-delivery events as system', () => {
    const base = {
      event_time: '2026-10-09T13:04:02+0000',
      actor_id: '0',
      object_id: '1',
      object_name: 'Account',
      object_type: 'ACCOUNT',
    };
    for (const eventType of [
      'ad_review_approved',
      'ad_account_billing_charge',
      'ad_account_update_spend_limit',
      'first_delivery_event',
    ]) {
      const event = normalizeMetaActivity(
        { ...base, event_type: eventType, actor_name: '' },
        { accountId: 'act_1', currency: 'USD' }
      );
      expect(event?.is_system, eventType).toBe(true);
    }
  });
});

describe('Google change_event normalization', () => {
  it('turns campaign budget micros into a daily cut and converts account time to UTC', () => {
    const event = normalizeGoogleChange(
      {
        changeEvent: {
          resourceName: 'customers/699/changeEvents/111~0~1',
          changeDateTime: '2026-10-09 10:15:00',
          userEmail: 'google@melch.media',
          clientType: 'GOOGLE_ADS_WEB_CLIENT',
          changeResourceType: 'CAMPAIGN_BUDGET',
          resourceChangeOperation: 'UPDATE',
          changedFields: 'amount_micros',
          campaign: 'customers/699/campaigns/55',
          oldResource: { campaignBudget: { amountMicros: '300000000' } },
          newResource: { campaignBudget: { amountMicros: '150000000' } },
        },
        campaign: { name: 'FOND campaign Y' },
      },
      { customerId: '699', currency: 'USD', timeZone: 'America/Chicago' }
    );
    expect(event?.change_type).toBe('budget');
    expect(event?.is_system).toBe(false);
    expect(event?.old_value).toBe('$300');
    expect(event?.new_value).toBe('$150');
    expect(event?.occurred_at).toBe('2026-10-09T15:15:00.000Z');
    expect(event?.summary).toBe(
      'google@melch.media cut budget on FOND campaign Y from $300 to $150/day (Google Ads)'
    );
    expect(event?.event_key).toBe('google:699:customers/699/changeEvents/111~0~1');
  });
});

describe('event_key dedupe', () => {
  it('reuses one Meta key for the same activity and a new key when the value changes', () => {
    const first = metaEventKey('act_1', metaBudget());
    const second = metaEventKey('act_1', metaBudget());
    expect(first).toBe(second);

    const changed = metaBudget();
    changed.extra_data = {
      ...(changed.extra_data as object),
      new_value: {
        type: 'payment_amount',
        currency: 'CAD',
        new_value: 25000,
        additional_value: 'Daily budget',
      },
    };
    expect(metaEventKey('act_1', changed)).not.toBe(first);

    const normalized = normalizeMetaActivity(metaBudget(), { accountId: 'act_1', currency: 'CAD' });
    expect(normalized?.event_key).toBe(first);
  });

  it('dedupes Google rows that share a change_event resource name', () => {
    const row = {
      changeEvent: {
        resourceName: 'customers/699/changeEvents/111~0~1',
        changeDateTime: '2026-10-09 10:15:00',
        userEmail: 'google@melch.media',
        clientType: 'GOOGLE_ADS_WEB_CLIENT',
        changeResourceType: 'CAMPAIGN_BUDGET',
        resourceChangeOperation: 'UPDATE',
        changedFields: 'amount_micros',
        oldResource: { campaignBudget: { amountMicros: '300000000' } },
        newResource: { campaignBudget: { amountMicros: '150000000' } },
      },
      campaign: { name: 'FOND campaign Y' },
    };
    const ctx = { customerId: '699', currency: 'USD', timeZone: 'America/Chicago' };
    const a = normalizeGoogleChange(row, ctx);
    const b = normalizeGoogleChange(row, ctx);
    expect(a?.event_key).toBe(b?.event_key);

    const other = normalizeGoogleChange(
      {
        ...row,
        changeEvent: { ...row.changeEvent, resourceName: 'customers/699/changeEvents/222~0~1' },
      },
      ctx
    );
    expect(other?.event_key).not.toBe(a?.event_key);
  });
});

describe('ingestion windows', () => {
  it('backfills Meta 7 days and Google 14 days, then overlaps the last success', () => {
    const metaFirst = ingestionWindow({ platform: 'meta', lastSuccessAt: null, now: NOW });
    expect(metaFirst.until - metaFirst.since).toBe(META_BACKFILL_MS);

    const googleFirst = ingestionWindow({ platform: 'google', lastSuccessAt: null, now: NOW });
    expect(googleFirst.until - googleFirst.since).toBe(14 * 24 * 60 * 60 * 1000);

    const last = new Date(NOW - 20 * 60 * 1000).toISOString();
    const metaNext = ingestionWindow({ platform: 'meta', lastSuccessAt: last, now: NOW });
    expect(metaNext.since).toBe(NOW - 20 * 60 * 1000 - META_OVERLAP_MS);
  });

  it('clamps a Google window to 29 days', () => {
    const stale = new Date(NOW - 40 * 24 * 60 * 60 * 1000).toISOString();
    const window = ingestionWindow({ platform: 'google', lastSuccessAt: stale, now: NOW });
    expect(window.since).toBe(NOW - GOOGLE_MAX_WINDOW_MS);
    expect(window.until - window.since).toBe(GOOGLE_MAX_WINDOW_MS);
  });

  it('slices a Meta fetch that is longer than 7 days', () => {
    const slices = sliceWindow(0, META_SLICE_MS + 3 * 24 * 60 * 60 * 1000, META_SLICE_MS);
    expect(slices).toHaveLength(2);
    expect(slices[0]).toEqual({ since: 0, until: META_SLICE_MS });
    expect(slices[1].since).toBe(META_SLICE_MS);
  });

  it('keeps an exact 7-day Meta window in one slice', () => {
    expect(sliceWindow(0, META_SLICE_MS, META_SLICE_MS)).toEqual([{ since: 0, until: META_SLICE_MS }]);
  });

  it('selects the Google resource messages and keeps the filter inside the clamped window', () => {
    const window = ingestionWindow({
      platform: 'google',
      lastSuccessAt: new Date(NOW - 40 * 24 * 60 * 60 * 1000).toISOString(),
      now: NOW,
    });
    const start = formatInTimeZone(new Date(window.since), 'America/Chicago');
    const end = formatInTimeZone(new Date(window.until), 'America/Chicago');
    const query = googleChangeEventQuery(start, end);
    expect(query).toContain('change_event.old_resource');
    expect(query).toContain('change_event.new_resource');
    expect(query).not.toMatch(/change_event\.old_resource\./);
    expect(query).not.toMatch(/change_event\.new_resource\./);
    expect(query).toContain(`>= '${start}'`);
    expect(query).toContain(`<= '${end}'`);
    expect(query).toContain('LIMIT 1000');
    expect(zonedLocalToUtc(start, 'America/Chicago').getTime()).toBe(window.since);
  });
});

describe('sync bookmarks and strict GAQL rows', () => {
  it('does not advance the watermark when every returned row fails to parse', () => {
    const meta = platformSyncBookmark({
      platform: 'meta',
      windowUntilMs: NOW,
      rawCount: 12,
      parsedCount: 0,
    });
    expect(meta.lastSuccessAt).toBeNull();
    expect(meta.error).toBe('Meta: 12 activities returned, 0 parsed');

    const google = platformSyncBookmark({
      platform: 'google',
      windowUntilMs: NOW,
      rawCount: 4,
      parsedCount: 0,
    });
    expect(google.lastSuccessAt).toBeNull();
    expect(google.error).toBe('Google: 4 change events returned, 0 parsed');
  });

  it('leaves the Meta bookmark in place when the page cap is hit', () => {
    const oldest = Date.parse('2026-10-08T12:00:00.000Z');
    const bookmark = platformSyncBookmark({
      platform: 'meta',
      windowUntilMs: NOW,
      rawCount: 2000,
      parsedCount: 2000,
      truncated: true,
      oldestFetchedMs: oldest,
    });
    expect(bookmark.lastSuccessAt).toBeNull();
    expect(bookmark.error).toBe(
      'Meta activity page cap reached; some older events in this window were not saved'
    );
  });

  it('stops a capped Google pull at the last row timestamp', () => {
    const last = Date.parse('2026-10-09T15:15:00.000Z');
    const bookmark = platformSyncBookmark({
      platform: 'google',
      windowUntilMs: NOW,
      rawCount: 1000,
      parsedCount: 1000,
      truncated: true,
      oldestFetchedMs: last,
    });
    expect(bookmark.lastSuccessAt).toBe(new Date(last).toISOString());
    expect(bookmark.error).toBe('Google change_event page stopped before the window ended');
  });

  it('advances to the window end when the pull is complete', () => {
    const bookmark = platformSyncBookmark({
      platform: 'meta',
      windowUntilMs: NOW,
      rawCount: 3,
      parsedCount: 3,
    });
    expect(bookmark.lastSuccessAt).toBe(new Date(NOW).toISOString());
    expect(bookmark.error).toBeNull();
  });

  it('throws the Pipeboard error text instead of treating it as an empty result', () => {
    expect(gaqlResultRows([{ campaign: { name: 'Y' } }])).toEqual([{ campaign: { name: 'Y' } }]);
    expect(gaqlResultRows({ results: [] })).toEqual([]);
    const text = `Request failed: 'change_event.old_resource.ad_group.name' is not a recognized field. ${'x'.repeat(400)}`;
    expect(() => gaqlResultRows(text)).toThrow(/^Pipeboard GAQL: /);
    try {
      gaqlResultRows(text);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      expect(message.startsWith('Pipeboard GAQL: ')).toBe(true);
      expect(message.length).toBe('Pipeboard GAQL: '.length + 300);
      expect(message).toContain('change_event.old_resource.ad_group.name');
    }
  });
});

describe('Chicago day bounds', () => {
  it('converts a Chicago calendar day to UTC', () => {
    const bounds = chicagoDayBounds('2026-10-09', '2026-10-09');
    expect(bounds.fromIso).toBe('2026-10-09T05:00:00.000Z');
    expect(bounds.toIso).toBe('2026-10-10T04:59:59.000Z');
  });

  it('uses CST after daylight saving ends', () => {
    expect(zonedLocalToUtc('2026-11-15 10:15:00', 'America/Chicago').toISOString()).toBe(
      '2026-11-15T16:15:00.000Z'
    );
  });
});
