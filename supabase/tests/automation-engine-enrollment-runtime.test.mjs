import assert from 'node:assert/strict';
import test from 'node:test';
import { runtime, fixture } from './automation-engine-runtime-harness.mjs';
import { enrollmentStore } from './automation-engine-enrollment-store.mjs';

function flow(id = 'flow', extra = {}) {
  return { ...fixture([{ id: 'end', type: 'end', config: {} }]).flow, trigger_type: 'lead_created', reentry_policy: 'after_completion', ...extra, id };
}
const body = { organization_id: 'org', trigger_type: 'lead_created', subject_type: 'lead', record: { id: 'lead', name: 'Ana', email: 'ana@example.test', source: 'manual' } };

test('entry filter is evaluated before creating a run', async () => {
  const { handleEnroll } = runtime();
  const store = enrollmentStore({ automation_flows: [flow('flow', { trigger_config: { filters: { match: 'all', conditions: [{ field: 'source', operator: 'equals', value: 'web' }] } } })] });
  const result = await handleEnroll(store, body);
  assert.equal(result.enrolled, 0);
  assert.equal(store.queries.filter(query => query.table === 'automation_runs' && query.operation === 'insert').length, 0);
});

test('explicit flow id enrolls only requested active flow within organization', async () => {
  const { handleEnroll } = runtime();
  const store = enrollmentStore({ automation_flows: [flow('first'), flow('target'), flow('foreign', { organization_id: 'other' })] });
  const result = await handleEnroll(store, { ...body, flow_id: 'target' });
  assert.equal(result.enrolled, 1);
  assert.deepEqual(store.tables.automation_runs.map(run => run.flow_id), ['target']);
});

test('occurrence key deduplicates a repeated schedule after earlier run completed', async () => {
  const { handleEnroll } = runtime();
  const store = enrollmentStore({ automation_flows: [flow()] });
  const occurrence = { ...body, occurrence_key: 'lead:2026-11-04' };
  assert.equal((await handleEnroll(store, occurrence)).enrolled, 1);
  assert.equal((await handleEnroll(store, occurrence)).enrolled, 0);
  assert.equal(store.tables.automation_runs.length, 1);
});

test('manual selection cannot enroll a record belonging to another organization', async () => {
  const { handleManual } = runtime();
  const store = enrollmentStore({ automation_flows: [flow()], leads: [{ id: 'foreign-lead', organization_id: 'other', name: 'Outra' }] });
  const result = await handleManual(store, { flow_id: 'flow', subject_type: 'lead', subject_ids: ['foreign-lead'] });
  assert.equal(result.enrolled, 0);
  assert.equal(store.queries.filter(query => query.operation === 'insert').length, 0);
});

test('manual selection respects disabled lead automation flag', async () => {
  const { handleManual } = runtime();
  const store = enrollmentStore({ automation_flows: [flow()], leads: [{ id: 'lead', organization_id: 'org', name: 'Ana', automation_enabled: false }] });
  const result = await handleManual(store, { flow_id: 'flow', subject_type: 'lead', subject_ids: ['lead'] });
  assert.equal(result.enrolled, 0);
  assert.equal(store.queries.filter(query => query.operation === 'insert').length, 0);
});

for (const subjectType of ['sale', 'proposal']) {
  test(`${subjectType} enrollment resolves linked contact from same organization`, async () => {
    const { handleEnroll } = runtime();
    const trigger = subjectType === 'sale' ? 'sale_created' : 'proposal_created';
    const store = enrollmentStore({ automation_flows: [flow('flow', { trigger_type: trigger })],
      crm_clients: [{ id: 'client', organization_id: 'org', name: 'Cliente real', email: 'client@example.test', phone: '+351912345678' }] });
    const result = await handleEnroll(store, { organization_id: 'org', trigger_type: trigger, subject_type: subjectType,
      record: { id: 'record', client_id: 'client', code: 'DOC-1' } });
    assert.equal(result.enrolled, 1);
    const run = store.tables.automation_runs[0];
    assert.equal(run.contact_name, 'Cliente real');
    assert.equal(run.contact_email, 'client@example.test');
    assert.equal(run.subject_id, 'record');
    assert.equal(run.context.code, 'DOC-1');
  });
}

test('linked contact hydration cannot read contact from another organization', async () => {
  const { handleEnroll } = runtime();
  const store = enrollmentStore({ automation_flows: [flow('flow', { trigger_type: 'proposal_created' })],
    crm_clients: [{ id: 'foreign-client', organization_id: 'other', email: 'private@example.test' }] });
  await handleEnroll(store, { organization_id: 'org', trigger_type: 'proposal_created', subject_type: 'proposal',
    record: { id: 'proposal', client_id: 'foreign-client' } });
  assert.equal(store.tables.automation_runs[0].contact_email, null);
});

for (const triggerType of ['list_joined', 'list_left']) {
  test(`${triggerType} respects configured list before inserting a run`, async () => {
    const { handleEnroll } = runtime();
    const store = enrollmentStore({ automation_flows: [flow('flow', { trigger_type: triggerType, trigger_config: { list_id: 'list-a' } })] });
    const event = { ...body, trigger_type: triggerType, record: { ...body.record, list_id: 'list-b' } };
    assert.equal((await handleEnroll(store, event)).enrolled, 0);
    assert.equal(store.queries.filter(query => query.operation === 'insert').length, 0);
    assert.equal((await handleEnroll(store, { ...event, record: { ...event.record, list_id: 'list-a' } })).enrolled, 1);
  });
}
