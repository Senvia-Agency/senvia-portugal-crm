import assert from 'node:assert/strict';
import test from 'node:test';
import { runtime, database, fixture } from './automation-engine-runtime-harness.mjs';

function composedDb(run, flow, rows) {
  const db = database(run, flow);
  const original = db.from;
  db.from = table => {
    if (!(table in rows)) return original(table);
    let changes, insertion, one = false;
    const filters = [];
    const q = {
      select() { return q; }, eq(k, v) { filters.push(row => row[k] === v); return q; },
      update(value) { changes = value; return q; }, insert(value) { insertion = value; return q; },
      maybeSingle() { one = true; return q; }, single() { one = true; return q; },
      then(resolve, reject) {
        if (insertion) rows[table].push({ id: `created-${table}`, ...insertion });
        const found = rows[table].filter(row => filters.every(filter => filter(row)));
        if (changes) found.forEach(row => Object.assign(row, changes));
        return Promise.resolve({ data: structuredClone(one ? found[0] ?? null : found), error: null }).then(resolve, reject);
      },
    };
    return q;
  };
  return db;
}
function setup(nodes, rows, subject = 'lead') {
  const { run, flow } = fixture(nodes, nodes.slice(1).map((node, i) => ({ source: nodes[i].id, target: node.id })));
  flow.max_steps_per_run = 20;
  run.subject_type = subject;
  run.subject_id = subject === 'proposal' ? 'proposal' : 'lead';
  return { run, flow, db: composedDb(run, flow, rows) };
}

test('create lead then assign move and task target the created lead while enrollment stays original', async () => {
  const rows = { leads: [{ id: 'lead', organization_id: 'org', name: 'Original', email: 'original@example.test' }], organization_members: [{ organization_id: 'org', user_id: 'member', is_active: true }], inbox_tasks: [] };
  const { run, flow, db } = setup([
    { id: 'create', type: 'create_lead', config: { name: 'Created', email: 'created@example.test' } },
    { id: 'assign', type: 'assign_user', config: { user_id: 'member' } },
    { id: 'move', type: 'move_stage', config: { stage: 'qualified' } },
    { id: 'task', type: 'create_task', config: { title: 'Call {{nome}}', user_id: 'member' } },
  ], rows);
  db.rpc = async () => { rows.leads.push({ id: 'created-lead', organization_id: 'org', name: 'Created', email: 'created@example.test', status: 'new' }); return { data: { lead_id: 'created-lead' }, error: null }; };
  await new (runtime().Engine)(db).advance(run, flow, 'create');
  assert.equal(run.status, 'completed');
  assert.equal(run.subject_id, 'lead');
  assert.equal(run.subject_type, 'lead');
  assert.equal(rows.leads[0].assigned_to, undefined);
  assert.equal(rows.leads[1].assigned_to, 'member');
  assert.equal(rows.leads[1].status, 'qualified');
  assert.equal(rows.inbox_tasks[0].lead_id, 'created-lead');
  assert.equal(rows.inbox_tasks[0].title, 'Call Created');
});

test('convert lead then update field changes created client rather than original lead', async () => {
  const rows = { leads: [{ id: 'lead', organization_id: 'org', name: 'Lead', email: 'lead@example.test' }], crm_clients: [{ id: 'client', organization_id: 'org', name: 'Client', email: 'client@example.test' }] };
  const { run, flow, db } = setup([{ id: 'convert', type: 'convert_to_client', config: {} }, { id: 'update', type: 'update_field', config: { field: 'name', value: 'Updated client' } }], rows);
  db.rpc = async () => ({ data: 'client', error: null });
  await new (runtime().Engine)(db).advance(run, flow, 'convert');
  assert.equal(run.status, 'completed');
  assert.equal(run.subject_id, 'lead');
  assert.equal(rows.leads[0].name, 'Lead');
  assert.equal(rows.crm_clients[0].name, 'Updated client');
});

test('create sale then request status uses sale effective view without changing proposal enrollment', async () => {
  const rows = { proposals: [{ id: 'proposal', organization_id: 'org', status: 'accepted', client_id: 'client' }], sales: [{ id: 'sale', organization_id: 'org', status: 'pending', client_id: 'client' }], crm_clients: [{ id: 'client', organization_id: 'org', name: 'Client', email: 'client@example.test' }] };
  const { run, flow, db } = setup([{ id: 'create', type: 'create_sale_from_proposal', config: {} }, { id: 'request', type: 'request_sale_status', config: { reason: 'Deliver', target_status: 'delivered' } }], rows, 'proposal');
  const calls = [];
  db.rpc = async (name, args) => { calls.push({ name, args }); return { data: name === 'automation_create_pending_sale' ? 'sale' : 'request', error: null }; };
  await new (runtime().Engine)(db).advance(run, flow, 'create');
  assert.equal(run.status, 'completed');
  assert.equal(run.subject_type, 'proposal');
  assert.equal(run.subject_id, 'proposal');
  assert.equal(calls[1].name, 'automation_request_financial_action');
  assert.equal(run.context.__action_target.id, 'sale');
  assert.equal(db.steps[1].detail.estado, 'pending');
});

test('field updates refresh aliases before the following webhook while enrollment contact remains unchanged', async () => {
  const rows = { leads: [{ id: 'lead', organization_id: 'org', name: 'Original', email: 'old@example.test' }] };
  const { run, flow, db } = setup([{ id: 'update', type: 'update_field', config: { field: 'email', value: 'new@example.test' } }, { id: 'hook', type: 'webhook', config: { url: 'https://example.invalid', body: '{"email":"{{email}}"}' } }], rows);
  let body;
  const { Engine } = runtime(async (_url, options) => { body = JSON.parse(options.body); return { ok: true, status: 200, text: async () => '{}' }; });
  await new Engine(db).advance(run, flow, 'update');
  assert.equal(run.status, 'completed');
  assert.equal(body.email, 'new@example.test');
  assert.equal(run.contact_email, 'a@example.test');
});

test('foreign active target fails before any effect', async () => {
  const rows = { leads: [{ id: 'foreign', organization_id: 'foreign-org', name: 'Other' }] };
  const { run, flow, db } = setup([{ id: 'update', type: 'update_field', config: { field: 'name', value: 'Wrong' } }], rows);
  run.context.__action_target = { type: 'lead', id: 'foreign' };
  await new (runtime().Engine)(db).advance(run, flow, 'update');
  assert.equal(run.status, 'failed');
  assert.equal(rows.leads[0].name, 'Other');
});

test('goal stays on original lead when an action creates and changes another lead', async () => {
  const rows = { leads: [{ id: 'lead', organization_id: 'org', name: 'Original', status: 'new' }], inbox_tasks: [] };
  const { run, flow, db } = setup([
    { id: 'create', type: 'create_lead', config: { name: 'Created', email: 'created@example.test' } },
    { id: 'move', type: 'move_stage', config: { stage: 'qualified' } },
    { id: 'task', type: 'create_task', config: { title: 'Continue after created lead changed' } },
  ], rows);
  flow.trigger_config.goal = { field: 'status', operator: 'equals', value: 'qualified' };
  db.rpc = async () => { rows.leads.push({ id: 'created-lead', organization_id: 'org', name: 'Created', email: 'created@example.test', status: 'new' }); return { data: { lead_id: 'created-lead' }, error: null }; };
  await new (runtime().Engine)(db).advance(run, flow, 'create');
  assert.equal(run.status, 'completed');
  assert.equal(run.context.__goal_reached_at, undefined);
  assert.equal(rows.leads[0].status, 'new');
  assert.equal(rows.leads[1].status, 'qualified');
  assert.equal(rows.inbox_tasks.length, 1);
});

test('disabled effective lead closes path before email or stage change with original contact identity intact', async () => {
  const rows = { leads: [{ id: 'created-lead', organization_id: 'org', name: 'Disabled', email: 'disabled@example.test', status: 'new', automation_enabled: false }] };
  const { run, flow, db } = setup([
    { id: 'email', type: 'send_email', config: { subject: 'Hello', html: '<p>Hello</p>' } },
    { id: 'move', type: 'move_stage', config: { stage: 'qualified' } },
  ], rows, 'contact');
  run.subject_id = 'original-contact';
  run.context.__action_target = { type: 'lead', id: 'created-lead' };
  let sends = 0;
  db.functions = { invoke: async () => { sends++; return { data: { results: [{ status: 'sent' }] }, error: null }; } };
  await new (runtime().Engine)(db).advance(run, flow, 'email');
  assert.equal(run.status, 'completed');
  assert.equal(run.subject_type, 'contact');
  assert.equal(run.subject_id, 'original-contact');
  assert.equal(sends, 0);
  assert.equal(rows.leads[0].status, 'new');
  assert.equal(db.steps.length, 1);
  assert.match(db.steps[0].detail.motivo, /desativadas/);
});
