import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { transformSync } from 'esbuild';
import { enrollmentStore } from './automation-engine-enrollment-store.mjs';

let importing = false;
const source = readFileSync(new URL("../functions/automation-engine/index.ts", import.meta.url), "utf8").split(String.fromCharCode(10)).filter(line => {
  if (line.startsWith("import ")) importing = true;
  if (importing) { if (line.includes(";")) importing = false; return false; }
  return true;
}).map(line => line.startsWith("export ") ? line.slice(7) : line).join(String.fromCharCode(10)).replace("if (import.meta.main) serve(", "serve(");
const script = transformSync(source, { loader: 'ts', target: 'es2022' }).code;

function endpoint({ admin = true, mfaDenied = false } = {}) {
  const store = enrollmentStore({
    automation_flows: [{ id: 'own-flow', organization_id: 'org-a', status: 'active' }],
    automation_runs: [{ id: 'foreign-run', organization_id: 'org-b', status: 'completed' }],
  });
  const authorizationCalls = [];
  let mfaCalls = 0, handler;
  store.auth = { getUser: async () => ({ data: { user: { id: 'user-a' } } }) };
  store.rpc = async (name, args) => {
    authorizationCalls.push({ name, args });
    if (name === 'is_org_member') return { data: args._org_id === 'org-a' };
    if (name === 'is_org_admin') return { data: admin && args._org_id === 'org-a' };
    return { data: false };
  };
  vm.runInContext(script, vm.createContext({
    console, Request, Response,
    Deno: { env: { get: name => name === 'SUPABASE_SERVICE_ROLE_KEY' ? 'internal-service' : 'https://example.invalid' } },
    createClient: () => store,
    serve: callback => { handler = callback; },
    requestMfaResponse: async () => { mfaCalls += 1; return mfaDenied ? new Response('MFA required', { status: 403 }) : null; },
  }));
  return {
    store, authorizationCalls, mfaCalls: () => mfaCalls,
    request: body => handler(new Request('https://example.invalid/automation-engine', {
      method: 'POST', headers: { authorization: 'Bearer ordinary-user-jwt', 'content-type': 'application/json' }, body: JSON.stringify(body),
    })),
  };
}

test('retry authorization uses target run organization even if caller supplies own flow id', async () => {
  const app = endpoint();
  const response = await app.request({ action: 'retry', flow_id: 'own-flow', run_id: 'foreign-run', from: 'start' });
  assert.equal(response.status, 401);
  assert.ok(app.authorizationCalls.some(call => call.name === 'is_org_admin' && call.args._org_id === 'org-b'));
  assert.equal(app.store.queries.filter(query => query.operation === 'insert' || query.operation === 'update').length, 0);
});

test('manual endpoint requires admin even for an organization member', async () => {
  const app = endpoint({ admin: false });
  const response = await app.request({ action: 'manual', flow_id: 'own-flow', subject_type: 'lead', subject_ids: ['lead'] });
  assert.equal(response.status, 401);
  assert.equal(app.mfaCalls(), 1);
});

test('MFA rejection stops manual execution before any authorization RPC or effect', async () => {
  const app = endpoint({ mfaDenied: true });
  const response = await app.request({ action: 'manual', flow_id: 'own-flow', subject_type: 'lead', subject_ids: ['lead'] });
  assert.equal(response.status, 403);
  assert.equal(app.mfaCalls(), 1);
  assert.equal(app.authorizationCalls.length, 0);
  assert.equal(app.store.queries.length, 0);
});

test('internal enrollment never accepts ordinary user JWT as internal authorization', async () => {
  const app = endpoint();
  const response = await app.request({ action: 'enroll', organization_id: 'org-a', flow_id: 'own-flow', trigger_type: 'lead_created', record: { id: 'lead' } });
  assert.equal(response.status, 401);
  assert.equal(app.authorizationCalls.length, 0);
  assert.equal(app.store.queries.length, 0);
});

test('manual administrator passing MFA reaches validation inside the handler', async () => {
  const app = endpoint();
  const response = await app.request({ action: 'manual', flow_id: 'own-flow', subject_type: 'lead', subject_ids: [] });
  assert.equal(response.status, 200);
  assert.ok((await response.json()).error);
  assert.equal(app.mfaCalls(), 1);
  assert.ok(app.authorizationCalls.some(call => call.name === 'is_org_admin' && call.args._org_id === 'org-a'));
});

test('step simulation endpoint requires administrator and MFA before reading its subject', async () => {
  const nonAdmin = endpoint({ admin: false });
  assert.equal((await nonAdmin.request({ action: 'step_test', flow_id: 'own-flow', node_id: 'email', subject_type: 'lead', subject_id: 'lead' })).status, 401);
  const noMfa = endpoint({ mfaDenied: true });
  assert.equal((await noMfa.request({ action: 'step_test', flow_id: 'own-flow', node_id: 'email', subject_type: 'lead', subject_id: 'lead' })).status, 403);
  assert.equal(noMfa.store.queries.length, 0);
});
