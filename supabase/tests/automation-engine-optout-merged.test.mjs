import assert from 'node:assert/strict';
import test from 'node:test';
import { automationContactSuppressed } from '../functions/_shared/automation-contact-optout.ts';
import { runtime, database, fixture } from './automation-engine-runtime-harness.mjs';

test('current optout preference cancels rebuilt runtime before downstream action', async () => {
  const { run, flow } = fixture([{ id: 'send', type: 'send_email', config: {} }], []);
  const db = database(run, flow);
  let providerCalls = 0;
  db.rpc = async name => { assert.equal(name, 'automation_contact_is_suppressed'); return { data: true, error: null }; };
  db.functions = { invoke: async () => { providerCalls++; return { data: {}, error: null }; } };
  const { Engine } = runtime(undefined, { automationContactSuppressed });
  await new Engine(db).advance(run, flow, 'send');
  assert.equal(run.status, 'cancelled');
  assert.equal(providerCalls, 0);
  assert.equal(db.steps.length, 0);
});
