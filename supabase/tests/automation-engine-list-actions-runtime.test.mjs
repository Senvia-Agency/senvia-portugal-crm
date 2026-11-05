import assert from 'node:assert/strict';
import test from 'node:test';
import { runtime, fixture } from './automation-engine-runtime-harness.mjs';
import { enrollmentStore } from './automation-engine-enrollment-store.mjs';

function listStore({ listOrg = 'org', contacts = [] } = {}) {
  const { run, flow } = fixture([{ id: 'list', type: 'add_to_list', config: { list_id: 'list-a' } }]);
  const store = enrollmentStore({ automation_runs: [run], automation_flows: [flow],
    leads: [{ id: run.subject_id, organization_id: run.organization_id, name: run.contact_name, email: run.contact_email, phone: run.contact_phone }],
    client_lists: [{ id: 'list-a', organization_id: listOrg }], marketing_contacts: contacts });
  return { run: store.tables.automation_runs[0], flow, store };
}

test('adding existing unsubscribed contact preserves consent name and source', async () => {
  const { Engine } = runtime();
  const previous = { id: 'contact', organization_id: 'org', email: 'a@example.test', name: 'Nome escolhido', source: 'manual', subscribed: false };
  const { run, flow, store } = listStore({ contacts: [previous] });
  await new Engine(store).advance(run, flow, 'list');
  assert.equal(run.status, 'completed');
  assert.deepEqual(store.tables.marketing_contacts, [previous]);
  assert.deepEqual(store.tables.marketing_list_members.map(member => ({ list_id: member.list_id, contact_id: member.contact_id })), [{ list_id: 'list-a', contact_id: 'contact' }]);
});

test('foreign list fails before touching contacts or memberships', async () => {
  const { Engine } = runtime();
  const { run, flow, store } = listStore({ listOrg: 'foreign' });
  await new Engine(store).advance(run, flow, 'list');
  assert.equal(run.status, 'failed');
  assert.equal(store.queries.filter(query => ['marketing_contacts', 'marketing_list_members'].includes(query.table)).length, 0);
});

for (const failedTable of ['marketing_contacts', 'marketing_list_members']) {
  test(`${failedTable} write failure fails the step instead of reporting success`, async () => {
    const { Engine } = runtime();
    const { run, flow, store } = listStore();
    const originalFrom = store.from;
    store.from = table => {
      if (table !== failedTable) return originalFrom(table);
      const chain = {
        upsert() { return chain; }, select() { return chain; }, maybeSingle() { return chain; },
        then(resolve, reject) { return Promise.resolve({ data: null, error: { message: 'database unavailable' } }).then(resolve, reject); },
      };
      return chain;
    };
    await new Engine(store).advance(run, flow, 'list');
    assert.equal(run.status, 'failed');
    assert.equal(store.tables.automation_run_steps[0].status, 'failed');
  });
}
