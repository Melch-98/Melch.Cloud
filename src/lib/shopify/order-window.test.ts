import assert from 'node:assert/strict';
import { test } from 'node:test';
import { safetyNetSince } from './order-window.ts';

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
