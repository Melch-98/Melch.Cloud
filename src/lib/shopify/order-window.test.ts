import assert from 'node:assert/strict';
import { test } from 'node:test';
import { orderCatchUpPlan, safetyNetSince } from './order-window.ts';

const NOW = Date.parse('2026-09-28T12:00:00.000Z');

test('covers the last two days when the newest order is only minutes old', () => {
  const since = safetyNetSince('2026-09-28T11:50:00.000Z', NOW);
  assert.equal(since, '2026-09-26T12:00:00.000Z');
});

test('reaches back to the newest stored order when that row is older than two days', () => {
  const since = safetyNetSince('2026-09-23T08:00:00.000Z', NOW);
  assert.equal(since, '2026-09-23T06:00:00.000Z');
});

test('looks back seven days when the store has no orders yet', () => {
  const since = safetyNetSince(null, NOW);
  assert.equal(since, '2026-09-21T12:00:00.000Z');
});

test('an order gap of a few days is pulled through now', () => {
  const plan = orderCatchUpPlan('2026-09-22T03:39:00.000Z', Date.parse('2026-09-28T17:30:00.000Z'));
  assert.equal(plan.chunked, false);
  assert.equal(plan.until, null);
  assert.equal(plan.since, '2026-09-22T01:39:00.000Z');
});

test('a long order gap is capped at 45 days and takes the oldest 10', () => {
  const plan = orderCatchUpPlan('2026-01-01T00:00:00.000Z', Date.parse('2026-09-28T17:30:00.000Z'));
  assert.equal(plan.chunked, true);
  assert.equal(plan.since, '2026-08-14T17:30:00.000Z');
  assert.equal(plan.until, '2026-08-24T17:30:00.000Z');
});

test('the next order run continues where the previous chunk stopped', () => {
  const plan = orderCatchUpPlan(
    '2026-01-01T00:00:00.000Z',
    Date.parse('2026-09-28T17:30:00.000Z'),
    '2026-08-24T17:30:00.000Z'
  );
  assert.equal(plan.since, '2026-08-24T17:30:00.000Z');
  assert.equal(plan.until, '2026-09-03T17:30:00.000Z');
  assert.equal(plan.chunked, true);
});
