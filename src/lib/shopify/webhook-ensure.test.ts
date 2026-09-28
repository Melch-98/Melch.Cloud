import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyWebhookEnsure, interpretWebhookEnsure, type EnsureTopic } from './webhook-ensure.ts';

const topics = ['orders/create', 'orders/updated', 'orders/cancelled'];

function rows(status: EnsureTopic['status']): EnsureTopic[] {
  return topics.map((topic) => ({ topic, status }));
}

test('a first registration that creates every topic is success', () => {
  const outcome = interpretWebhookEnsure(rows('created'), null);
  assert.equal(outcome.ok, true);
  assert.equal(outcome.missingScope, null);
  assert.equal(outcome.continueRun, true);
});

test('a second ensure that finds the webhooks already registered is success', async () => {
  let calls = 0;
  const register = async () => {
    calls += 1;
    return {
      topics: rows(calls === 1 ? 'created' : 'already_registered'),
      missingScope: null,
    };
  };

  const first = await applyWebhookEnsure(register);
  const second = await applyWebhookEnsure(register);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.missingScope, null);
  assert.equal(calls, 2);
});

test('a missing scope is recorded and does not abort the run', () => {
  const outcome = interpretWebhookEnsure(rows('error'), 'write_webhooks');
  assert.equal(outcome.ok, false);
  assert.equal(outcome.missingScope, 'write_webhooks');
  assert.equal(outcome.continueRun, true);
});
